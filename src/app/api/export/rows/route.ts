import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/auth/getUserContext';
import { getProvider } from '@/lib/data/getProvider';
import { errorResponse } from '@/lib/api/providerRoute';
import { rowsToCsv, MAX_EXPORT_ROWS } from '@/lib/data/export/toCsv';
import type { Filter } from '@/lib/data/types';

/**
 * Export the current, filtered rows view as a CSV attachment.
 *
 * Deliberately shares the exact resolution path as the JSON data routes
 * (`getUserContext` → `getProvider` → `AccessControlledProvider`), so tenant
 * isolation, row scopes, and the column allow-list apply identically to an
 * export — there is no second, weaker path to the data. Client-supplied filters
 * are appended to (never replace) the injected security filters, just as on the
 * `/api/rows` route.
 */
export async function POST(request: NextRequest) {
  try {
    const { datasetId, filters } = (await request.json()) as {
      datasetId: string;
      filters?: Filter[];
    };
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const provider = await getProvider(ctx, datasetId);
    const result = await provider.queryRows(datasetId, {
      filters: filters ?? [],
      page: 1,
      pageSize: MAX_EXPORT_ROWS,
    });

    const csv = rowsToCsv(result);
    const truncated = result.total > result.rows.length;
    const safeName = datasetId.replace(/[^a-zA-Z0-9._-]/g, '_') || 'export';

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}.csv"`,
        'X-Export-Truncated': truncated ? 'true' : 'false',
        'X-Export-Row-Count': String(result.rows.length),
        'X-Export-Total': String(result.total),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
