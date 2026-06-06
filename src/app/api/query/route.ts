import { NextRequest } from 'next/server';
import { providerPost } from '@/lib/api/providerRoute';
import type { AggregatedQuery } from '@/lib/data/types';

export async function POST(request: NextRequest) {
  return providerPost<AggregatedQuery, unknown>(request, (provider, datasetId, query) =>
    provider.queryAggregated(datasetId, query),
  );
}
