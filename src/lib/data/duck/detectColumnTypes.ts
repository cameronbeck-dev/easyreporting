// Value-based type detection for file-backed datasets.
//
// DuckDB's CSV sniffer only recognises ISO-ish dates, so a column like "02/Jan/2025"
// lands as VARCHAR and can never be bucketed by day/week/month. This module samples the
// actual values of each string column, tries a fixed list of common date/timestamp
// formats, and — when nearly all sampled values parse — suggests treating the column as a
// date with that strptime format. The owner confirms or overrides the suggestion in the
// Import wizard; the chosen types are then applied as casts when the dataset is published
// (see applyTypeOverrides).
import type { ColumnType } from '../types';
import { getDuckConnection, parquetLiteral } from './connection';
import { quoteIdent } from '../sql/identifiers';

/** A per-column recommendation surfaced in the Import wizard. */
export interface ColumnTypeSuggestion {
  name: string;
  /** The type DuckDB's CSV sniffer inferred (the current staged type). */
  sniffedType: ColumnType;
  /** What we recommend the column be (may equal sniffedType if nothing better found). */
  suggestedType: ColumnType;
  /** strptime format when the suggestion is a date/timestamp, else undefined. */
  dateFormat?: string;
}

/** The owner's final choice for a column, applied as a cast at publish time. */
export interface ColumnTypeChoice {
  type: ColumnType;
  /** Required when type is 'date' and the source is a string in a non-ISO format. */
  dateFormat?: string;
}

// Ordered candidate formats. Date-only formats come first so a column with no time part
// is typed as a plain date; timestamp formats catch values that carry a clock time.
// try_strptime requires the WHOLE value to match, so "02/Jan/2025 09:15" only matches a
// timestamp format, never the date-only one — which keeps the two groups from colliding.
const DATE_FORMATS = [
  '%Y-%m-%d',
  '%Y/%m/%d',
  '%d/%m/%Y',
  '%m/%d/%Y',
  '%d-%m-%Y',
  '%m-%d-%Y',
  '%d/%b/%Y',
  '%d-%b-%Y',
  '%d %b %Y',
  '%b %d, %Y',
  '%d %B %Y',
];
const TIMESTAMP_FORMATS = [
  '%Y-%m-%d %H:%M:%S',
  '%Y-%m-%dT%H:%M:%S',
  '%Y-%m-%d %H:%M',
  '%d/%m/%Y %H:%M:%S',
  '%d/%m/%Y %H:%M',
  '%m/%d/%Y %H:%M:%S',
  '%d/%b/%Y %H:%M:%S',
  '%d/%b/%Y %H:%M',
];
const CANDIDATE_FORMATS = [...DATE_FORMATS, ...TIMESTAMP_FORMATS];

// Detection thresholds: need enough non-null samples to trust the signal, and nearly all
// of them must parse (a stray unparseable value shouldn't block a genuine date column).
// 1000 sampled values is plenty to distinguish a date column from free text while keeping
// per-column probing cheap on wide datasets.
const SAMPLE_SIZE = 1000;
const MIN_NON_NULL = 20;
const MATCH_RATIO = 0.95;

/** true when a strptime format carries a clock component (→ TIMESTAMP rather than DATE). */
export function formatHasTime(format: string): boolean {
  return /%[HIMSp]/.test(format);
}

/** Embed a strptime format as a single-quoted SQL string literal (defensive escaping). */
function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Sample one string column and return the best-matching date/timestamp format, or null.
 * Runs a single aggregate query that counts how many sampled values each candidate format
 * parses; the highest count that clears MATCH_RATIO wins (ties resolve to the earlier,
 * i.e. day-first / date-only, candidate).
 */
async function detectFormatForColumn(
  parquet: string,
  column: string,
): Promise<{ format: string } | null> {
  const conn = await getDuckConnection();
  const col = quoteIdent(column);
  const counts = CANDIDATE_FORMATS.map(
    (fmt, i) => `count(try_strptime(v, ${sqlStr(fmt)})) AS c${i}`,
  );
  const sql =
    `SELECT count(v) AS nn, ${counts.join(', ')} FROM (` +
    `SELECT CAST(${col} AS VARCHAR) AS v FROM read_parquet(${parquet}) ` +
    `WHERE ${col} IS NOT NULL LIMIT ${SAMPLE_SIZE})`;

  const [row] = (await conn.runAndReadAll(sql)).getRowObjects();
  if (!row) return null;
  const nn = Number(row['nn'] ?? 0);
  if (nn < MIN_NON_NULL) return null;

  let bestIdx = -1;
  let bestCount = 0;
  CANDIDATE_FORMATS.forEach((_, i) => {
    const c = Number(row[`c${i}`] ?? 0);
    if (c > bestCount) {
      bestCount = c;
      bestIdx = i;
    }
  });

  if (bestIdx === -1 || bestCount / nn < MATCH_RATIO) return null;
  return { format: CANDIDATE_FORMATS[bestIdx] };
}

/**
 * Detect better types for a staged Parquet. Only string columns are probed (numeric and
 * boolean columns are already correctly typed by DuckDB). Returns one suggestion per
 * column, preserving the sniffed type when nothing better is found.
 */
export async function detectColumnTypes(
  parquetPath: string,
  sniffed: { name: string; type: ColumnType }[],
): Promise<ColumnTypeSuggestion[]> {
  const parquet = parquetLiteral(parquetPath);
  const out: ColumnTypeSuggestion[] = [];
  for (const c of sniffed) {
    if (c.type !== 'string') {
      out.push({ name: c.name, sniffedType: c.type, suggestedType: c.type });
      continue;
    }
    const hit = await detectFormatForColumn(parquet, c.name);
    if (hit) {
      out.push({ name: c.name, sniffedType: 'string', suggestedType: 'date', dateFormat: hit.format });
    } else {
      out.push({ name: c.name, sniffedType: 'string', suggestedType: 'string' });
    }
  }
  return out;
}

/**
 * Build the `SELECT * REPLACE (...)` projection that casts each column whose chosen type
 * differs from its sniffed type. Returns null when no column needs recasting (the caller
 * can then just move the staged file as-is). Formats come only from our own candidate list
 * / the sniffed schema, and every column name is quoted — no user string is interpolated
 * unescaped.
 */
export function buildCastSelect(
  sniffed: { name: string; type: ColumnType }[],
  choices: Record<string, ColumnTypeChoice>,
): string | null {
  const sniffedByName = new Map(sniffed.map((c) => [c.name, c.type]));
  const replacements: string[] = [];

  for (const c of sniffed) {
    const choice = choices[c.name];
    if (!choice) continue;
    // Only recast when the chosen type actually differs from what was sniffed. A text→date
    // column differs ('string' → 'date') and so is cast via strptime; a column already the
    // right type (incl. an ISO date DuckDB typed as DATE) is left untouched.
    if (choice.type === sniffedByName.get(c.name)) continue;

    const col = quoteIdent(c.name);
    let expr: string;
    if (choice.type === 'date') {
      if (choice.dateFormat) {
        const parsed = `try_strptime(CAST(${col} AS VARCHAR), ${sqlStr(choice.dateFormat)})`;
        expr = formatHasTime(choice.dateFormat) ? parsed : `CAST(${parsed} AS DATE)`;
      } else {
        // No format given: rely on DuckDB's own DATE cast (works for ISO strings).
        expr = `TRY_CAST(${col} AS DATE)`;
      }
    } else if (choice.type === 'number') {
      expr = `TRY_CAST(${col} AS DOUBLE)`;
    } else if (choice.type === 'boolean') {
      expr = `TRY_CAST(${col} AS BOOLEAN)`;
    } else {
      expr = `CAST(${col} AS VARCHAR)`;
    }
    replacements.push(`${expr} AS ${col}`);
  }

  if (replacements.length === 0) return null;
  return `SELECT * REPLACE (${replacements.join(', ')})`;
}
