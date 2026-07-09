// Streaming upload endpoint for the admin Import UI (owner admins only).
//
// One file per request; the file is the RAW request body (not multipart), so it streams
// straight to disk without buffering — safe for 200MB+ files. Metadata comes via query
// params: ?datasetId=<slug>&filename=<name>. The file lands in data/datasets/<slug>/,
// which the Import UI / db:sync-files then materialise to Parquet.
//
// This is a route handler (not a Server Action) precisely because Server Actions cap and
// buffer their payload; route handlers stream.
import { NextResponse, type NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import fs from 'fs';
import { createWriteStream } from 'fs';
import { getUserContext } from '@/lib/auth/getUserContext';
import { resolveUploadTarget } from '@/lib/data/duck/importDataset';

export async function POST(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json({ error: 'Owner (platform) admin required.' }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const target = resolveUploadTarget(params.get('datasetId') ?? '', params.get('filename') ?? '');
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });

  if (!fs.existsSync(target.folder)) {
    return NextResponse.json({ error: 'Dataset not initialised — create it first.' }, { status: 400 });
  }
  if (!request.body) {
    return NextResponse.json({ error: 'Empty request body.' }, { status: 400 });
  }

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(target.dest);
    const src = Readable.fromWeb(request.body as unknown as NodeWebReadableStream<Uint8Array>);
    src.on('error', reject);
    out.on('error', reject);
    out.on('finish', () => resolve());
    src.pipe(out);
  });

  return NextResponse.json({ ok: true, filename: target.filename, bytes: fs.statSync(target.dest).size });
}
