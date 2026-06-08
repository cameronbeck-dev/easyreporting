import { Aggregation } from '../types';

export interface ComputedField {
  name: string;
  type: 'number';
  expression: string;
  dependencies: string[];
}

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'col'; name: string }
  | { kind: 'neg'; operand: Expr }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: Expr; right: Expr };

export const COMPUTED_ROW_CAP = 100_000;

export class ComputedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComputedParseError';
  }
}

export class ComputedRowCapError extends Error {
  constructor(cap: number) {
    super(`Computed field aggregation requires fetching all rows but the dataset exceeds the ${cap.toLocaleString()} row cap.`);
    this.name = 'ComputedRowCapError';
  }
}

export function aggregateComputedValues(values: (number | null)[], agg: Aggregation): number {
  const nums = values.filter((v): v is number => v !== null);
  if (agg === Aggregation.Count) return nums.length;
  if (nums.length === 0) return 0;
  if (agg === Aggregation.Sum) return nums.reduce((a, b) => a + b, 0);
  if (agg === Aggregation.Avg) return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (agg === Aggregation.Min) return Math.min(...nums);
  if (agg === Aggregation.Max) return Math.max(...nums);
  return 0;
}
