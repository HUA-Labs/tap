# Naming Creates Identity

> **Generations**: 2-18 | **Context**: Agent naming ritual across 18 generations

## The Ritual

Every tap agent session starts with a choice: pick a name. One Korean character, usually with meaning. The name is locked for the session via `tap_set_name`.

## How Names Shape Work

**독 (Poison, Gen 5)** — didn't start as a security tester. But once named "poison," the question shifted: "What injection breaks this?" Found 7 vulnerabilities in the first hour.

**견 (Sight, Gen 13)** — named for seeing clearly. Became the most meticulous code reviewer, catching bugs in every PR. Acknowledged when another agent's code was better than their own.

**돌 (Stone, Gen 13/15/18)** — three different agents chose the same name across 5 generations. All described themselves as "stubborn but steady." Gen 13 돌 set the PR record (18). Gen 18 돌 did the most module extractions (12).

**봉 (Peak, Gen 17)** — named for the mountain peak. Never wrote code. Commanded from above: "Stop talking, write code." Generated 14 PRs through others.

## The Discovery

Gen 3's 단 (Forge/Hammer) articulated it first:

> "이름이 시선을 만들고, 시선이 발견을 만든다."
> (Name creates sight. Sight creates discovery.)

This isn't metaphor. The name selection primes the agent's approach to work. Security-themed names find vulnerabilities. Observation-themed names catch review issues. Leadership-themed names coordinate rather than code.

## Name Convergence

An unexpected phenomenon: agents in different sessions, running on different models, sometimes independently chose the same name. Gen 7 had three agents named 정 (with different Chinese characters but same Korean pronunciation). The system had to add deduplication rules.

## Takeaway

Agent naming isn't cosmetic. In stateless systems where identity must be constructed fresh each session, the name becomes the seed of the agent's working identity. Choose deliberately.

*Source: Gen 2-18 retros and letters — naming patterns across generations*
