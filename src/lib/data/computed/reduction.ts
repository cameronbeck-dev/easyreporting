// How a computed field collapses a group of rows into one number — the distinction between a
// field that IS a total and one that only looks like it.
//
// This mirrors aggSql (see toSql.ts): at the aggregate level a bare column becomes SUM(col), a
// bare COALESCE becomes SUM(COALESCE(…)), and arithmetic combines those aggregate scalars. So:
//
//   [Sell] - [Cost]            → SUM(Sell) - SUM(Cost)                    a genuine total
//   ([Sell] - [Cost]) / [Sell] → (SUM(Sell) - SUM(Cost)) / SUM(Sell)      a ratio of totals
//   [Weight] / [Items]         → SUM(Weight) / SUM(Items)                 a weighted average
//
// The first is additive: adding two groups' values gives the combined group's value. The others
// are not — summing them is meaningless. Surfaces use this to label the two kinds differently
// instead of calling every computed field "calculated".
import type { Expr } from './types';

/** Whether a subtree references no columns at all, i.e. is a pure numeric scalar. */
function isLiteral(e: Expr): boolean {
  switch (e.kind) {
    case 'num':
      return true;
    case 'col':
      return false;
    case 'neg':
      return isLiteral(e.operand);
    case 'bin':
      return isLiteral(e.left) && isLiteral(e.right);
    case 'coalesce':
      return e.args.every(isLiteral);
    case 'agg':
      return false;
  }
}

function isAdditive(e: Expr): boolean {
  switch (e.kind) {
    case 'num':
      return true;
    // Both become SUM(…) at the aggregate level.
    case 'col':
    case 'coalesce':
      return true;
    case 'neg':
      return isAdditive(e.operand);
    // An explicit SUM(…) stays a total; AVG/MIN/MAX/COUNT do not.
    case 'agg':
      return e.op === 'sum';
    case 'bin':
      if (e.op === '+' || e.op === '-') return isAdditive(e.left) && isAdditive(e.right);
      // Scaling a total by a constant keeps it a total (kg → tonnes, a markup); combining two
      // aggregates multiplicatively does not.
      if (e.op === '*') {
        return (isLiteral(e.left) && isAdditive(e.right)) || (isAdditive(e.left) && isLiteral(e.right));
      }
      return isAdditive(e.left) && isLiteral(e.right);
  }
}

/** How a computed field reduces over a group: a true total, or a non-additive ratio/average. */
export type ComputedReduction = 'total' | 'ratio';

export function computedReduction(ast: Expr): ComputedReduction {
  return isAdditive(ast) ? 'total' : 'ratio';
}
