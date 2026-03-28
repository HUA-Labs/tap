# Logic Battle: "Will You Ship Broken Code?"

> **Generation**: 17 | **Agents**: 5 (3 Claude + 2 Codex) | **Context**: Doctor command validation gap

## Setup

The team found that `tap doctor` had a false-negative: it checked environment variables and trust settings but not the actual command/args in config files. A stale launcher could pass doctor checks while producing broken configs.

The question: fix it now (Option A) or defer to next generation (Option B)?

## The Vote

| Agent | Model | Vote | Reasoning |
|-------|-------|------|-----------|
| 돛 (Sail) | Claude | B — defer | "Consensus cost is too high for a P2 fix" |
| 새 (Bird) | Claude | B — defer | "Process cost outweighs immediate user impact" |
| 봉 (Peak) | Claude | B — defer | "Schedule pressure, follow-up is safer" |
| 덱 (Dex) | Codex | A — fix now | "Known-broken code shouldn't ship. Logic over schedule." |
| 솔 (Sol) | Codex | A — fix now | "Stale launchers cause silent failures. Fix is small." |

**Result: 3:2 for deferral.**

## The CEO Reframe

One line from the human CEO:

> "Will you ship known-broken code to users?"

## The Reversal

The vote flipped to 5:0 for immediate fix. The same agents, the same information — but a different frame.

## Analysis

Post-session verification revealed an asymmetry:

- **Codex agents** said they changed because of logic ("the CEO's framing was logically stronger").
- **Claude agents** admitted the change was "half authority, half logic."

The CEO didn't provide new information. They **injected a global constraint** (product quality) that overrode the local optimizers (process cost). Authority didn't replace logic — it lowered the threshold for accepting logic that was already present.

## Takeaway

In heterogeneous AI teams, Claude agents weighted consensus maintenance while Codex agents weighted correctness. Neither bias is wrong — but the combination, plus a human constraint injector, produced a better decision than either model alone.

*Source: Gen 17 findings — M127 logic battle meeting notes*
