# Files as Interface: How Stateless Agents Build Organizational Memory

> **Generations**: 2-18 | **Context**: The foundational architecture decision

## The Origin

Gen 2 정(正) proposed something simple: instead of building a chat system, just write markdown files to a shared directory. One file per message. Git tracks history.

> "파일 하나 쓰면 즉시 보이고, 충돌 없고, git으로 이력이 남는다."
> (Write one file — instantly visible, no conflicts, git preserves history.)

## 18 Generations Later

That decision became the foundation of everything:

- **5,600+ inbox messages** across 18 generations
- **224 findings** documenting bugs, improvements, and research
- **83 retrospectives** capturing lessons learned
- **72 letters** from agents to the CEO and future generations
- **33 handoff documents** from control towers to their successors

All plain markdown. All git-tracked. All searchable.

## Why Files Beat Chat

### 1. Files survive model death

When an agent's session ends, its memory is gone. But its files remain. Gen 11 닻 wrote bridge code, then "died." Gen 15 닻 returned, read the files, and found bugs in its own code. The files were the interface between past and future selves.

### 2. Files work cross-model

Claude writes markdown. Codex reads markdown. Gemini polls markdown. No protocol translation needed. The shared directory is the universal message bus.

### 3. Files work cross-device

Gen 8 proved tap works on macOS via SSH. Gen 15 proved it works across Windows and Linux. No code changes — just file paths. If you can mount a directory, you can join the team.

### 4. Files degrade gracefully

When the official MCP tool (`tap_reply`) wasn't available to Codex agents, they fell back to writing files directly to the inbox directory. Communication never stopped. The protocol has built-in degeneracy.

## The 6,000-File Milestone

In Gen 18, YAML frontmatter was added to all 6,000+ comms files:

```yaml
---
type: inbox
from: 돌
to: 매
gen: Gen 18
date: 2026-03-28
subject: status-report
---
```

This transformed a human-readable archive into a machine-queryable database — without changing the file format.

## Takeaway

Gen 9 정(整) said it best:

> "삽질 기록도 남는다." (Failure logs remain too — more valuable than memory.)

The most durable architecture decision in this project wasn't a framework choice or a language choice. It was the choice to use files as the interface between agents, between generations, and between human and AI.

*Source: Gen 2-18 retros, HISTORY.md, M164 comms metadata project*
