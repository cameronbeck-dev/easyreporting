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
import { EXCEL_SERIAL_FORMAT } from '../types';
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

// Excel serial-date detection bounds. Excel's 1900-system epoch is 1899-12-30, so a plausible
// business date range of 1990-01-01 .. 2050-12-31 is serials 32874 .. 55153. A numeric string
// column whose values nearly all fall in this window is suggested as an Excel serial date —
// the only value-based signal available, since a serial date is indistinguishable from a plain
// number of the same magnitude. Owner confirms/overrides in the wizard.
const EXCEL_SERIAL_MIN = 32874;
const EXCEL_SERIAL_MAX = 55153;

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
 * True when EVERY non-empty value in a string column parses as a number. Used to promote
 * an all-text column that is really numeric back to a number — chiefly for Excel imports,
 * which are read as all-VARCHAR (see buildSourceSelect) so read_xlsx's per-cell type
 * inference can't hard-error on a mixed column. Unlike date detection this requires a 100%
 * match (not 95%): a single non-numeric value means the column is genuinely mixed and must
 * stay text, so publishing never silently NULLs a real value. Scans the whole column (no
 * LIMIT) so the "whole column is convertible" guarantee actually holds.
 */
async function isNumericColumn(parquet: string, column: string): Promise<boolean> {
  const conn = await getDuckConnection();
  const col = quoteIdent(column);
  const sql =
    `SELECT count(*) AS nn, count(TRY_CAST(v AS DOUBLE)) AS ok FROM (` +
    `SELECT trim(CAST(${col} AS VARCHAR)) AS v FROM read_parquet(${parquet}) ` +
    `WHERE ${col} IS NOT NULL) WHERE v <> ''`;

  const [row] = (await conn.runAndReadAll(sql)).getRowObjects();
  if (!row) return false;
  const nn = Number(row['nn'] ?? 0);
  const ok = Number(row['ok'] ?? 0);
  return nn >= 1 && ok === nn;
}

/**
 * True when a string column reads as Excel serial dates: enough non-empty samples, and nearly
 * all of them parse as a number within the Excel-date window (EXCEL_SERIAL_MIN..MAX). Excel
 * stores dates as a day-count since 1899-12-30, and .xlsx read as all-VARCHAR surfaces them as
 * numeric text ("45707") — so a range check is the only value-based signal. Uses the same
 * sample size / match ratio as date-format detection. Probed only after strptime detection
 * fails, so genuine formatted-date text is never mistaken for a serial.
 */
async function isExcelSerialColumn(parquet: string, column: string): Promise<boolean> {
  const conn = await getDuckConnection();
  const col = quoteIdent(column);
  const sql =
    `SELECT count(v) AS nn, ` +
    `count(*) FILTER (WHERE d BETWEEN ${EXCEL_SERIAL_MIN} AND ${EXCEL_SERIAL_MAX}) AS inrange FROM (` +
    `SELECT v, TRY_CAST(v AS DOUBLE) AS d FROM (` +
    `SELECT trim(CAST(${col} AS VARCHAR)) AS v FROM read_parquet(${parquet}) ` +
    `WHERE ${col} IS NOT NULL LIMIT ${SAMPLE_SIZE}) WHERE v <> '')`;

  const [row] = (await conn.runAndReadAll(sql)).getRowObjects();
  if (!row) return false;
  const nn = Number(row['nn'] ?? 0);
  if (nn < MIN_NON_NULL) return false;
  const inrange = Number(row['inrange'] ?? 0);
  return inrange / nn >= MATCH_RATIO;
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
    } else if (await isExcelSerialColumn(parquet, c.name)) {
      // A numeric column in the Excel-date window: cast as a serial date rather than a number.
      out.push({ name: c.name, sniffedType: 'string', suggestedType: 'date', dateFormat: EXCEL_SERIAL_FORMAT });
    } else if (await isNumericColumn(parquet, c.name)) {
      out.push({ name: c.name, sniffedType: 'string', suggestedType: 'number' });
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
      if (choice.dateFormat === EXCEL_SERIAL_FORMAT) {
        // Excel serial date: a (possibly fractional) day-count since 1899-12-30. floor() drops
        // any time-of-day fraction so the result is a clean DATE; non-numeric/empty values fall
        // to NULL via TRY_CAST rather than erroring the whole publish.
        expr = `CAST(DATE '1899-12-30' + CAST(floor(TRY_CAST(CAST(${col} AS VARCHAR) AS DOUBLE)) AS INTEGER) AS DATE)`;
      } else if (choice.dateFormat) {
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
