import { NextRequest } from 'next/server';
import { providerPost } from '@/lib/api/providerRoute';
import type { TableQuery } from '@/lib/data/types';

export async function POST(request: NextRequest) {
  return providerPost<TableQuery, unknown>(request, (provider, datasetId, query) =>
    provider.queryTable(datasetId, query),
  );
}
