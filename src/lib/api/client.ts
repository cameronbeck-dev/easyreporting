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
