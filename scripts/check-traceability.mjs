#!/usr/bin/env node
// Audits requirement <-> test traceability (T3).
//
//   - Every CATALOGUED (implemented) requirement must be tagged in >= 1 test.
//   - Every [REQ-*] tag in a test must be a known requirement ID.
//
// Source of truth is the szsdlc requirement entities under
// docs/sdlc/requirements/ (NOT the generated docs/requirements.md register).
// Requirements use szsdlc `file` layout, so each entity is a flat
// <REQ-NNNN>-<slug>.md file; a legacy <REQ-NNNN>-<slug>/entity.md directory is
// still accepted so the audit survives a layout flip. Each entity carries:
//   - a title beginning with the SEMANTIC id `REQ-<AREA>-<n>` (e.g. REQ-RENDER-1);
//     the szsdlc entity id itself is the opaque `REQ-NNNN`, which the semantic-id
//     regex below deliberately ignores (NNNN has no [A-Z] run).
//   - a `test_type:` naming its test tier(s), and — for requirements with no
//     deterministic automated test — a `**Coverage gap:**` line in the body.
//
// A requirement is a tracked GAP (not required to have a tagged test) when EITHER
// signal says so: it carries the `Coverage gap:` marker, OR its `test_type`
// declares no deterministic tier (only `none …` and/or `live`/WF — e.g. the WF-*
// live-workflow tests that were intentionally not migrated). Everything else is
// CATALOGUED and must have a tagged test.
//
// Exits non-zero on any mismatch so it can gate CI alongside `npm run test:coverage`.
// Run: node scripts/check-traceability.mjs   (or: npm run test:trace)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ID_RE = /REQ-[A-Z]+-\d+/g; // semantic ids only (REQ-AREA-N); ignores opaque REQ-NNNN
const SEM_RE = /REQ-[A-Z]+-\d+/; // single-match variant for an entity's own id
const idSet = (text) => new Set(text.match(ID_RE) ?? []);
const rel = (p) => relative(root, p).replace(/\\/g, "/");

// Deterministic (automatable) test tiers. A requirement declaring at least one of
// these in its `test_type` is expected to have a real vitest/cargo test tagged for
// it; `none …` / `live` tiers are not deterministic and mark tracked gaps.
const DETERMINISTIC_TIERS = new Set(["unit", "integration", "structure", "visual"]);

// --- Parse the requirement entities: classify each as catalogued (must have a
//     test) or gap (known-untested, allowed). --------------------------------
const reqDir = join(root, "docs/sdlc/requirements");
let entityDirs;
try {
  entityDirs = readdirSync(reqDir);
} catch {
  console.error(`Cannot read requirement entities under ${rel(reqDir)}; has the szsdlc register moved?`);
  process.exit(1);
}

const required = new Set(); // catalogued semantic ids that MUST have a tagged test
const gaps = new Set(); // known-untested semantic ids (allowed)
const malformed = []; // entity files we could not extract a semantic id from
let entityCount = 0;

for (const d of entityDirs) {
  // `file` layout: a flat <REQ-NNNN>-<slug>.md entity. `directory` layout
  // (legacy / other szsdlc types): a <REQ-NNNN>-<slug>/entity.md inside a dir.
  const p = join(reqDir, d);
  let entity;
  try {
    const st = statSync(p);
    if (st.isDirectory()) entity = join(p, "entity.md");
    else if (st.isFile() && d.endsWith(".md")) entity = p;
    else continue; // stray non-entity path — skip
  } catch {
    continue;
  }
  let txt;
  try {
    if (!statSync(entity).isFile()) continue;
    txt = readFileSync(entity, "utf8");
  } catch {
    continue; // directory with no entity.md — skip
  }
  entityCount++;

  // Split YAML frontmatter from the body.
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const front = m ? m[1] : "";
  const body = m ? m[2] : txt;

  const title = (front.match(/^title:\s*(.*)$/m) ?? [])[1] ?? "";
  const testType = ((front.match(/^test_type:\s*(.*)$/m) ?? [])[1] ?? "").trim();

  // The entity's own semantic id is the FIRST match in its title (never a body
  // cross-reference). Fall back to the body only if the title has none.
  const sem = (title.match(SEM_RE) ?? body.match(SEM_RE) ?? [])[0];
  if (!sem) {
    malformed.push(rel(entity));
    continue;
  }

  // A `test_type` base tier is the token before any "(" annotation or ";" note,
  // e.g. "none (integration; needs WSL)" -> "none", "integration (DOM)" -> "integration".
  const tiers = testType
    .split("+")
    .map((seg) => seg.trim().split("(")[0].split(";")[0].trim().toLowerCase());
  const hasDeterministicTest = tiers.some((t) => DETERMINISTIC_TIERS.has(t));
  const hasGapMarker = /Coverage gap:/.test(body);

  if (hasGapMarker || !hasDeterministicTest) gaps.add(sem);
  else required.add(sem);
}

if (malformed.length) {
  console.error(`\n✗ ${malformed.length} requirement entit(y/ies) have no semantic REQ-<AREA>-<n> id in the title/body:`);
  malformed.forEach((f) => console.error("   " + f));
  console.error("\nAdd the semantic id to the entity title so it can be traced to tests.");
  process.exit(1);
}
if (entityCount === 0) {
  console.error(`No requirement entities found under ${rel(reqDir)}; nothing to audit.`);
  process.exit(1);
}

// A tag may reference either a catalogued requirement or a tracked gap; both are known.
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
  console.error("\nFix the requirement entities (docs/sdlc/requirements/) or the test tags so they agree.");
  process.exit(1);
}
console.log(
  `✓ traceability OK — ${required.size} catalogued requirements all covered; ` +
    `${gaps.size} tracked gaps; ${tagged.size} IDs tagged across ${testFiles.length} test files.`,
);
