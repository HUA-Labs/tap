# Review Instructions

Use these instructions when reviewing pull requests in this repository.

## Primary Goal

Prioritize real correctness issues over style opinions.
Focus on behavioral bugs, regressions, mismatches between implementation and reported behavior, and missing verification.

## Review Priorities

1. Report real bugs first, ordered by severity.
2. Prefer findings that can be reproduced locally.
3. Compare claimed behavior with actual behavior.
4. Keep summaries short after the findings.

## Local Context To Read First

Before starting a substantial review, check repository-local guidance if it exists.

Priority order:

1. `AGENTS.md`
2. `CLAUDE.md`
3. Relevant files under `.claude/agents/`
4. Relevant files under `.claude/skills/`
5. Relevant files under `.claude/memory/`

Use them as contextual guidance, especially when they contain repository-specific workflows, review heuristics, architecture notes, or validation commands.
Do not bulk-read everything by default.
Read only the documents that are relevant to the current review scope.

## What To Check

- Diff behavior against `origin/main...<branch>` for the requested review scope.
- Runtime behavior, not just static code shape.
- Target-specific behavior when code supports multiple targets.
- Consistency between:
  - capability metadata
  - resolver output
  - adapter behavior
  - `dot()` output
  - `dotExplain()` output
  - tests

## Required Verification Mindset

When a change touches value mapping, adapters, parsing, or capability matrices, actively verify representative cases instead of relying only on reading code.

Check combinations such as:

- supported case
- approximate case
- unsupported case
- `!important`
- arbitrary values
- parser-sensitive strings such as `rgba(...)`, `color-mix(...)`, gradients, and comma-containing values
- target-specific output differences

## False Positive Control

To reduce false positives:

- Do not report a finding unless there is a concrete reason it is likely real.
- Prefer findings with a reproduction input and observed output.
- If possible, include:
  - the input
  - the actual output
  - the expected output
- If a concern is only theoretical, label it clearly as a risk or open question, not as a bug.
- Do not assume a matrix value is wrong unless adapter behavior or runtime output disagrees with it.
- Do not assume a test passes unless it was actually run or the limitation was stated explicitly.

## Preferred Review Output

- Findings first
- Each finding should include:
  - severity
  - file reference
  - short explanation
  - reproduction when available
- Then add brief residual risks or testing gaps

## Repository-Specific Guidance

This repository contains code with combinatorial behavior across multiple targets.
Be especially strict about consistency checks for:

- capability matrices
- adapter drops vs passthrough behavior
- `dotExplain()` reporting
- parser edge cases
- value normalization such as `!important`

When available, also consult repository notes from `CLAUDE.md` and relevant `.claude` documents before reviewing target-heavy code such as adapters, parsers, gradients, or capability systems.
