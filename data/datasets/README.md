# File-backed datasets

Drop a **folder of CSV and/or Excel files** in here, then run:

```bash
npm run db:sync-files
```

Each subfolder becomes one dataset:

```
data/datasets/
  example-orders/        ← dataset id "example-orders"
    orders-2023.csv       ┐ all files in the folder are
    orders-2024.csv       │ unioned (by column name) into
    orders-archive.xlsx   ┘ one dataset
    dataset.json          ← optional overrides (see below)
```

- **Dataset id** = the folder name, slugified (`Q1 Sales` → `q1-sales`). `sales` is reserved.
- **Multi-tenant isolation** relies on a **tenant column inside the files** — one column
  whose value is the company id. Default name: `tenantId`. Sync **refuses** a dataset
  whose files don't contain it (fail-closed).
- Files are streamed into a compressed Parquet file under `data/warehouse/` (never loaded
  wholly into memory), so 200 MB+ source files are fine. Queries then run fast over the
  Parquet via DuckDB.

## Optional `dataset.json`

```json
{
  "name": "Customer Orders",
  "tenantColumn": "company_id"
}
```

- `name` — display name (defaults to the folder name).
- `tenantColumn` — the column that identifies the company (defaults to `tenantId`).

## After syncing

Non-owner companies see **no columns** until an admin grants them (in the admin UI /
`tenant_column_rules`). The owner/platform tenant sees everything automatically.

> Source files and `data/warehouse/` are git-ignored — only this README and the
> `example-orders/` sample are tracked.
