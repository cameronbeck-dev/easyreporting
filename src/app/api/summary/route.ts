import { NextRequest } from 'next/server';
import { providerPost } from '@/lib/api/providerRoute';
import type { SummaryQuery } from '@/lib/data/types';

export async function POST(request: NextRequest) {
  return providerPost<SummaryQuery, unknown>(request, (provider, datasetId, query) =>
    provider.querySummary(datasetId, query),
  );
}
