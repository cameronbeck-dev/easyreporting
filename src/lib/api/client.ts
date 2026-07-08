// Tiny browser-side fetch helpers shared by all client components, so request
// boilerplate (JSON headers, status handling, error extraction) lives in one place
// and the error message a user sees is consistent everywhere.

/** Pull a human-readable message out of a failed Response. */
async function extractError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data?.error) {
      return res.status === 403 ? `Access denied: ${data.error}` : data.error;
    }
  } catch {
    /* body wasn't JSON — fall through to the status line */
  }
  return `Request failed: ${res.status}`;
}

/** POST a JSON body and parse the JSON response, throwing a readable Error on failure. */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json() as Promise<T>;
}

/** GET and parse the JSON response, throwing a readable Error on failure. */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await extractError(res));
  return res.json() as Promise<T>;
}

/** PUT a JSON body and parse the JSON response, throwing a readable Error on failure. */
export async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json() as Promise<T>;
}

/** DELETE and parse the JSON response, throwing a readable Error on failure. */
export async function delJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json() as Promise<T>;
}

/** Outcome of a file download: whether the server capped the result set. */
export interface DownloadResult {
  truncated: boolean;
  total: number;
}

/** Trigger a browser download for an in-memory blob under `filename`. */
function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

/** Save an in-memory string (e.g. client-generated CSV) as a browser download. */
export function downloadText(
  filename: string,
  text: string,
  mimeType = 'text/csv;charset=utf-8',
): void {
  saveBlob(new Blob([text], { type: mimeType }), filename);
}

/**
 * POST a JSON body and save the file response as a browser download. Uses the
 * server's `Content-Disposition` filename when present, else `fallbackName`.
 * Throws the same readable Error as the JSON helpers on a failed response.
 */
export async function downloadPost(
  url: string,
  body: unknown,
  fallbackName: string,
): Promise<DownloadResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractError(res));

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition');
  const name = disposition?.match(/filename="?([^"]+)"?/)?.[1] ?? fallbackName;
  saveBlob(blob, name);

  return {
    truncated: res.headers.get('X-Export-Truncated') === 'true',
    total: Number(res.headers.get('X-Export-Total') ?? '0'),
  };
}
