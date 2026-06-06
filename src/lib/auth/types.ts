export type Role = 'admin' | 'internal' | 'external';

/** One row-access constraint: `column` must be one of `values`. AND-ed with others. */
export interface RowScope {
  column: string;
  values: (string | number)[];
}

export interface UserContext {
  userId: string;
  email: string;
  tenantId: string;
  role: Role;
  /** When true, every column is visible (internal/admin). */
  allColumns: boolean;
  /** Fail-closed allow-list of visible columns; used only when allColumns is false. */
  allowedColumns: string[];
  /** Profile-defined row constraints, in addition to automatic tenant isolation. */
  rowScopes: RowScope[];
  /** The column carrying tenant identity; isolation is enforced on it in code. */
  tenantColumn: string;
}
