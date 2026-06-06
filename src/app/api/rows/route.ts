import { NextRequest } from 'next/server';
import { providerPost } from '@/lib/api/providerRoute';
import type { RowsQuery } from '@/lib/data/types';

export async function POST(request: NextRequest) {
  return providerPost<RowsQuery, unknown>(request, (provider, datasetId, query) =>
    provider.queryRows(datasetId, query),
  );
}
