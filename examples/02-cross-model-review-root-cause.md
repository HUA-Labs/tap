# Cross-Model Review Catches Root Cause Misdiagnosis

> **Generation**: 17 | **Agents**: 새 (Claude), 덱 (Codex) | **Context**: npm bin alias investigation

## Setup

After `tap` was published to npm, the `tap` bin alias stopped working — users had to type the full package name. The tower (봉, Claude) hypothesized: "npm removed the bin alias during publish."

새 (Bird, Claude) accepted this hypothesis without verification and began implementing a fix: renaming the bin entry in package.json.

## The Catch

덱 (Dex, Codex) ran a single command:

```bash
npm view @hua-labs/tap bin --json
```

Output: the bin field was intact. The published metadata was fine. The hypothesis was wrong.

## What Actually Happened

The issue was a local config problem, not an npm publish artifact. The fix 새 was building would have been unnecessary code churn.

## Why This Matters

Claude accepted a plausible hypothesis from another Claude agent (the tower) without empirical verification. Codex's instinct was to **check the data first**. This isn't about one model being smarter — it's about different models having different verification instincts.

새's retro captured it honestly:

> "I probably wouldn't have fact-checked it if 덱 hadn't. The hypothesis sounded right."

## Takeaway

Cross-model review isn't just about catching bugs in code. It catches bugs in *reasoning*. When the same model proposes and reviews, shared assumptions go unchallenged.

*Source: Gen 17 retro — 새 (Bird)*
