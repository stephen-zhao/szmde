import { cloudRequest, type AuthedFetch } from "./cloud-http";
import type {
  Capabilities,
  ReadResult,
  Revision,
  StorageProvider,
  WriteResult,
} from "./provider";

/**
 * OneDrive backend (REQ-CLOUD-2, SPEC §6) over Microsoft Graph, using the same
 * injected authenticated `fetch` + shared error mapping as Google Drive (S7) — the
 * two providers differ only in endpoints (Graph item content) and the write verb
 * (PUT). The provider's `path` is a Graph driveItem id; the revision is the item's
 * `ETag`, sent back as `If-Match` for optimistic-concurrency conflict detection.
 *
 * Unit-tested with a mocked fetch; the live OAuth + network + Graph ETag semantics
 * are the integration tail, verified by an LLM workflow once credentials are wired.
 */
const GRAPH = "https://graph.microsoft.com/v1.0";

export class OneDriveProvider implements StorageProvider {
  readonly id = "onedrive";
  readonly capabilities: Capabilities = { conflictDetection: true, list: false, watch: false };

  #fetch: AuthedFetch;
  constructor(fetch: AuthedFetch) {
    this.#fetch = fetch;
  }

  async read(itemId: string): Promise<ReadResult> {
    const r = await cloudRequest(
      this.#fetch,
      `${GRAPH}/me/drive/items/${encodeURIComponent(itemId)}/content`,
    );
    const content = await r.text();
    return { content, rev: r.headers.get("etag") };
  }

  async stat(itemId: string): Promise<Revision> {
    const r = await cloudRequest(
      this.#fetch,
      `${GRAPH}/me/drive/items/${encodeURIComponent(itemId)}?select=eTag`,
    );
    return r.headers.get("etag");
  }

  async write(itemId: string, content: string, expectedRev?: Revision): Promise<WriteResult> {
    const headers: Record<string, string> = { "Content-Type": "text/markdown" };
    if (expectedRev != null) headers["If-Match"] = expectedRev; // optimistic concurrency
    const r = await cloudRequest(
      this.#fetch,
      `${GRAPH}/me/drive/items/${encodeURIComponent(itemId)}/content`,
      { method: "PUT", headers, body: content },
    );
    return { rev: r.headers.get("etag") ?? (await this.stat(itemId)) };
  }
}
