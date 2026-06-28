/**
 * Find & replace capture-group references (REQ-FR-2).
 *
 * `@codemirror/search` substitutes capture groups in a regexp replacement using
 * the JS `$1` / `$&` / `$$` syntax — it does NOT understand the backslash form
 * `\1`. szmde accepts BOTH: this converts the backslash form to the dollar form
 * before the query runs, so `\1` works just like `$1`.
 *
 * Only `\` followed by digit(s) is rewritten. The replacement escapes CM already
 * handles — `\n` `\r` `\t` `\\` — are left untouched, and an escaped backslash
 * (`\\1`) is preserved as a literal backslash followed by `1` (NOT a group ref).
 */
export function toDollarGroups(replace: string): string {
  // Alternation order matters: consume an escaped backslash (`\\`) first so the
  // digit after it is NOT treated as a group reference.
  return replace.replace(/\\\\|\\(\d+)/g, (m, digits) => (digits != null ? "$" + digits : m));
}
