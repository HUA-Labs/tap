---
title: tap 0.6 standalone sync
type: devlog
status: complete
updated: 2026-06-20
---

# tap 0.6 standalone sync

## Why

The package source was prepared in the platform workspace, but npm publication
uses the standalone public `HUA-Labs/tap` repository and its tag-triggered
GitHub Actions provenance workflow. This sync moves the current `0.6.0`
candidate into that repository without publishing to npm.

## Changes

- Synced the tap package source, built `dist/`, README, changelog, AI guide, and
  generic profile-pack example.
- Added standalone-relative import fixes for package root layout.
- Added the bridge script mirror needed by the bundled bridge entrypoint.
- Added pnpm install metadata so `esbuild` postinstall is explicit under newer
  pnpm approval policy.
- Replaced public docs examples with neutral concrete agent names.

## Verification

- `pnpm run build` passed.
- `pnpm run type-check` passed.
- `pnpm exec vitest run --environment=node --pool=forks --maxWorkers=1` was
  mostly clean: 1473 passed / 1 watcher-timeout failure, and the timed-out
  `observe-transport` test passed immediately when rerun alone.
- `npm pack --pack-destination /tmp/tap-standalone-0.6-pack --json` passed and
  produced `hua-labs-tap-0.6.0.tgz` with 42 entries.
- Tarball audit passed: required docs/bin/dist/example entries present,
  source-map `sourcesContent` count 0, npm-facing private path/name grep 0.
- Fresh Linux install smoke from the local tarball passed:
  version, setup dry-run/apply, setup doctor, status, add, ready, and
  `comms-doctor --all-known`.
- Public npm registry remained unchanged at `0.5.2`.

## Residual

- This PR does not create a release tag and does not publish to npm.
- Some legacy operator compatibility profiles remain in the CLI code for
  explicit opt-in use. Public first-run docs and package examples use neutral
  concrete agents and profile-pack guidance instead.
