export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function assertKnown(name: string, allowed: Set<string>): void {
  if (!allowed.has(name)) {
    throw new Error(`Column or identifier "${name}" is not in the allowed set.`);
  }
}
