# ACT-CLINEMM-DIAGNOSTIC-EXPORT-PRIVACY01

> Status: CLOSED (PASS — the shareable diagnostic export is credential-safe under the tested schema and adversarial fixtures)
> Owner: EPIC-CLINEMM-TRACE-AND-ACCEPTANCE-EVIDENCE
> Cluster: DIAGNOSTIC_EXPORT_PRIVACY
> Predecessor: ACT-CLINEMM-COMPACTION-TOOL-RESULT-SHAPE-REPRO01
> Entry: actual HEAD after TOOL-RESULT-SHAPE-REPRO01 (`91cc334ff`)

## Mission

Prevent secret-bearing canonical conversation content from leaking through
shareable diagnostic exports.

## C0 — Recon: which files are private runtime persistence, and which are intended for sharing

The recon audited every path that WRITES and EXPORTS canonical conversation
content. The finding is a three-way split:

| File | Classification | Owner |
| ---- | -------------- | ----- |
| `<session>.messages.json` | **PRIVATE runtime persistence** — the full conversation: prompts, command arguments, tool output, and whatever credentials the user had on screen | `sdk/packages/core/src/session/services/persistence-service.ts` |
| `<session>.compaction.json` | **PRIVATE runtime persistence** — the compacted conversation (the summary is a multi-KB free-form string derived from the conversation) | `sdk/packages/core/src/session/services/persistence-service.ts` |
| `<session>.json` (the manifest) | **PRIVATE runtime persistence** — `prompt` and `metadata.title` are the user's raw prompt; `metadata.git.url` can embed a credential; `messages_path` / `compaction_path` point at the two files above | `sdk/packages/core/src/session/models/session-manifest.ts` |
| `roundc-latency-trace.json` | **SHAREABLE** — the dogfood latency trace. Schema-driven, counts/timings/identities only | `apps/vscode/src/sdk/roundc-latency-trace-runtime.ts` |
| `completion-incident-*.jsonl` / `runtime-diag/*.jsonl` | **SHAREABLE** — the dogfood diagnostic bundles. Schema-driven, classification-shaped records only | `apps/vscode/src/sdk/completion-incident-bundle-runtime.ts`, `apps/vscode/src/sdk/v2-capture.ts` |
| `cline-incident.zip` | **SHAREABLE** — the automatic incident export. Strict allowlist, unknown keys are DROPPED not redacted | `apps/vscode/src/sdk/automatic-incident-export.ts` |
| `cline-diagnostics-*.txt` | **SHAREABLE** — the desktop app's `export_diagnostics` artifact. **THIS IS THE DEFECTIVE SURFACE** | `apps/examples/desktop-app/sidecar/diagnostics.ts` |

Every VS Code extension export was verified to be schema-driven and to NOT
read the canonical `messages.json` / `compaction.json`. The `metadata` of the
latency trace is gated by `LATENCY_METADATA_ALLOWLIST`
(`sdk/packages/core/src/observability/latency/latency-trace.ts`), which DROPS
every non-allowlisted key.

**The defective boundary is the desktop app's `export_diagnostics` command**
(`apps/examples/desktop-app/sidecar/commands.ts:3479` → `writeDiagnosticsReport`
→ `buildDiagnosticsReport`). It is an EXPLICIT, USER-INVOKED, SHAREABLE
diagnostic export: the UI dialog says the file is saved for support, and the
user is expected to send it away.

### The reproduced disclosure (real production data)

The export was run against the real canonical session
`~/.vscodium-roz/cline-data/sessions/1794789266763_q4tet/`. The canonical
`messages.json` (1.2 MB) and `compaction.json` (109 KB) of that session
contain REAL credentials — a messaging-provider API key
(`REDSMS_API_KEY`), Keycloak bootstrap-admin credentials, and JDBC
connection strings.

The pre-repair export carried, in the shareable artifact:

- `metadata.title` — **the raw user prompt verbatim**. The pre-repair code
  deleted `prompt`, `metadata.prompt` and `metadata.systemPrompt`, but in
  production `metadata.title` IS the prompt, so it shipped.
- `metadata.git.url` — the **Git remote URL**
  (`git@gitlab.roznanie.ru:backend/keycloak.git`). The repository's own
  automatic-incident-export privacy contract explicitly excludes Git remote
  URLs from shareable artifacts.
- `messages_path` / `compaction_path` — the paths of the **PRIVATE**
  canonical conversation artifacts, advertised as if they were part of the
  bundle.

The pre-repair privacy gate was a single regex
(`SECRET_FIELD_PATTERN`) applied to the WHOLE report text. It cannot make an
unknown blob safe, and it did not even cover the shapes that matter: URL
embedded credentials, Authorization header values and JDBC connection
strings all passed through it unchanged (measured — see
`02-red-tests.txt` and the "log tails" test).

## C1 — RED

`apps/examples/desktop-app/sidecar/diagnostics-export-privacy.test.ts`
(**NEW**, 14 tests) invokes the ACTUAL shareable-export path
(`buildDiagnosticsReport` / `writeDiagnosticsReport`) with synthetic
adversarial fixtures. It does NOT rely solely on regex unit tests.

The fixtures carry every secret class the mission names:

| Fixture | Class |
| ------- | ----- |
| `kc-Bootstrap-Admin-Pw-9f3c1d` | Keycloak bootstrap-admin credential |
| `puihgxkifQSIaZKkENtQzVTs` | messaging-provider API key |
| `js-client-secret-3a91f0c7b2` | JSON secret block |
| `yaml-kc-db-password-71c4e9` | YAML secret block |
| `url-embedded-user-pw-5b2d8e` | URL-embedded credential |
| `authz-bearer-token-8f41c0a2d5` | Authorization header value |
| `jdbc:postgresql://kc-db-host:6432/keycloak-prod` | connection string |
| `cmd-arg-secret-token-4e6f1a` | credential in a COMMAND ARGUMENT |

The assertions are on the ABSENCE of the literal secret values in the
EXPORTED ARTIFACT, plus the absence of the raw prompt, the credential-bearing
Git remote, the canonical artifact paths, and the credential-bearing command
and tool output.

**RED at HEAD (pre-repair): 8 of 22 tests FAIL** — see
`../evidence/ACT-CLINEMM-DIAGNOSTIC-EXPORT-PRIVACY01/02-red-tests.txt`.

## C2 — Repair

At the existing export boundary, the export now produces a SEPARATE, SAFE
REPRESENTATION instead of a copy of the manifest.

### `apps/examples/desktop-app/sidecar/diagnostics-session-projection.ts` (**NEW**)

A SCHEMA-DRIVEN, ALLOWLISTED projection of the manifest. Every value is
built from a strict allowlist; a field that is not allowlisted is never
read, so it cannot leak — it is dropped BY CONSTRUCTION, not redacted.

Retained (the useful, non-sensitive evidence):

- the session identity and run metadata (`sessionId`, `source`, `status`,
  `interactive`, `provider`, `model`, `startedAt`, `endedAt`, `exitCode`),
- the token/cost accounting counters (`usage`: `inputTokens`,
  `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `totalCost`),
- the checkpoint identity (`checkpointRef`, a git SHA),
- the git BRANCH label (`gitBranch`, a short label — never the remote URL),
- the workspace path with the home directory collapsed to `~`,
- `omittedFields` — the names of the manifest/metadata keys that were
  OMITTED, so the omission is RECORDED rather than silent.

Excluded: raw prompts (`prompt`, `metadata.prompt`, `metadata.title`,
`metadata.systemPrompt`), command arguments, credentials, raw tool output,
sensitive URLs (the Git remote is never read), unrestricted error text, the
canonical private-persistence paths, and every other non-allowlisted key.

### `apps/examples/desktop-app/sidecar/diagnostics.ts`

- The session section now serializes the PROJECTION, never the manifest.
- The log tails are FREE-FORM and have no schema, so they keep a
  shape-based filter — but that filter was WIDENED to the credential shapes
  the previous one missed: Authorization header values, URL-embedded
  credentials, quoted multi-word values, and JDBC connection strings. The
  host is preserved so an analyst can still see WHICH server was involved.

### Invariants

- **The canonical records are never mutated.** The export only OPENS the
  manifest; `*.messages.json` and `*.compaction.json` are never written. A
  test asserts byte-identical content before and after the export.
- **The canonical records are never read** by the export. A test writes
  marker content into them and asserts the markers are absent from the
  artifact.
- **No new production state and no tool-execution behaviour change.** The
  change is confined to the report's serialisation.

## C3 — GREEN

| Check | Result |
| ----- | ------ |
| Synthetic secrets absent from the exported artifact | GREEN — 9 secret classes asserted absent |
| Useful safe evidence still available | GREEN — session identity, model, provider, token counters, checkpoint SHA, branch |
| Complete recursive schema inspection | GREEN — every key of the projection and of `usage` is allowlisted; every leaf is a primitive |
| No mutation of the source canonical history | GREEN — byte-identical manifest/messages/compaction before and after |
| No unexpected exposure from nested objects or arrays | GREEN — the projection has exactly one nested object (`usage`) and one array (`omittedFields`), both inspected |
| Bounded output | GREEN — a 400 KB manifest projects to under 1 MB; every string is capped at 512 chars, every array at 64 entries |
| Export failure isolation | GREEN — an unreadable manifest is skipped and the report is still produced |
| No new production state / tool-execution behaviour change | GREEN — the diff is confined to report serialisation |

### Focused tests

```
cd apps/examples/desktop-app && bun run test:sidecar:diagnostics
```

- **22 passed (22)** — 14 new privacy tests + 8 pre-existing diagnostics tests.
- The whole sidecar suite under the dedicated config: **746 passed (746)** across 48 files.

### Typecheck, lint, baseline comparison

| Check | With the change | Same-environment baseline at HEAD | Delta |
| ----- | --------------- | ---------------------------------- | ----- |
| `bun run typecheck` (desktop app) | 1 error, `sdk/packages/shared/src/runtime/model-wire-reasoning.ts(236,2)` TS1170 | IDENTICAL (1 error, same file/line) | **0** |
| Biome `check --diagnostic-level=error` on the 5 ACT-owned files | clean | n/a | **0** |
| `bun run build:sdk` | GREEN | GREEN | **0** |
| `bun -F @cline/core test:unit` | 152 failed / 5246 passed | IDENTICAL | **0** |
| `bun -F @cline/core test:unit` failing-FILE set | 27 files | 29 files | **0 — FLAKY, see below** |
| `bun -F @cline/cli test:unit` | 107 failed / 362 passed / 13 skipped (482) | IDENTICAL | **0** |
| `bun -F @cline/vscode test` | 1 failed / 1 passed (2) — `z.object` interop | IDENTICAL | **0** |
| desktop-app `bun run test:sidecar` (shared config) | 57 failed files | IDENTICAL | **0** |

**The `@cline/core` failing-FILE set is FLAKY, and the delta is NOT a regression.**
The SDK core suite's failing-file set is not stable between two runs of the
SAME code on this machine: two consecutive runs of the identical tree produced
**26** and **28** failing files, with exactly the same files drifting
(`src/extensions/plugin/plugin-sandbox.test.ts`,
`src/hub/server/plugin-commands.test.ts`, `src/hub/server/replay-wire.test.ts`,
`src/services/plugin-tools.test.ts`). The UNION of those two same-code runs is
**29** files — exactly the count of the separately captured "baseline" run.
These are timing / sandbox-dependent tests. The TOTAL counts (`152 failed |
5246 passed | 165 skipped`) are identical between the with-change and
baseline runs, and the SDK core package does not import the desktop app at
all (the only reference to it anywhere in `sdk/packages/core/src/` is a
COMMENT in `remote/shell-path.ts`). The differing test files do not touch the
diagnostics export. See `08-core-same-code-run1-failing-files.txt`,
`09-core-same-code-run2-failing-files.txt` and
`10-core-same-code-flakiness-diff.txt`.

**Pre-existing environment issue (NOT caused by this ACT).** The desktop app
declares `zod@^3.24.1` while `@cline/core` / `@cline/shared` declare
`zod@^4.3.6`. Vite externalizes the SDK packages, and the SDK's ESM
`import { z } from "zod"` is then served through the app's zod v3 CommonJS
interop, where the named export `z` is `undefined`. Every sidecar test that
touches `@cline/core` therefore fails to load with
`TypeError: undefined is not an object (evaluating 'z.object')` — 57 files
at HEAD, before this ACT.

`apps/examples/desktop-app/vitest.sidecar.config.ts` (**NEW**) adds
`server.deps.inline: [/@cline\//, /zod/]` so each package resolves the zod
version IT declares. With it the whole sidecar suite runs: **48 files,
746 tests, all passing**. The shared `vitest.config.ts` is deliberately NOT
changed, so the pre-existing baseline is preserved for comparison.

## C4 — Closure

### The verified export path

`cline.export_diagnostics` → `apps/examples/desktop-app/sidecar/commands.ts`
→ `writeDiagnosticsReport()` → `buildDiagnosticsReport()` →
`projectDiagnosticsSession()`.

### Format

A single UTF-8 TEXT file, `cline-diagnostics-<version>-<stamp>.txt`, written
to `~/Downloads` (or `<clineDataDir>/diagnostics`). Sections: the app/system
header, the global settings, the bounded log tails, and one allowlisted
session projection per selected session.

### Scope

- **Private runtime persistence** (never read by the export, never mutated):
  `<session>.messages.json`, `<session>.compaction.json`, the canonical
  session manifest.
- **Shareable diagnostic artifact** (the output of the export): the
  allowlisted projection.

### Exact commands used

```bash
# Focused tests (the ACT's RED/GREEN gate)
cd apps/examples/desktop-app && bun run test:sidecar:diagnostics

# The whole sidecar suite, with the SDK packages inlined
cd apps/examples/desktop-app && bun x vitest run sidecar --config vitest.sidecar.config.ts

# Typecheck
cd apps/examples/desktop-app && bun run typecheck

# Lint (the 5 ACT-owned files)
cd <repo root> && bun x --bun @biomejs/biome check --diagnostic-level=error \
  apps/examples/desktop-app/sidecar/diagnostics.ts \
  apps/examples/desktop-app/sidecar/diagnostics-session-projection.ts \
  apps/examples/desktop-app/sidecar/diagnostics-export-privacy.test.ts \
  apps/examples/desktop-app/sidecar/diagnostics.test.ts \
  apps/examples/desktop-app/vitest.sidecar.config.ts

# SDK build
cd <repo root> && bun run build:sdk

# Baseline comparisons
cd <repo root> && bun -F @cline/core test:unit
cd <repo root> && bun -F @cline/cli test:unit
cd <repo root> && bun -F @cline/vscode test
cd apps/examples/desktop-app && bun run test:sidecar
```

### What changed

| File | Change |
| ---- | ------ |
| `apps/examples/desktop-app/sidecar/diagnostics-session-projection.ts` | **NEW** — the schema-driven, allowlisted session projection |
| `apps/examples/desktop-app/sidecar/diagnostics.ts` | The export serializes the projection; the log-tail filter covers the credential shapes it missed |
| `apps/examples/desktop-app/sidecar/diagnostics-export-privacy.test.ts` | **NEW** — 14 adversarial privacy tests |
| `apps/examples/desktop-app/sidecar/diagnostics.test.ts` | The two assertions that pinned the leaked `metadata.title` / `metadata.systemPrompt` now pin the projection instead |
| `apps/examples/desktop-app/vitest.sidecar.config.ts` | **NEW** — the sidecar test config that inlines the SDK packages (fixes the pre-existing zod interop blocker) |
| `apps/examples/desktop-app/package.json` | The `test:sidecar:diagnostics` script |

### Banned-list audit

- **Canonical conversation persistence was NOT modified** — RESPECTED. The
  diff touches only the report's serialisation; `messages.json` and
  `compaction.json` are never opened or written by the export.
- **No new production state** — RESPECTED. No new settings, no new files
  written outside the existing export artifact.
- **No tool-execution behaviour change** — RESPECTED. No executor, approval,
  tool schema or compaction behaviour is touched.
- **No VSIX, installation or live benchmarking** — RESPECTED.
- **No new dependency** — RESPECTED. Only the standard library and the
  existing workspace packages are used.
