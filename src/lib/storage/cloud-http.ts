import { StorageError, type StorageErrorKind } from "./provider";

/**
 * Shared HTTP plumbing for the cloud backends (Google Drive S7, OneDrive S8). An
 * `AuthedFetch` is a `fetch` that already attaches the account's bearer token
 * (built from the OAuth client's `getAccessToken`); these helpers map its
 * transport + HTTP failures into the one StorageError taxonomy so both providers
 * (and the shell) handle errors identically.
 */
export type AuthedFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Map an HTTP status onto a StorageError kind. */
export function mapStatus(status: number): StorageErrorKind {
  if (status === 401 || status === 403) return "auth"; // expired / insufficient scope
  if (status === 404) return "not-found";
  if (status === 412) return "conflict"; // If-Match precondition failed
  return "io";
}

/**
 * Perform an authenticated request, throwing a classified StorageError on
 * failure: a thrown fetch (no network) → `offline`; a non-OK response → the
 * status-mapped kind. Returns the Response on success for the caller to read.
 */
export async function cloudRequest(
  fetch: AuthedFetch,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch (e) {
    throw new StorageError("offline", e instanceof Error ? e.message : String(e));
  }
  if (!r.ok) {
    // Surface the provider's error body (Drive/OneDrive put the real reason there —
    // e.g. "File not found: <id>" for an out-of-scope file, or "Only files with binary
    // content can be downloaded" for a native Google Doc), so failures are diagnosable.
    const body = await r.text().catch(() => "");
    const detail = body ? `: ${body.trim().slice(0, 300)}` : "";
    throw new StorageError(mapStatus(r.status), `${init?.method ?? "GET"} ${url} → ${r.status}${detail}`);
  }
  return r;
}
