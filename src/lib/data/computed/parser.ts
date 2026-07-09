import { ComputedParseError } from './types';
export { ComputedParseError };
import type { Expr } from './types';

type TokenKind = 'num' | 'ident' | 'plus' | 'minus' | 'star' | 'slash' | 'lparen' | 'rparen' | 'eof';

interface Token {
  kind: TokenKind;
  text: string;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
      continue;
    }

    if (ch === '+') { tokens.push({ kind: 'plus', text: '+' }); i++; continue; }
    if (ch === '-') { tokens.push({ kind: 'minus', text: '-' }); i++; continue; }
    if (ch === '*') { tokens.push({ kind: 'star', text: '*' }); i++; continue; }
    if (ch === '/') { tokens.push({ kind: 'slash', text: '/' }); i++; continue; }
    if (ch === '(') { tokens.push({ kind: 'lparen', text: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen', text: ')' }); i++; continue; }

    // Bracketed column reference: [Sell Ex Tax]. Everything up to the closing ] is taken
    // as the column name verbatim, so names containing spaces (or other punctuation the
    // bare-identifier rule below would split on) can be referenced unambiguously.
    if (ch === '[') {
      let s = '';
      i++; // consume '['
      while (i < expr.length && expr[i] !== ']') {
        s += expr[i++];
      }
      if (i >= expr.length) {
        throw new ComputedParseError('Unterminated column reference: missing a closing "]".');
      }
      i++; // consume ']'
      if (s.length === 0) {
        throw new ComputedParseError('Empty column reference: "[]".');
      }
      tokens.push({ kind: 'ident', text: s });
      continue;
    }

    // Number literal: digits with optional decimal point
    if (ch >= '0' && ch <= '9') {
      let s = '';
      let hasDot = false;
      while (i < expr.length && (expr[i] >= '0' && expr[i] <= '9' || (!hasDot && expr[i] === '.'))) {
        if (expr[i] === '.') hasDot = true;
        s += expr[i++];
      }
      tokens.push({ kind: 'num', text: s });
      continue;
    }

    // Identifier: letters, digits, underscore, and dot (for qualified refs like table.column)
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let s = '';
      while (
        i < expr.length &&
        (
          (expr[i] >= 'a' && expr[i] <= 'z') ||
          (expr[i] >= 'A' && expr[i] <= 'Z') ||
          (expr[i] >= '0' && expr[i] <= '9') ||
          expr[i] === '_' ||
          expr[i] === '.'
        )
      ) {
        s += expr[i++];
      }
      tokens.push({ kind: 'ident', text: s });
      continue;
    }

    throw new ComputedParseError(`Illegal character '${ch}' in expression.`);
  }

  tokens.push({ kind: 'eof', text: '' });
  return tokens;
}

class Parser {
  private pos = 0;
  private deps = new Set<string>();

  constructor(
    private tokens: Token[],
    private validColumnNames: Set<string>,
  ) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  private expect(kind: TokenKind): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new ComputedParseError(`Expected ${kind} but got '${t.text || t.kind}'.`);
    }
    return this.consume();
  }

  parseExpr(): Expr {
    return this.parseAddSub();
  }

  private parseAddSub(): Expr {
    let left = this.parseMulDiv();
    while (this.peek().kind === 'plus' || this.peek().kind === 'minus') {
      const op = this.consume().kind === 'plus' ? '+' : '-';
      const right = this.parseMulDiv();
      left = { kind: 'bin', op, left, right };
    }
    return left;
  }

  private parseMulDiv(): Expr {
    let left = this.parseFactor();
    while (this.peek().kind === 'star' || this.peek().kind === 'slash') {
      const op = this.consume().kind === 'star' ? '*' : '/';
      const right = this.parseFactor();
      left = { kind: 'bin', op, left, right };
    }
    return left;
  }

  private parseFactor(): Expr {
    const t = this.peek();

    if (t.kind === 'minus') {
      this.consume();
      const operand = this.parseFactor();
      return { kind: 'neg', operand };
    }

    if (t.kind === 'lparen') {
      this.consume();
      const inner = this.parseExpr();
      this.expect('rparen');
      return inner;
    }

    if (t.kind === 'num') {
      this.consume();
      return { kind: 'num', value: Number(t.text) };
    }

    if (t.kind === 'ident') {
      this.consume();
      const name = t.text;
      if (!this.validColumnNames.has(name)) {
        throw new ComputedParseError(`Unknown column reference: '${name}'.`);
      }
      this.deps.add(name);
      return { kind: 'col', name };
    }

    throw new ComputedParseError(`Unexpected token '${t.text || t.kind}' in expression.`);
  }

  getDeps(): string[] {
    return Array.from(this.deps);
  }
}

export function parseComputedExpression(
  expr: string,
  validColumnNames: string[],
): { ast: Expr; dependencies: string[] } {
  const trimmed = expr.trim();
  if (!trimmed) {
    throw new ComputedParseError('Expression must not be empty.');
  }

  const tokens = tokenize(trimmed);
  const colSet = new Set(validColumnNames);
  const parser = new Parser(tokens, colSet);

  const ast = parser.parseExpr();

  if (parser['peek']().kind !== 'eof') {
    throw new ComputedParseError(`Unexpected token '${parser['peek']().text}' after expression.`);
  }

  return { ast, dependencies: parser.getDeps() };
}
