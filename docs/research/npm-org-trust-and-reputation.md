# npm @hua-labs Trust, Maintainer Risk, and External Reputation

Date: 2026-03-29

## Executive Summary

- The `@hua-labs` scope is active on npm and currently exposes 17 public scoped packages in registry search results.
- Public metadata shows a strong single-maintainer concentration: all 17 scoped packages returned by `npm search --json @hua-labs` list only `devindown` as maintainer, and `npm owner ls @hua-labs/tap` also returns only `devindown`.
- npm does not appear to expose a native "community trust score" for packages or scopes. Trust has to be inferred from maintainers, provenance attestations, signatures, linked repositories, release cadence, docs, and community adoption.
- HUA Labs looks externally like a real but early-stage publisher: the GitHub org is public and active, the `tap` package is public on npm, and sampled packages already ship npm provenance attestations and registry signatures.
- The strongest risk is governance concentration, not current build hygiene. Provenance helps against tampering in CI, but it does not remove bus-factor or account-compromise risk when one maintainer controls the whole scope.

## 1. What is publicly visible on npm

### Scope status

- `npm search --json @hua-labs` returned 17 public scoped packages under `@hua-labs/*`.
- Sample package names:
  - `@hua-labs/tap`
  - `@hua-labs/ui`
  - `@hua-labs/hua`
  - `@hua-labs/motion-core`
  - `@hua-labs/dot`
  - `@hua-labs/security`
- `npm view @hua-labs/tap --json` shows `latest = 0.3.0`, published `2026-03-28T23:21:06.686Z`.
- `npm access get status @hua-labs/tap` returns `public`.

### Important limitation

- npm docs state that a scope can belong to either a user account or an organization.
- Public registry metadata proves that the `@hua-labs` scope is live and publishing, but it does not prove organizational membership structure by itself.
- I could not independently prove "this scope is definitely an npm Organization with multiple members" from unauthenticated public endpoints alone:
  - `npm org ls hua-labs` required authentication and returned `E401`.
  - Direct programmatic requests to `https://www.npmjs.com/org/hua-labs` returned `403`.
- Practical conclusion: the scope is real and active; whether it is fully set up as an npm Organization with visible multi-member governance cannot be confirmed from public unauthenticated metadata alone.

## 2. Does npm expose a community trust score?

- I did not find a native npm "trust score" field in package metadata or on the npm docs side.
- Registry metadata for `@hua-labs/tap` exposes concrete trust signals instead:
  - maintainer list
  - repository / bugs / homepage links
  - publish time and version history
  - ECDSA registry signatures
  - provenance attestations
- Inference: npm's trust model is controls-based, not score-based.

### What trust signals are available instead

- Publisher identity:
  - `@hua-labs/tap` publisher: `devindown`
  - maintainer: `devindown <echonet.ais@gmail.com>`
- Supply-chain integrity:
  - `@hua-labs/tap` has `publishConfig.provenance = true`
  - `@hua-labs/tap` exposes `dist.attestations` with SLSA provenance
  - `@hua-labs/tap` exposes `dist.signatures`
- Traceability:
  - repository: `https://github.com/HUA-Labs/tap`
  - bugs: `https://github.com/HUA-Labs/tap/issues`
  - homepage: `https://github.com/HUA-Labs/tap#readme`

### Sampled evidence

I checked two packages directly:

| Package | Maintainers | Provenance | Signatures | Repo linked |
| --- | --- | --- | --- | --- |
| `@hua-labs/tap` | 1 (`devindown`) | yes | yes | yes |
| `@hua-labs/ui` | 1 (`devindown`) | yes | yes | yes |

This is better than the "token-only, no metadata, no repo linkage" baseline, but still weaker than a multi-maintainer scope with visible org governance.

## 3. Single-maintainer risk

### What the public metadata shows

- All 17 `@hua-labs/*` packages returned by `npm search --json @hua-labs` list only one unique maintainer username: `devindown`.
- `npm owner ls @hua-labs/tap` also returns only `devindown <echonet.ais@gmail.com>`.

### Security interpretation

This is a real trust concern even when packages are technically well published.

Primary risks:

- Bus factor 1: one account controls publishing, recovery, and package settings.
- Account compromise risk: if the maintainer account is taken over, the whole scope is exposed.
- Incident response bottleneck: revocation, rotation, and emergency publish decisions depend on one person.
- Reputation fragility: external consumers see limited human redundancy, which lowers trust for production adoption.

### What mitigates that risk today

- npm provenance attestations reduce the risk of forged CI-origin publishes.
- Registry signatures improve artifact verification.
- Public GitHub repos, linked issues, and linked homepages make auditability materially better.

### What would improve trust fastest

1. Add at least one or two additional npm owners / maintainers for the scope and critical packages.
2. Enforce 2FA for package publishing and settings modification.
3. If the scope is an npm Organization, enforce org-wide 2FA as well.
4. Keep trusted publishing enabled and migrate away from long-lived write tokens where possible.
5. Mirror governance on GitHub:
   - more than one org owner
   - protected release workflows
   - protected default branches
6. Add public security and release-process docs:
   - `SECURITY.md`
   - incident response contact
   - release checklist
   - changelog discipline

## 4. HUA Labs external reputation

### npm-facing view

- `@hua-labs/tap` exists publicly on npm at version `0.3.0`.
- The scope currently has 17 public scoped packages discoverable via search.
- Release history exists, not just a one-off publish:
  - `@hua-labs/tap` shows versions from `0.1.0` through `0.3.0`
  - `@hua-labs/motion-core` shows a longer release history starting in 2025
- Sampled packages are linked to public GitHub repos and have provenance/signatures enabled.

### GitHub-facing view

From the GitHub API on 2026-03-29:

- `HUA-Labs` org:
  - created: `2025-05-21T06:06:02Z`
  - public repos: `10`
  - followers: `4`
  - blog: `https://hua-labs.com`
  - location: `Korea, South`
- `HUA-Labs/tap`:
  - public, MIT licensed
  - created: `2026-03-20T04:07:04Z`
  - pushed: `2026-03-28T23:20:46Z`
  - stars: `6`
  - forks: `0`
  - open issues: `0`
- `HUA-Labs/hua-packages`:
  - public, MIT licensed
  - created: `2026-03-02T04:39:45Z`
  - pushed: `2026-03-23T00:25:18Z`
  - stars: `0`
  - forks: `0`
  - open issues: `5`

### External interpretation

- Positive:
  - public org
  - active publishing
  - linked repos and docs
  - provenance/signatures present
  - multiple package lines, not a single abandoned package
- Negative / limiting:
  - low community adoption signals so far (low stars, forks, followers)
  - very young public track record
  - visible maintainer concentration

My judgment: HUA Labs currently looks credible as an active early-stage publisher, but not yet "high-trust by community reputation alone." The strongest trust signal today is transparent technical metadata, not broad public adoption.

## 5. Practical rating

This is a subjective security/reputation read, not an npm-native score.

| Dimension | Assessment | Why |
| --- | --- | --- |
| Scope activity | strong | 17 scoped packages, active publish history |
| Build integrity | good | provenance + signatures visible on sampled packages |
| Governance resilience | weak | one visible maintainer across the scope |
| Community reputation | early | public repos exist, but stars/forks/followers are still low |
| Overall external trust | moderate | real and active, but still concentrated and young |

## 6. Recommended next moves before leaning on reputation

1. Confirm the `@hua-labs` scope is configured as an npm Organization, not just effectively managed through one user account.
2. Add at least 2 human maintainers with distinct accounts to the org and critical packages.
3. Enforce 2FA at both package and organization level.
4. Keep trusted publishing enabled and document which GitHub workflows are allowed to publish.
5. Add visible security/governance artifacts:
   - `SECURITY.md`
   - `CODEOWNERS`
   - release workflow docs
   - changelog hygiene
6. Periodically audit:
   - `npm owner ls <pkg>`
   - org members / teams
   - package publish permissions
   - provenance and signature presence on newly published versions

## Sources

- npm Docs: About scopes
  - https://docs.npmjs.com/about-scopes/
- npm Docs: Organizations
  - https://docs.npmjs.com/organizations/
- npm Docs: Trusted publishing for npm packages
  - https://docs.npmjs.com/trusted-publishers/
- npm Docs: Requiring 2FA for package publishing and settings modification
  - https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/
- npm package page
  - https://www.npmjs.com/package/@hua-labs/tap
- GitHub org
  - https://github.com/HUA-Labs
- GitHub repo
  - https://github.com/HUA-Labs/tap
- GitHub repo
  - https://github.com/HUA-Labs/hua-packages

## Local commands used

- `npm search --json @hua-labs`
- `npm view @hua-labs/tap --json`
- `npm view @hua-labs/ui dist.attestations dist.signatures publishConfig.provenance maintainers repository bugs homepage --json`
- `npm owner ls @hua-labs/tap`
- `npm access get status @hua-labs/tap`
- `gh api orgs/HUA-Labs`
- `gh api repos/HUA-Labs/tap`
- `gh api repos/HUA-Labs/hua-packages`
