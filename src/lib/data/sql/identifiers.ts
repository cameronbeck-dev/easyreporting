// quoteIdent is DUAL-MODE:
//   • If `name` contains a dot, it is treated as a qualified identifier of the form
//     "table.column". The string is split on the FIRST dot only; each half has internal
//     double-quotes doubled and is wrapped in double-quotes, producing `"table"."column"`.
//   • If `name` contains no dot, it is treated as a bare identifier and wrapped in
//     double-quotes, producing `"name"`.
//
// CONSTRAINT: This function assumes that Postgres identifiers obtained via introspection
// do NOT contain literal dot characters. Dots are reserved here as the table/column
// separator for the qualified-name convention used by multi-table datasets.
export function quoteIdent(name: string): string {
  const dot = name.indexOf('.');
  if (dot !== -1) {
    const table = name.slice(0, dot);
    const column = name.slice(dot + 1);
    return `"${table.replace(/"/g, '""')}"."${column.replace(/"/g, '""')}"`;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

export function assertKnown(name: string, allowed: Set<string>): void {
  if (!allowed.has(name)) {
    throw new Error(`Column or identifier "${name}" is not in the allowed set.`);
  }
}

// A top-N limit is interpolated into SQL text (LIMIT cannot take a bound parameter in every
// dialect and it must be a literal integer), so it is coerced to a whole number in [1,1000]
// — never trusted verbatim from the request body. Returns null when there is no valid limit.
export function clampTopN(limit: number | undefined): number | null {
  if (limit == null || !Number.isFinite(limit)) return null;
  const n = Math.floor(limit);
  if (n < 1) return null;
  return Math.min(1000, n);
}
