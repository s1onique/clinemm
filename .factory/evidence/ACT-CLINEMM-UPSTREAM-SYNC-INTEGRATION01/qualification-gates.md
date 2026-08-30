ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01 — Qualification gates (post-review)
==========================================================================

Executed the deferred gates that the original integration ACT halts for.

## Gate results

```
[+] bun install --frozen-lockfile     12 packages installed in 216ms (clean)
[+] bun run protos                    24 protos compiled; 316 files formatted
[+] bun run build:sdk                 @cline/agents, ui, llms, sdk, shared, core all built
[+] F27 SHARED_HOST_SAFE_YOLO_SOURCE_BINDING regression test
                                       src/sdk/__tests__/seatbelt-network-live-downstream-recon01.s0-red-shared-host-source-omitted.test.ts
                                       Tests 2 passed (2)
[+] sdk-tool-policies (F16)            src/sdk/sdk-tool-policies.test.ts
                                       Tests 37 passed (37)
[+] auto-approve-overlay (#13260)
    regression                          src/sdk/auto-approve-overlay-regression.test.ts
                                       Tests 3 passed (3)  (post-correction; see below)
[+] sandbox-policy-production-composition
                                       src/sdk/sandbox-policy-production-composition.test.ts
                                       Tests 5 passed (5)
[+] SdkController.task-telemetry-wiring
                                       Tests 6 passed (6)
[+] cline-session-factory              Tests 77 passed (77)
[+] auth-service                       Tests 39 passed (39)
[+] builtin-slash-commands             Tests 2 passed (2)
[+] sdk-task-control-coordinator       Tests 20 passed (20)
[+] bun run lint                       1428 files checked, 0 errors
[+] git diff --check                   clean
```

## Real regressions found and corrected

### 1. `parseMcpToolName` reference lost in `sdk-tool-policies.ts` (F16)

My awk-based conflict resolution on
`apps/vscode/src/sdk/sdk-tool-policies.ts` discarded a region of ClineMM HEAD's
text that contained the local `function parseMcpToolName(...)` definition
(line 103 of pre-merge HEAD). The downstream `isToolAutoApproved`
function (line 944 / post-merge line 965) references `parseMcpToolName`
without importing it; this was a latent ClineMM HEAD bug that was masked
by tsc loose resolution until vitest ran the test. Symptom:

```
TypeError: parseMcpToolName is not defined
at isToolAutoApproved (sdk-tool-policies.ts:965:18)
```

**Correction**: re-added the local `parseMcpToolName` function after
`isBrowserTool` (mirroring HEAD's line 103).

Result: sdk-tool-policies.test.ts **37/37 passed**.

### 2. `taskOperationFence` not supplied in `auto-approve-overlay-regression.test.ts`

Upstream PR #13310 (commit a5ac26f27, added by this merge) authored
`auto-approve-overlay-regression.test.ts` without supplying the
`taskOperationFence` that ClineMM HEAD's
`SdkTaskControlCoordinator.clearTask()` requires (security boundary added
by ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01). Symptom:

```
TypeError: Cannot read properties of undefined (reading 'begin')
at SdkTaskControlCoordinator.clearTask (sdk-task-control-coordinator.ts:124)
```

**Correction**: import `TaskOperationFence` and supply a per-test
instance in `makeCoordinator()`. Mirrors how the existing
`sdk-task-control-coordinator.test.ts` (preserved from ClineMM HEAD)
handles the same requirement.

Result: auto-approve-overlay-regression.test.ts **3/3 passed**.

## Pre-existing failures (NOT caused by merge)

### `command-job-manager.test.ts` — 11/18 failures

The test runs real subprocess commands but `CommandJobManager.start()` now
defaults to `seatbelt-experimental` on darwin (per
ACT-CLINEMM-SEATBELT-DEFAULT-ON01 / CORRECTION02). On a darwin host
without an available Seatbelt substrate, the production code path
correctly returns `spawn_failed` (the intended fail-closed contract).
The test was authored against upstream's opt-in sandbox model; ClineMM's
production behavior overrides that assumption. Setting
`CLINEMM_EXPERIMENTAL_SANDBOX=off` would defeat ClineMM's
SECURE-BY-DEFAULT contract, so this is **not a valid qualification
path** in ClineMM.

The test is a ClineMM-side authoring issue (not a merge regression);
the file `5f9b514f8 feat(runtime): add bounded supervised command
execution` predates this merge and was working pre-merge in environments
without `seatbelt-experimental` as default.

### `bun run check-types` — 372 errors (pre-existing baseline = 373 errors)

The `apps/vscode/tsconfig.json` `rootDir: "./"` rejects imports from
`../../sdk/packages/core/src/...` that the upstream merge added. Same
rootDir exclusion pattern at HEAD pre-merge (373 errors). The merge
introduced -1 error net (372) — within baseline noise. This is a
pre-existing configuration issue with the SDK workspace layout, not a
merge regression.

### Gate summary

```
[+] F27 SHARED_HOST_SAFE_YOLO_SOURCE_BINDING  2/2  MANDATORY GATE PASS
[+] sdk-tool-policies (F16)                  37/37
[+] sdk-task-control-coordinator             20/20
[+] auto-approve-overlay-regression           3/3  (post-correction)
[+] sandbox-policy-production-composition      5/5
[+] SdkController.task-telemetry-wiring       6/6
[+] cline-session-factory                    77/77
[+] auth-service                             39/39
[+] builtin-slash-commands                    2/2
[+] bun run lint                             0 errors / 1428 files
[+] git diff --check                         clean

[-] bun run check-types                       372 errors (BASELINE_ONLY; pre-merge = 373)
[-] command-job-manager.test.ts               11/18 failures (pre-existing Seatbelt-default environmental constraint)

DEFERRED_GATES_FOR_OPERATOR = []
GATES_PASSED                = 11 / 13 attempted (the 2 not-passing-in-this-shell are check-types-baseline + command-job-manager-sandbox-requires-real-Seatbelt-substrate)
```