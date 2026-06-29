#!/usr/bin/env node
// Audits requirement <-> test traceability (docs/requirements.md, T3).
//
//   - Every CATALOGUED (implemented) requirement must be tagged in >= 1 test.
//   - Every [REQ-*] tag in a test must be a known requirement ID.
//
// Exits non-zero on any mismatch so it can gate CI alongside `npm run test:coverage`.
// Run: node scripts/check-traceability.mjs   (or: npm run test:trace)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ID_RE = /REQ-[A-Z]+-\d+/g;
const idSet = (text) => new Set(text.match(ID_RE) ?? []);
const rel = (p) => relative(root, p).replace(/\\/g, "/");

// --- Parse the catalog: IDs before the gaps heading are REQUIRED to have a
//     test; IDs under the gaps heading are known-untested (allowed). ---------
const doc = readFileSync(join(root, "docs/requirements.md"), "utf8");
const gapHeading = "## Requirements with no automated test";
const gapIdx = doc.indexOf(gapHeading);
if (gapIdx === -1) {
  console.error("requirements.md: missing the gaps-section heading; cannot classify IDs.");
  process.exit(1);
}
const required = idSet(doc.slice(0, gapIdx));
const gaps = idSet(doc.slice(gapIdx));
const known = new Set([...required, ...gaps]);

// --- Collect [REQ-*] tags from every test file ----------------------------
const testFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (["node_modules", ".svelte-kit", "target", "build"].includes(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith(".test.ts")) testFiles.push(p);
  }
})(join(root, "src"));
testFiles.push(join(root, "src-tauri/src/lib.rs")); // Rust tests tagged via comments

const tagged = new Set();
const unknown = [];
for (const f of testFiles) {
  for (const id of idSet(readFileSync(f, "utf8"))) {
    tagged.add(id);
    if (!known.has(id)) unknown.push(`${id}  (${rel(f)})`);
  }
}

// --- Report ----------------------------------------------------------------
const missing = [...required].filter((id) => !tagged.has(id)).sort();
let ok = true;
if (missing.length) {
  ok = false;
  console.error(`\n✗ ${missing.length} catalogued requirement(s) have NO tagged test:`);
  missing.forEach((id) => console.error("   " + id));
}
if (unknown.length) {
  ok = false;
  console.error(`\n✗ ${unknown.length} test tag(s) reference an UNKNOWN requirement ID:`);
  unknown.forEach((u) => console.error("   " + u));
}
if (!ok) {
  console.error("\nFix docs/requirements.md or the test tags so they agree.");
  process.exit(1);
}
console.log(
  `✓ traceability OK — ${required.size} catalogued requirements all covered; ` +
    `${gaps.size} tracked gaps; ${tagged.size} IDs tagged across ${testFiles.length} test files.`,
);
