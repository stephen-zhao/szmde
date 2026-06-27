import { cloudRequest, type AuthedFetch } from "./cloud-http";
import type {
  Capabilities,
  ReadResult,
  Revision,
  StorageProvider,
  WriteResult,
} from "./provider";

/**
 * Google Drive backend (REQ-CLOUD-1, SPEC §6) over an injected authenticated
 * `fetch` (which attaches the OAuth bearer token — S6). Drive is id-addressed,
 * not path-addressed, so this provider's `path` argument is a **Drive file id**;
 * mapping human names → ids (account browsing / file picker) is a separate,
 * deferred concern (not a v1 deliverable). The revision is the response `ETag`,
 * sent back as `If-Match` for optimistic-concurrency conflict detection.
 *
 * The request/response/error mapping is unit-tested with a mocked fetch; the live
 * OAuth + network behavior (incl. Drive's exact ETag/If-Match semantics) is the
 * integration tail, verified by an LLM workflow once credentials are wired.
 */
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export class GoogleDriveProvider implements StorageProvider {
  readonly id = "gdrive";
  readonly capabilities: Capabilities = { conflictDetection: true, list: false, watch: false };

  #fetch: AuthedFetch;
  constructor(fetch: AuthedFetch) {
    this.#fetch = fetch;
  }

  async read(fileId: string): Promise<ReadResult> {
    const r = await cloudRequest(this.#fetch, `${API}/files/${encodeURIComponent(fileId)}?alt=media`);
    const content = await r.text();
    return { content, rev: r.headers.get("etag") };
  }

  async stat(fileId: string): Promise<Revision> {
    const r = await cloudRequest(this.#fetch, `${API}/files/${encodeURIComponent(fileId)}?fields=id`);
    return r.headers.get("etag");
  }

  async write(fileId: string, content: string, expectedRev?: Revision): Promise<WriteResult> {
    const headers: Record<string, string> = { "Content-Type": "text/markdown" };
    if (expectedRev != null) headers["If-Match"] = expectedRev; // optimistic concurrency
    const r = await cloudRequest(
      this.#fetch,
      `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media`,
      { method: "PATCH", headers, body: content },
    );
    // Prefer the response ETag; fall back to a metadata stat if it's absent.
    return { rev: r.headers.get("etag") ?? (await this.stat(fileId)) };
  }
}
