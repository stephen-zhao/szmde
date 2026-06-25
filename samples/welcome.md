---
name: welcome
description: A Claude-skill-style preamble — should render as muted metadata, not a heading
version: 0.1
---

# Welcome to szmde

A quick tour of what the **M0** editor renders today. Open this with **Ctrl+O**
(or `szmde samples/welcome.md` from a shell).

## Inline formatting

This paragraph has **bold**, *italic*, ~~strikethrough~~, and `inline code`.
Here is a [link](https://example.com) too.

## Lists

- First bullet
- Second bullet
  - Nested bullet
  - Another nested one
- Third bullet

1. Ordered one
2. Ordered two
3. Ordered three

- [ ] An unchecked task
- [x] A completed task

## Blockquote

> A normal blockquote spanning
> a couple of lines.

## Code blocks

A short block:

```ts
const greeting = "hello";
console.log(greeting);
```

A block with a deliberately long line — toggle **Wrap code blocks** in the
hamburger menu to compare. When wrapped, continuation rows hang inward so you
can tell a soft wrap from a real new line; when unwrapped, the block scrolls
horizontally instead:

```js
const config = { theme: "dark", accent: "#7c9cff", fontFamily: "Inter", wrap: true, tabWidth: 2, message: "this single line is intentionally very long so that it must either wrap or scroll horizontally inside the code block" };
```

## Table

| Feature      | Status |
| ------------ | ------ |
| Bold/italic  | ✓      |
| Code blocks  | ✓      |
| Tables       | ✓      |

---

That's the M0 surface. The full WYSIWYG live-preview (hidden markers, the three
render modes) and the EOL/indentation widgets arrive in M1.
