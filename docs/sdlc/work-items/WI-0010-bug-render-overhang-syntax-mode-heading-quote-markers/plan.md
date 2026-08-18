# Plan

- [x] Re-fixed with an in-flow inline-block pulled left by minus its own measured width: hangs in the gutter, baseline-aligned, flush, editable, no > mirroring. (The width was first applied by a post-layout plugin, which broke cursor gliding and was replaced by a decoration-baked offset — see BUG-CURSOR-GLIDE.)
