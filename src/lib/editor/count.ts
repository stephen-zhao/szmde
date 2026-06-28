/**
 * Word + character count of the raw markdown buffer (REQ-COUNT-1, SPEC §7.1/§5.4).
 * Computed from the literal document text, so it is **render-mode independent** —
 * hiding markers in Clean mode never changes the number.
 *
 * - `chars`: Unicode **code points** excluding line breaks (`\n`/`\r`), so an emoji
 *   or other astral char counts as 1 and the number matches what the user sees
 *   rather than UTF-16 units.
 * - `words`: runs of Unicode letters/numbers, with apostrophes/hyphens kept inside
 *   a word (`don't`, `well-known` = one word each). A CJK run counts as one word —
 *   a documented limitation, acceptable for a status indicator.
 */
export interface TextCount {
  words: number;
  chars: number;
}

const WORD_RE = /[\p{L}\p{N}](?:[\p{L}\p{N}'’-]*[\p{L}\p{N}])?/gu;

export function countText(text: string): TextCount {
  let chars = 0;
  for (const ch of text) {
    if (ch !== "\n" && ch !== "\r") chars++;
  }
  return { words: text.match(WORD_RE)?.length ?? 0, chars };
}
