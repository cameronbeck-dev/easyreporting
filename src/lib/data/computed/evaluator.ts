import type { Expr } from './types';

function coerceNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  return n;
}

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
  }
}
