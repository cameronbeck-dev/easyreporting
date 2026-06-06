/** One row-access constraint: `column` must be one of `values`. AND-ed with others. */
export interface RowScope {
  column: string;
  values: (string | number)[];
}

export interface UserContext {
  userId: string;
  email: string;
  tenantId: string;
  /** Grants the admin UI. Reach is derived: see isPlatformAdmin. */
  isAdmin: boolean;
  /** True when this admin's tenant is the platform/owner tenant (cross-tenant reach). */
  isPlatformAdmin: boolean;
  /** When true, every column is visible. */
  allColumns: boolean;
  /** Fail-closed allow-list of visible columns; used only when allColumns is false. */
  allowedColumns: string[];
  /** Profile-defined row constraints, in addition to automatic tenant isolation. */
  rowScopes: RowScope[];
  /** The column carrying tenant identity; isolation is enforced on it in code. */
  tenantColumn: string;
}
