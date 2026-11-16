# 06 — Artifact and live qualification

**ACT:** `ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01`

---

## C6.1 — Code qualification (artifact identity)

| Field | Value |
|---|---|
| `ENTRY_HEAD` | `5dc1394802b86cb1ac996396fda2ca4b72212a70` |
| `SOURCE_TREE` (entry) | `312cc2ad6c4fb98c2e2b770da82b05f78553d731` |
| `SUBJECT_HEAD` | *(filled by the commit step below — see "Commit identity")* |
| `SOURCE_TREE` (subject) | *(filled by the commit step below)* |
| Branch | `main` |

### ACT_CHANGED_FILES

**Production (9):**

```
apps/vscode/src/shared/task-header-state-label.ts                              (NEW)
apps/vscode/src/sdk/published-task-state.ts                                    (NEW)
apps/vscode/src/sdk/control-seam/control-seam-protocol.ts
apps/vscode/src/sdk/control-seam/control-seam-authority.ts
apps/vscode/src/sdk/control-seam/control-seam-runtime.ts
apps/vscode/src/sdk/control-seam/control-seam-proxy.ts
apps/vscode/src/core/controller/state/subscribeToState.ts
apps/vscode/src/sdk/SdkController.ts
apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts
```

**Tests (7):**

```
apps/vscode/src/sdk/control-seam/control-seam.task-state-projection01.test.ts      (NEW)
apps/vscode/src/sdk/control-seam/control-seam.publication-boundary01.test.ts       (NEW)
apps/vscode/src/sdk/control-seam/control-seam-authority.production-shape.test.ts  (fixture: 2 new authority members)
apps/vscode/src/sdk/control-seam/control-seam-proxy.test.ts                      (fixture: 2 new authority members)
apps/vscode/src/sdk/control-seam/control-seam.qual01.test.ts                     (fixture: 2 new authority members)
apps/vscode/src/sdk/control-seam/control-seam.recon01.test.ts                    (fixture: 2 new authority members)
apps/vscode/src/sdk/control-seam/control-seam.owner-exclusivity.cor02.test.ts    (fixture: 2 new authority members)
```

**Evidence (7, this directory):**

```
.factory/evidence/ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01/
  00-identity-and-source-map.md
  01-publication-contract.md
  02-red-green.md
  03-identity-epoch-adversarial.md
  04-control-seam-conservation.md
  05-executable-gates.md
  06-artifact-and-live-qualification.md
  SHA256SUMS.txt
```

Plus `.factory/epic-board.md` (one update, after validation).

### TEST_COMMANDS_AND_EXIT_CODES

See `05-executable-gates.md` for the complete table. Summary:

| # | Command | Exit |
|---|---|---|
| 1 | `bunx vitest run --config vitest.config.ts --testTimeout=15000 src/sdk/control-seam/control-seam.task-state-projection01.test.ts src/sdk/control-seam/control-seam.publication-boundary01.test.ts` | `0` |
| 2 | `bunx vitest run --config vitest.config.ts --testTimeout=15000 src/sdk/control-seam/` | `1` (one PRE-EXISTING file) |
| 3 | `bunx vitest run --config vitest.config.ts --testTimeout=15000 <5 task-header / epoch-stamping files>` | `0` |
| 4 | `cd webview-ui && bunx vitest run src/components/chat/chat-view/__tests__/react-updater-purity-probe.test.tsx src/components/chat/chat-view/__tests__/c2-correction02-fixup04-updater-purity.test.ts` | `0` |
| 4b | `cd webview-ui && bunx vitest run src/components/chat/task-header/taskHeaderTelemetryHelpers.test.ts` | `0` |
| 5 | `bunx tsc --noEmit` | `0` |
| 5b | `cd webview-ui && bunx tsc --noEmit` | `0` |
| 6 | `bunx biome lint --config-path ./biome.jsonc … <changed files>` | `0` |
| 7 | `git diff --check HEAD` | `0` |
| 8 | Full-suite regression sweep (ACT vs HEAD baseline) | see below |

### RED_RECEIPT

```
FAIL  src/sdk/control-seam/control-seam.task-state-projection01.test.ts
Error: Cannot find package '@shared/task-header-state-label' imported from
  …/apps/vscode/src/sdk/control-seam/control-seam.task-state-projection01.test.ts

 Test Files  1 failed (1)
      Tests  no tests
EXIT=1
```

### GREEN_RECEIPT

```
 ✓ src/sdk/control-seam/control-seam.task-state-projection01.test.ts (31 tests) 29ms
 ✓ src/sdk/control-seam/control-seam.publication-boundary01.test.ts (8 tests) 9ms

 Test Files  2 passed (2)
      Tests  39 passed (39)
EXIT=0
```

### BASELINE_DIAGNOSTICS

- `src/sdk/control-seam/control-seam.owner-exclusivity.cor02.test.ts`
  → `COR02-R1`, `COR02-R2` — `ERR_UNSUPPORTED_ESM_URL_SCHEME` (`bun:`
  scheme). Reproduced identically in a pristine `HEAD` worktree.
  **Pre-existing, not ACT-owned.**
- The wider full-suite drift (63 failing files at HEAD) — pre-existing,

---

## A regression the ACT introduced and then corrected

The first full-suite comparison surfaced **four** files that failed on
the ACT tree but not at HEAD:

```
src/sdk/SdkController.test.ts
src/sdk/__tests__/ask-response-epoch-turnstate-coherence.aretc01-c01-real-seam.test.ts
src/sdk/__tests__/background-handoff-turnstate-discriminator.bhtd01-synthetic-real.test.ts
src/sdk/__tests__/runtime-epoch-transition-active-turnstate-repair01.synthetic-real.test.ts
```

**Root cause.** The ACT added `this.publishedTaskState.invalidate()` to
`SdkController.resetMessageTranslatorAndFence()` and
`SdkController.clearTask()`. Three of those four suites invoke the
production method on a **hand-built plain object** (`SdkController
.prototype.clearTask.call(controller)`, and a `new Function(...)`
harness that compiles the literal production method body), which
**bypasses the constructor's field initializers**. The store field was
therefore `undefined` and the call threw:

```
TypeError: Cannot read properties of undefined (reading 'invalidate')
 ❯ Object.clearTask src/vscode/src/sdk/SdkController.ts:5037:27
```

**Correction.** The invalidation calls use the optional form
`this.publishedTaskState?.invalidate()`.

- In a **real** controller the store ALWAYS exists (it is a field
  initializer), so the invalidation is unconditional — the ACT's
  identity/epoch semantics are unchanged.
- The optional form only tolerates the plain-object harnesses that
  skip the constructor.

**Verification after the correction:**

```
bunx vitest run --config vitest.config.ts --testTimeout=30000 \
  src/sdk/SdkController.test.ts \
  src/sdk/__tests__/ask-response-epoch-turnstate-coherence.aretc01-c01-real-seam.test.ts \
  src/sdk/__tests__/background-handoff-turnstate-discriminator.bhtd01-synthetic-real.test.ts \
  src/sdk/__tests__/runtime-epoch-transition-active-turnstate-repair01.synthetic-real.test.ts

 Test Files  4 passed (4)
      Tests  68 passed (68)
EXIT=0
```

This is recorded here (not hidden) because the ACT's own sweep caught
it. It is NOT in the final `ACT_OWNED_DIAGNOSTICS` set — it was fixed
before closure.

---


### Exact operator procedure

The operator will perform the following on the Mac against the EXACT
qualified source (the `SUBJECT_HEAD` recorded above):

1. **Build/package the exact qualified source.**

   ```bash
   cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
   git checkout <SUBJECT_HEAD>
   git status --porcelain            # must be clean
   cd apps/vscode
   mkdir -p ../../dist                # vsce --out resolves relative to the package dir
   bun run package                   # check-types + build:webview + lint + esbuild --production
   bunx @vscode/vsce package --out ../../dist/clinemm-task-state-projection01.vsix
   ```

2. **Record the artifact identity.**

   ```bash
   git rev-parse HEAD
   git rev-parse HEAD^{tree}
   node -p "require('./package.json').version"
   shasum -a 256 ../../dist/clinemm-task-state-projection01.vsix
   shasum -a 256 ../../dist/extension.js
   ```

3. **Install into `codium-clinemm`.**

   ```bash
   codium-clinemm --install-extension \
     /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/dist/clinemm-task-state-projection01.vsix
   ```

4. **Verify the installed bundle hash and extension-host identity.**

   ```bash
   shasum -a 256 ~/.vscodium-clinemm/extensions/<publisher>-<name>-<version>/dist/extension.js
   # must equal the dist/extension.js hash from step 2
   ```

5. **Ensure the existing read-only MCP control seam is enabled.**
   The seam is DEFAULT OFF. It is enabled by the explicit opt-in record
   (`<CLINE_DIR>/data/control-seam/enabled.json` containing
   `{"enabled": true}`) or the environment override. The operator must
   confirm the opt-in record is present and valid, and that the socket
   and token files were created under the private (0700) directory.

6. **Observe the natural task matrix.** For each naturally reachable
   state — an ACTIVE task, a USER-INPUT state, a PAUSED task, and a
   properly COMPLETED task — call `clinemm_get_run` from Codex Desktop
   and correlate:

   - the returned `sessionId` with the extension host's active session,
   - the returned `taskState.phase` with the ClineMM TaskHeader's
     last host-submitted phase,
   - the returned `taskState.stateVersion` / `taskState.epoch` with the
     host's publication identity,
   - `running` with the SDK agent-turn mirror.

7. **Do NOT manufacture transitions.** Do not interrupt, force, or
   otherwise perturb an existing live task to complete the matrix.

8. **Coordinate with the existing CPR01 installed qualification.** One
   test build must not silently supersede another. The CPR01 successor
   remains a separate ACT; this ACT's VSIX is named distinctly
   (`clinemm-task-state-projection01.vsix`) and the operator must record
   which VSIX is installed at qualification time.

### The qualification claims this ACT makes

| Claim | Classification |
|---|---|
| The MCP seam returns the last identity-bound host-submitted TaskHeader phase | `REAL_PRODUCTION_SEAM` (REAL AF_UNIX transport, REAL authority, REAL `sendStateUpdate` handoff) |
| `running` and `taskState.phase` are independent | `REAL_PRODUCTION_SEAM` (R1-1, R1-2) |
| A failed publication does not advance the record | `REAL_PRODUCTION_SEAM` (PB02, REAL `sendStateUpdate`) |
| The identity/epoch/version fences hold | `REAL_PRODUCTION_SEAM` (R5-*, PB04, PB05) |
| The payload exposes no task content, paths or secrets | `REAL_PRODUCTION_SEAM` (R6-8, plus the fail-closed allow-list) |
| The installed VSIX returns the same projection through Codex Desktop | **`LIVE` — NOT EXECUTED / PENDING** |
| The React DOM has committed that projection | **`LIVE_UNOBSERVABLE` — NOT CLAIMED** |

---

## Commit identity

*(Filled by the commit step; the commit is the SUBJECT_HEAD.)*

## C6.2 — Installed qualification

### Status: NOT EXECUTED (PENDING)

The installed qualification requires a newly built or byte-equivalent,
source-bound VSIX installed into `codium-clinemm`.

**The execution substrate is a sandboxed agent workspace.** The
`~/.vscodium-clinemm/extensions/` directory is not writable from this
sandbox, and the ACT explicitly forbids bypassing the filesystem
restriction. Therefore:

- No VSIX was built for installation.
- No installed extension was modified, replaced, or inspected.
- No `codium-clinemm` extension-host identity was observed.
- No Codex Desktop session was driven against an installed ClineMM.

**Classification of every claim in this ACT: `STRUCTURAL` /
`REAL_PRODUCTION_SEAM` — never `LIVE`.**

No installed-UI observation is claimed. No React DOM commit is claimed.
No live task transition was manufactured.

  unrelated suites. See `05-executable-gates.md`.

### ACT_OWNED_DIAGNOSTICS

**NONE.**
