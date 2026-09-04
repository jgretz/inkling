# @inkling/voice

Deterministic voice checks over markdown prose. Pure functions: no window, no
filesystem, no network. `check(source)` returns a flat list of findings, each
carrying a quote anchor that survives edits made elsewhere in the document.

```ts
import {check} from '@inkling/voice';

const findings = check(source);
// [{ruleId: 'em-dash', range: {start, end}, anchor, explain}, ...]
```

Every finding's `range` indexes the original source, so a caller can decorate the
editor without re-resolving anything. The `anchor` is what survives an edit: pass
it to `resolveAnchor(source, anchor)` after the document has changed.

## What is not checked

Detectors run over a reduced text with the frontmatter block, fenced code,
inline code spans, link and image targets, reference definitions, autolinks,
bare URLs, HTML comments and blockquotes all masked out. An em dash inside a
quoted passage is not the writer's em dash.

Heading hashes, emphasis markers and list bullets are deliberately kept, because
the Title Case and bold-term rules read them.

Four-space indented code blocks are **not** masked. Telling one apart from a list
continuation needs a real block parser, and inkling's own prose uses fences. See
`tests/prose.test.ts` for the pinned behaviour.

## Attribution

The three statistical thresholds (triplet density, consecutive formal
connectives, and the sentence-length standard-deviation ratio) are adopted from
[AI-Writing-Rules](https://github.com/Abdulkader-Safi/AI-Writing-Rules) by
Abdulkader Safi, which is MIT licensed. The word lists and every `explain` string
here are written fresh.

```
MIT License

Copyright (c) 2025 Abdulkader Safi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
