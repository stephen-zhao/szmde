import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";

/**
 * Parse YAML/TOML-style frontmatter — a `---` … `---` block at the very start
 * of the document — as a single `Frontmatter` node. Without this, CommonMark
 * reads `key: value` followed by `---` as a setext heading, so a Claude-skill
 * style preamble renders as a giant heading. Recognizing it as one block lets
 * us style it as muted preamble instead (SPEC §5.4 front-matter, brought
 * forward because it's a correctness bug, not just a nicety).
 */
export const Frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: "Frontmatter", block: true },
    { name: "FrontmatterMark" },
  ],
  parseBlock: [
    {
      name: "Frontmatter",
      // Run before HorizontalRule (and thus before SetextHeading) so the
      // leading `---` is claimed as frontmatter, not a thematic break/heading.
      before: "HorizontalRule",
      parse(cx: BlockContext, line: Line): boolean {
        // Only at the very top of the document.
        if (cx.lineStart !== 0 || line.text.trim() !== "---") return false;

        const start = cx.lineStart;
        const children = [cx.elt("FrontmatterMark", start, start + line.text.length)];
        let end = start + line.text.length;

        while (cx.nextLine()) {
          const lineEnd = cx.lineStart + line.text.length;
          end = lineEnd;
          const t = line.text.trim();
          if (t === "---" || t === "...") {
            children.push(cx.elt("FrontmatterMark", cx.lineStart, lineEnd));
            cx.nextLine(); // move past the closing fence
            cx.addElement(cx.elt("Frontmatter", start, end, children));
            return true;
          }
        }

        // No closing fence yet (e.g. mid-typing): treat the leading block as
        // frontmatter to EOF, mirroring fenced-code behavior for a missing close.
        cx.addElement(cx.elt("Frontmatter", start, end, children));
        return true;
      },
    },
  ],
};
