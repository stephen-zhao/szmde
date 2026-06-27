import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { PostResult, TokenPoster } from "./oauth";
import type { AuthedFetch } from "./cloud-http";

/**
 * Cloud transport adapters over `@tauri-apps/plugin-http` (M3 L2). plugin-http's
 * `fetch` runs in Rust via reqwest — a native client, **not** subject to the
 * webview CORS wall — so it can reach Google's token endpoint and Drive REST,
 * which `window.fetch` cannot. These wrap that fetch into the exact seams the
 * tested core already expects: a `TokenPoster` for OAuthClient and an
 * `AuthedFetch` for GoogleDriveProvider. The real `fetch` is injectable so the
 * adapters are unit-testable; the default is the plugin-http one.
 */

/** A `TokenPoster` (x-www-form-urlencoded POST) over plugin-http. */
export function httpTokenPoster(doFetch: typeof tauriFetch = tauriFetch): TokenPoster {
  return async (url, form): Promise<PostResult> => {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null; // non-JSON error body — leave null, status carries the signal
    }
    return { ok: res.ok, status: res.status, body };
  };
}

/** An `AuthedFetch` that attaches a bearer token (from `getToken`) and egresses
 *  via plugin-http. */
export function bearerFetch(
  getToken: () => Promise<string>,
  doFetch: typeof tauriFetch = tauriFetch,
): AuthedFetch {
  return async (url, init) => {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return doFetch(url, { ...init, headers });
  };
}
