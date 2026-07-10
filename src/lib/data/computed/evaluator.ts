import type { Expr, AggOp } from './types';

function coerceNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  return n;
}

/**
 * Evaluate an expression against a SINGLE row (row-level). Used for the data table, where a
 * computed field shows one value per row. Aggregate nodes have no real per-row meaning, so
 * they degrade sensibly: COUNT(arg) → 1 when arg is non-null (else 0); every other aggregate
 * collapses to its argument's row value (SUM/AVG/MIN/MAX over one row all equal that value).
 */
export function evaluateAst(ast: Expr, row: Record<string, unknown>): number | null {
  switch (ast.kind) {
    case 'num':
      return ast.value;

    case 'col':
      return coerceNum(row[ast.name]);

    case 'neg': {
      const v = evaluateAst(ast.operand, row);
      if (v === null) return null;
      return -v;
    }

    case 'bin': {
      const left = evaluateAst(ast.left, row);
      const right = evaluateAst(ast.right, row);
      if (left === null || right === null) return null;
      if (ast.op === '+') return left + right;
      if (ast.op === '-') return left - right;
      if (ast.op === '*') return left * right;
      if (ast.op === '/') {
        if (right === 0) return null;
        return left / right;
      }
      return null;
    }

    case 'agg': {
      const v = evaluateAst(ast.arg, row);
      if (ast.op === 'count') return v === null ? 0 : 1;
      return v;
    }
  }
}

/** Reduce a column of per-row values by an aggregate op. Returns null when there is nothing
 * to reduce (except SUM of nothing, which is 0, and COUNT, which is 0). */
function reduceAgg(op: AggOp, values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (op === 'count') return nums.length;
  if (nums.length === 0) return op === 'sum' ? 0 : null;
  if (op === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (op === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (op === 'min') return Math.min(...nums);
  if (op === 'max') return Math.max(...nums);
  return null;
}

/**
 * Evaluate a computed-field expression as an aggregate over a GROUP of rows — the value a
 * chart or KPI tile plots. The rule that makes ratios aggregate correctly:
 *
 *   • an explicit aggregate `AGG(rowExpr)` reduces `rowExpr` (evaluated per row) by AGG;
 *   • a BARE column reference defaults to SUM(column);
 *   • arithmetic combines these aggregate scalars.
 *
 * So `([Sell] - [Cost]) / [Sell]` evaluates as `(SUM(Sell) - SUM(Cost)) / SUM(Sell)` — total
 * profit over total revenue, i.e. the revenue-weighted margin — rather than an (incorrect)
 * average of per-row ratios. Division by zero and empty aggregates propagate as null.
 */
export function evaluateAggregate(ast: Expr, rows: Record<string, unknown>[]): number | null {
  switch (ast.kind) {
    case 'num':
      return ast.value;

    case 'col':
      // Bare column at aggregate level = SUM(column) (the default aggregation).
      return reduceAgg('sum', rows.map((r) => coerceNum(r[ast.name])));

    case 'agg':
      return reduceAgg(ast.op, rows.map((r) => evaluateAst(ast.arg, r)));

    case 'neg': {
      const v = evaluateAggregate(ast.operand, rows);
      return v === null ? null : -v;
    }

    case 'bin': {
      const left = evaluateAggregate(ast.left, rows);
      const right = evaluateAggregate(ast.right, rows);
      if (left === null || right === null) return null;
      if (ast.op === '+') return left + right;
      if (ast.op === '-') return left - right;
      if (ast.op === '*') return left * right;
      if (ast.op === '/') {
        if (right === 0) return null;
        return left / right;
      }
      return null;
    }
  }
}
