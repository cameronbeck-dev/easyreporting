// The tenant-identity column for the built-in CSV demo dataset and the default for
// any source that doesn't configure its own. SQL datasets carry their own
// tenantColumn (see datasets.tenantColumn); this is the fallback.
export const DEFAULT_TENANT_COLUMN = 'tenantId';
