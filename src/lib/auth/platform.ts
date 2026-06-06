// Which tenant is the platform owner (MGL). An admin in this tenant is an "owner
// admin" with reach across every tenant; an admin in any other tenant is scoped to
// their own company. Configurable per deployment so nothing is hardcoded — set
// PLATFORM_TENANT_ID in the environment; defaults to the demo tenant.
const DEFAULT_PLATFORM_TENANT = 'easyreporting';

export function getPlatformTenantId(): string {
  return process.env.PLATFORM_TENANT_ID?.trim() || DEFAULT_PLATFORM_TENANT;
}

export function isPlatformTenant(tenantId: string): boolean {
  return tenantId === getPlatformTenantId();
}
