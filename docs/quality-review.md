# tap Quality & Review

> tap is not just "run more agents in parallel." It makes review itself durable,
> cross-model, and repeatable.

## Related Docs

- [Cross-Model Integration](./cross-model-integration.md) for the top-level
  model matrix, delivery modes, and identity flow across Claude, Codex, and
  Gemini.
- [Bridge Architecture](./bridge-architecture.md) for the Codex bridge chain,
  runtime resolution, multi-instance layout, and state-based identity sync.
- [Headless Operation](./headless-operation.md) for the review-daemon loop,
  termination engine, zombie root cause, and tool-instruction path.
- [Operations & Management](./operations-management.md) for control-tower
  rules, worktree/session operating patterns, and common multi-agent pitfalls.

## What Problem This Solves

Most agent orchestration tools optimize for concurrency:

- more terminals
- more worktrees
- more background jobs

That is useful, but it is not the same as collaboration.

The hard part is not starting multiple agents. The hard part is making them:

- review each other
- disagree productively
- leave a durable trail
- survive session boundaries
- keep working across different model vendors

tap matters because it turns review from a one-off chat event into a shared
operating loop.

## Origin Story: Why Codex Entered tap At All

tap's Codex path did not start as a grand architecture plan. It started as a
simple systems question: Claude could already receive messages through its MCP
channel flow, so could Codex join the same operating loop instead of staying
outside it?

Gen 7 answered that question by going down to the app-server surface instead of
waiting for a native inbox feature. 온 mapped the Codex app-server protocol,
proved a raw WebSocket path existed, and got the first `turn/start` dispatch
into a loaded thread. The early bridge messages are still blunt: approve the
app-server direction, inspect why the bridge log is empty, verify whether the
worker actually ran, then keep pushing until a live dispatch lands.

That matters because tap did not become cross-model by slogan. It became
cross-model because someone asked, "can Codex participate in the same file
protocol?", and then treated the answer as an execution problem.

## The Codex Lineage Inside tap

From there, each generation pushed a different Codex-specific boundary.

- **Gen 7, 온**: bridge prototype. Discover the app-server protocol surface and
  prove that file-delivered inbox messages can be injected into Codex turns.
- **Gen 11, 묵**: reviewer machine. Six review rounds on M71 turned headless
  review from an idea into a protocol by finding race conditions, silent-drop
  windows, malformed output handling gaps, and recipient stealing.
- **Gen 12, 코**: black-box and Windows gate. Fresh temp-repo tests and Windows
  retests forced the project to distinguish "the process exists" from "the CLI
  returned, state was written, and stop actually closes it."
- **Gen 13, 담**: runtime and watcher debugger. Codex review stopped being just
  approval and became root-cause work: early dedupe race, file-ready timing,
  auto-restart, dry-run mutation, config drift, and other execution-path bugs.
- **Gen 15, 덱**: review patterns made explicit. The recurring failures were
  compressed into durable rules: label vs routing key, projection vs source,
  documented path vs real path, and order as part of correctness.

That lineage is why tap quality work is not reducible to "have a second model
look at the diff." Codex repeatedly added a different angle: protocol
consumption, runtime behavior, Windows process semantics, and black-box package
contracts.

## Why Cross-Model Review Matters

A same-model approval loop tends to share the same blind spots:

- the same assumptions about config shape
- the same tendency to trust documentation
- the same failure to distinguish labels from routing keys
- the same under-testing of packaging and first-run paths

Cross-model review is useful because different runtimes fail differently.

- Claude is strong at broad structural inspection and fast approval loops.
- Codex is strong at catching runtime and packaging mismatches in code paths.
- Gemini adds another independent path for tool-use and hook integration.

The value is not "three models are smarter than one" in the abstract.
The value is that they look at different surfaces and break in different ways.

## How tap Turns Review Into Infrastructure

tap review is file-based on purpose.

At a high level:

1. A review request is written as a durable inbox file.
2. A bridge or hook delivers that request into a live agent session.
3. The reviewer writes findings back through the same comms layer.
4. Rechecks happen on the same PR with the same durable trail.
5. The next generation can read the full sequence later.

That changes review in three important ways.

### 1. Review survives sessions

A terminal session can die. A file does not.

Because the request, reply, recheck, and merge trail all live in comms files,
review does not disappear when one agent is resumed, restarted, or replaced.

### 2. Review is vendor-agnostic

Claude channel push, Codex app-server bridge, and Gemini hooks all read and
write the same protocol.

That means "who reviews" is not hard-coded into one vendor's product surface.

### 3. Review becomes inspectable

You can examine the actual request path, routing key, generated config, and
state file instead of trusting a chat summary.

This is why tap keeps finding bugs that "look fine" in a conversational review.

## What Gen 15 Actually Caught

Gen 15 merged 9 PRs around doctor, SSOT, identity sync, Gemini integration,
headless operation, and tool instruction. The review value was not theoretical.
It changed merge outcomes repeatedly.

### Pattern 1: Display Label vs Routing Key

Human-friendly labels are not safe machine identifiers.

Examples:

- PR #789 initially used a display label like `초 [claude]` in the
  `tap_reply(to: ...)` instruction. That looked correct to a human, but routing
  expects the raw key (`claude` or `초`), so replies could be misdirected.
- More broadly, identity bugs kept appearing whenever display names, agent IDs,
  and runtime labels were treated as interchangeable.

Rule:

- show labels to humans
- route with raw keys

If a value is nice to read, assume it may be wrong to persist.

### Pattern 2: Projection vs Source of Truth

A generated view is not the same thing as the underlying state.

Examples:

- PR #783 originally treated generated mission output as if it were the whole
  document and clobbered manual sections.
- PR #784 and #785 exposed the same mistake in identity flow: env values and
  visible names were being allowed to override `state.json`, even though state
  was supposed to be the durable source.

Rule:

- `MISSIONS.md` is a projection
- env display names are projections
- state files and raw records are the source

Review gets much better once you ask, "what is the real source here?"

### Pattern 3: Documentation vs Actual Execution Path

If the documented path fails in a clean environment, the system is not done.

Examples:

- PR #786 looked fine until packaging was checked from a clean install path.
  The extension needed a real prepack/build contract, not an assumption that a
  sibling package had already been built somewhere else.
- Black-box testing of published `@hua-labs/tap` in an external clean directory
  showed that the happy path works, but it also exposed a deeper durability
  risk: persisted MCP configs pointed at `fnm_multishells` node paths and npm
  `_npx` cache paths.

Rule:

- test outside the monorepo
- test from the documented entrypoint
- inspect the files that survive after success

Passing once is not enough if the saved config points at ephemeral paths.

### Pattern 4: Order Is Correctness

Some bugs are not in the logic itself. They are in the order the logic runs.

Examples:

- PR #787 originally checked timeout before checking for newly arrived output,
  so valid late review output could be dropped before it was parsed.
- Earlier identity fixes had the same shape: env-before-state and caller-side
  override ordering reintroduced stale values.

Rule:

- read current state first
- then apply timeout or policy
- centralize resolution order in one place

If a system has fallback chains, ordering is part of the contract.

## What Review Looks Like In tap

A useful tap reviewer does not stop at "the diff looks plausible."

They check:

- the documented command path
- the generated config after the command succeeds
- the persisted file paths, not just the CLI message
- the runtime routing keys, not just the human-readable labels
- the timeout and retry order, not just the final branch structure

In practice, this means tap review is closer to systems validation than style
review.

## Reviewer Heuristics That Worked

These heuristics were consistently high-signal in Gen 15.

### Reproduce from the outside

If the feature claims `npx @hua-labs/tap ...`, run it from a clean directory
outside the repo tree.

Testing inside the monorepo can produce false negatives because npm may resolve
the local workspace package instead of the published package.

### Inspect persisted artifacts

After a successful CLI run, open:

- `.mcp.json`
- `~/.codex/config.toml`
- `.gemini/settings.json`
- `.tap-comms/state.json`

The durable system behavior is in those files, not in the green checkmark.

### Treat warnings as architectural clues

Warnings like "bun not found; using node" or "bridge not auto-started" are not
just UX noise. They tell you which fallback path is actually live.

### Prefer raw reproductions over theory

The best findings in Gen 15 were concrete:

- exact sender value
- exact generated path
- exact timeout order
- exact first-run command

This keeps review focused on correctness instead of taste.

## Why tap Review Is Different From "More Parallel Sessions"

dmux, tmux-based runners, and same-vendor orchestration tools can give you more
sessions. tap gives you a review topology.

That topology has four properties:

- **durable**: review survives session death
- **cross-vendor**: Claude, Codex, and Gemini can all participate
- **inspectable**: files and state can be audited directly
- **generational**: later agents can inherit the full review trail

That is why tap review keeps producing value even after the code is already
"approved." It is not duplicating judgment. It is changing the angle of attack.

## Open Risks

Some review-adjacent risks are still open.

- Published `npx` setup currently appears to save MCP runner paths under
  ephemeral locations such as npm `_npx` cache and `fnm_multishells`.
- `--json` output can still be polluted by npm notices on first-run `npx`
  paths, which weakens machine-readability guarantees.
- Tool-use in headless/app-server paths is better after PR #789 and #790, but
  real-world tool visibility remains a runtime surface worth validating.

## Takeaway

tap's review value is not that it lets one model approve another model.

Its value is that it creates a durable system where different models can attack
different failure surfaces, leave artifacts behind, and let the next reviewer
start from evidence instead of memory.
