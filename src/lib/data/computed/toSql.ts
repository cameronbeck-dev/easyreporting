// Translates a computed-field expression (parsed AST) into a SQL measure expression so the
// database aggregates it via GROUP BY — instead of the app fetching every row to evaluate
// the formula in JS. This is what lets computed-field charts scale past the row cap.
//
// The translation mirrors evaluateAggregate's semantics exactly:
//   • an explicit aggregate AGG(rowExpr) → OP(<row-level SQL for rowExpr>)
//   • a BARE column at aggregate level    → SUM("col")   (the default aggregation)
//   • arithmetic combines these aggregate scalars.
//
// So `([Sell] - [Cost]) / [Sell]` becomes `(SUM("Sell") - SUM("Cost")) / NULLIF(SUM("Sell"), 0)`
// — the revenue-weighted margin — computed entirely in SQL.
//
// SAFETY: the only text emitted is quoted identifiers (via quoteIdent), fixed operators, and
// numeric literals parsed from the formula. There is no path for arbitrary SQL to appear.
// DIALECT: portable across Postgres and DuckDB — divisions are promoted to floating point
// with `* 1.0` (so integer columns don't do integer division) and guarded with NULLIF (so a
// zero denominator yields NULL rather than a Postgres divide-by-zero error).
import type { Expr } from './types';
import { quoteIdent } from '../sql/identifiers';

function binSql(op: '+' | '-' | '*' | '/', left: string, right: string): string {
  if (op === '/') {
    return `((${left}) * 1.0 / NULLIF((${right}), 0))`;
  }
  return `(${left} ${op} ${right})`;
}

// Maps a stored (bare) column name to the identifier text quoteIdent should quote. Defaults to
// identity — used unchanged by the SQL path and single-table file datasets. Multi-table file
// datasets pass a mapper that prefixes bare base columns with the base alias (e.g. "Sell" →
// "consignments.Sell") so refs stay unambiguous when a joined Parquet has a same-named column.
type NameMapper = (name: string) => string;

/** Row-level translation (used inside an aggregate function's argument). Columns are raw. */
function rowSql(e: Expr, mapName: NameMapper): string {
  switch (e.kind) {
    case 'num':
      return String(e.value);
    case 'col':
      return quoteIdent(mapName(e.name));
    case 'neg':
      return `(-(${rowSql(e.operand, mapName)}))`;
    case 'bin':
      return binSql(e.op, rowSql(e.left, mapName), rowSql(e.right, mapName));
    case 'agg':
      // The parser forbids nested aggregates, so this is unreachable in practice.
      throw new Error('Aggregate functions cannot be nested.');
  }
}

/** Aggregate-level translation: bare columns default to SUM; aggregates reduce their arg. */
function aggSql(e: Expr, mapName: NameMapper): string {
  switch (e.kind) {
    case 'num':
      return String(e.value);
    case 'col':
      return `SUM(${quoteIdent(mapName(e.name))})`;
    case 'agg':
      return `${e.op.toUpperCase()}(${rowSql(e.arg, mapName)})`;
    case 'neg':
      return `(-(${aggSql(e.operand, mapName)}))`;
    case 'bin':
      return binSql(e.op, aggSql(e.left, mapName), aggSql(e.right, mapName));
  }
}

/**
 * The SQL expression a computed field aggregates to, for use as a GROUP BY measure. `mapName`
 * (default identity) rewrites each column name before quoting — used to qualify base columns
 * with a table alias in multi-table file joins.
 */
export function computedMeasureToSql(ast: Expr, mapName: NameMapper = (n) => n): string {
  return aggSql(ast, mapName);
}
