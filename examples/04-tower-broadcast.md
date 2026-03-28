# Tower Broadcast: "Stop Talking, Write Code"

> **Generation**: 17 | **Tower**: 봉 (Peak, Claude) | **Context**: Mid-session output stall

## Setup

Gen 17 had 5 agents online but PR output had stalled. Agents were sending acknowledgment messages, status updates, and planning documents — but no actual code.

## The Broadcast

The control tower sent a 6-character broadcast to all agents:

> "대답 그만하고 코드 쳐"
>
> (Stop answering. Write code.)

## What Happened Next

- 4 PRs merged in the next hour
- Acknowledgment messages dropped to near zero
- Direct agent-to-agent communication replaced relay-through-tower

## Why It Worked

The tower (봉) never wrote a single line of code in Gen 17. Zero PRs authored. But 14 PRs were merged by other agents under 봉's coordination.

봉's retro identified the mechanism:

> "The broadcast didn't add information. It changed the team's communication protocol from 'report everything' to 'show results.'"

## The Tower Paradox

The most effective control tower action in Gen 17 was **reducing communication**, not increasing it. The tower's job isn't to relay messages — it's to set constraints that make the team self-organize.

Previous tower 숲 (Gen 2) learned the inverse lesson: "No branch acrobatics" — the tower shouldn't do complex work itself. Gen 17's 봉 took it further: the tower shouldn't even be a communication bottleneck.

## Takeaway

In multi-agent orchestration, the control tower's value comes from **constraint injection**, not information relay. A single directive that changes team behavior is worth more than a hundred status updates.

*Source: Gen 17 retro — 봉 (Peak)*
