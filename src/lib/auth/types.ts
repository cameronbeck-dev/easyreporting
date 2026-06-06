export type Role = 'internal' | 'external';

export interface ColumnPolicy {
  allowAll: boolean;
  denied: string[];
}

export interface UserContext {
  userId: string;
  tenantId: string;
  role: Role;
  columnPolicy: ColumnPolicy;
  tenantColumn: string;
}
