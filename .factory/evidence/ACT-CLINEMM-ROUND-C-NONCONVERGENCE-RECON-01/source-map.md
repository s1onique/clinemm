# source-map.md — ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01

**Type:** RECON / causal discriminator
**Production changes:** NONE (this ACT changed no production file)
**Working tree:** clean at entry and exit (`git status --porcelain` → 0 lines)

> **CORRECTION01 notice.** The production seams and identities recorded here
> are **unchanged** by `ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-CORRECTION01`
> and were re-verified. The correction altered only three *claims* about the
> evidence (the compaction count, the novelty tier, the readiness
> semantics) — all recorded in `causal-discriminators.md` and
> `qualification-report.md`. The identity chain below was re-verified
> unchanged: `build-provenance.json.sourceHead` == ENTRY_HEAD ==
> installed extension version, with both hashes independently recomputed.

---

## 1. Repository identity

| Property | Value |
|---|---|
| Repository root | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` |
| `ENTRY_HEAD` | `6883c7c52f19de5966bacb31973577179eac42de` |
| Branch | `main` |
| `ENTRY_HEAD` subject | `docs(clinemm): bind the CORRECTION02 terminal identity and regenerate the manifest` |
| `ENTRY_HEAD` commit date | `2026-11-21 07:51:12 +0300` |
| Tracked dirt at entry | none (0 modified/untracked entries) → **no `HALT_DIRTY_TREE`** |
| Protected stashes | none present (`git stash list` → empty) |
| Preceding commits | `e0d1245da` (CORRECTION02 evidence), `b0bf8fcb1` (canonical-filter fix) |

`ENTRY_HEAD` and the installed extension identity are **proven identical**, not assumed:

```
$ cat ~/.vscodium-roz/extensions/s1onique.clinemm-4.1.26-6883c7c52/build-provenance.json
{
  "schemaVersion": 1,
  "sourceHead": "6883c7c52f19de5966bacb31973577179eac42de",
  "extensionVersion": "4.1.26-6883c7c52",
  "sourcePackagePath": "apps/vscode/package.json",
  "sourcePackageSha256": "afb56cb537a3cfd6964bf68a516abf82eaa971e757daef1aa706795b34d615d0",
  "sourcePackageBytes": 24729,
  "bundledExtensionSha256": "914351930b9ec62fc988ed9fe6d125d6eced37f2fc98ca49b2c5c2e2917f6a20"
}
```

Independent verification of that provenance file (recomputed, not read):

| Claim | Recomputed value | Match |
|---|---|---|
| `apps/vscode/package.json` sha256 | `afb56cb537a3cfd6964bf68a516abf82eaa971e757daef1aa706795b34d615d0` (24729 bytes) | ✅ equals `sourcePackageSha256` |
| installed `dist/extension.js` sha256 | `914351930b9ec62fc988ed9fe6d125d6eced37f2fc98ca49b2c5c2e2917f6a20` | ✅ equals `bundledExtensionSha256` |

**Identity chain (closed, no inference gap):**

```
ENTRY_HEAD 6883c7c52f19de5966bacb31973577179eac42de
   ├─ build-provenance.json.sourceHead              == ENTRY_HEAD          (exact)
   ├─ build-provenance.json.extensionVersion        == 4.1.26-6883c7c52    (exact)
   ├─ installed dir name s1onique.clinemm-4.1.26-6883c7c52               (exact)
   ├─ session metadata version "4.1.26-6883c7c52"                        (exact)
   └─ provider-capture correlation.clientVersion "4.1.26-6883c7c52"       (exact)
```

### Deliberate divergence that must not be conflated

The **working-tree build artifact** is *not* the installed artifact:

| Artifact | sha256 |
|---|---|
| installed `~/.vscodium-roz/extensions/s1onique.clinemm-4.1.26-6883c7c52/dist/extension.js` | `914351930b9ec62fc988ed9fe6d125d6eced37f2fc98ca49b2c5c2e2917f6a20` |
| working tree `apps/vscode/dist/extension.js` | `010e6c1ac77861d85ac560185d1465e1f63f1f223e8819f5f33435012d5b4325` |

The installed VSIX is the artifact that produced the historical session. The
working-tree bundle is a later local rebuild of the *same source head*. Where
this ACT reasons about "the code that ran", it reasons about the installed
artifact and the source at `ENTRY_HEAD`; where it reasons about source

---

## 2. Historical session identity

| Property | Value |
|---|---|
| Session / task id | `1795252560069_t82cp` |
| Conversation id (provider capture) | `conv_1795252560308_ek5zqdx` |
| Agent id (provider capture) | `agent_47f70d6b-3221-4a18-a700-eef9be89deeb` |
| Autonomous run id (provider capture) | `run_3tw2rDtz` (iterations 1…277) |
| Operator-intervention run id | `run_OH-JHT6v` (iteration 1) |
| Post-intervention run id | `run_30dACBDL` (iterations 1…2) |
| Model | `qwen3.8-flash-next-q2_0` |
| Provider | `openai-compatible` |
| Source | `vscode` (interactive, `mode: user`) |
| Working directory | the audited Keycloak repository (absolute path redacted: a
| private repository location is itself sensitive; the source-path identity is
| recoverable from `artifact-hashes.json` under `private_evidence_sources`) |
| Target repo branch / HEAD | `optimize-ftls` @ `42de653b59708e712d694aeb9732f822b7f8fe5b` |
| Started | `2026-11-21T09:16:00.178Z` |
| Ended | `2026-11-21T12:58:05.429Z` |
| Session status | `completed`, exit code 0 |

---

## 3. Production seams inspected (the real boundaries)

These are the seams whose behaviour the ACT's hypotheses turn on. All paths are
relative to the repository root at `ENTRY_HEAD`.

### 3.1 Completion-tool definition and registration

| Seam | Location | Role |
|---|---|---|
| `createSubmitAndExitTool` | `sdk/packages/core/src/extensions/tools/definitions.ts:1224-1256` | defines `submit_and_exit`, `lifecycle.completesRun = true`, `retryable: false`, `maxRetries: 0`, 15 s default timeout |
| `createDefaultTools` | `sdk/packages/core/src/extensions/tools/definitions.ts:1300-1366` | registers the tool **iff** `enableSubmitAndExit && executors.submit`; also swaps `ask_question` out when submit is present (`definitions.ts:1353-1358`) |
| `DefaultToolNames.SUBMIT_AND_EXIT` | `sdk/packages/core/src/extensions/tools/constants.ts:21` | canonical tool name |
| model→flag mapping | `sdk/packages/core/src/extensions/tools/model-tool-routing.ts:57` | `submit_and_exit → enableSubmitAndExit` |
| preset default | `sdk/packages/core/src/extensions/tools/presets.ts:34,54` | `enableSubmitAndExit: false` (overridden by the host) |

### 3.2 Completion obligation producer (model-visible instruction)

| Seam | Location | Role |
|---|---|---|
| `getRequiredCompletionToolNames` | `sdk/packages/agents/src/agent-runtime.ts:1791-1799` | collects registered tools with `completesRun === true`, **sorted** |
| `getCompletionToolReminderMessage` | `sdk/packages/agents/src/agent-runtime.ts:1801-1813` | renders the obligation via the shared template |
| `buildCompletionToolReminderMessage` | `sdk/packages/shared/src/agents/completion-reminder.ts:47-56` | the exact byte-identical template |
| run-start injection | `sdk/packages/agents/src/agent-runtime.ts:1907-1910` | obligation injected as the first runtime-synthetic user message of the run |
| zero-tool-call injection | `sdk/packages/agents/src/agent-runtime.ts:2031-2045` | if a turn yields no tool calls, the obligation is re-injected and the loop continues |
| `findCompletingToolMessage` | `sdk/packages/agents/src/agent-runtime.ts:5106-5123` | a `completesRun` tool call with a **non-error** result terminates the run |

### 3.3 Host-side capability derivation (VS Code)

| Seam | Location | Role |
|---|---|---|
| `deriveExplicitCompletionAuthority` | `apps/vscode/src/sdk/cline-session-factory.ts:1391-1400` | derives `enableSubmitAndExit` from 4 canonical facts (interactive, YOLO_REQUESTED, SEATBELT_SELECTED, SEATBELT_AVAILABLE); Plan mode is excluded |
| `enableSubmitAndExit` on session config | `apps/vscode/src/sdk/cline-session-factory.ts:1427` | surfaced to the runtime builder |
| submit executor always populated | `apps/vscode/src/sdk/vscode-session-host.ts:391` | `toolExecutors.submit = options.submitExecutor ?? createVscodeSubmitExecutor()` — the *passive* executor; it acknowledges the summary and never mutates task state |
| runtime-builder threading | `sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:190, 636, 742, 847` | the host flag overrides the preset default |
| `requiresCompletionTool` derivation | `sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:882-886` | `finalTools.some(t => t.name === "submit_and_exit" && t.lifecycle?.completesRun === true)` |
| `completionPolicy` | `sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:919-928` | `requireCompletionTool: true` iff a completing tool survived policy filtering |

### 3.4 Compaction / task-contract conservation

| Seam | Location | Role |
|---|---|---|
| `extractActiveTaskContract` | `sdk/packages/core/src/extensions/context/task-contract.ts:137-188` | recovers objective + later user instructions + **runtime completion obligation** from canonical history |

---

## 4. Evidence sources used

| Source | Path (private, access-restricted) | Role |
|---|---|---|
| Session manifest | `~/.vscodium-roz/cline-data/sessions/1795252560069_t82cp/1795252560069_t82cp.json` | identity, usage, checkpoint, model |
| Session transcript | `…/1795252560069_t82cp.messages.json` (661 messages) | event ledger, tool calls, metrics |
| Compaction sidecar | `…/1795252560069_t82cp.compaction.json` (7 messages) | canonical compacted projection + task contract |
| Provider request captures | `~/.vscodium-roz/cline-data/provider-request-captures/` (340 files) | **the actual provider-visible request payload incl. tool schema** |
| Installed extension | `~/.vscodium-roz/extensions/s1onique.clinemm-4.1.26-6883c7c52/` | the binary that produced the session |

**Sensitive-data boundary.** The transcript contains the Round B finding text,
which itself references bootstrap-admin exposure. No raw credential, command
text, tool-result text or file content is reproduced in this ACT. The timeline
publishes structural identifiers, timestamps, byte counts and non-reversible
`sha256:` fingerprints only. The private captures remain outside Git and
access-restricted (`drwx------` on the capture directory; `0600` on the
capture files).

---

## 5. Existing tests / observability covering the inspected seams

| Seam | Existing coverage |
|---|---|
| `submit_and_exit` definition & registration | `sdk/packages/core/src/extensions/tools/definitions.test.ts:323-400` — default-excluded, included only with `enableSubmitAndExit` + executor, excludes `ask_question`, validates and executes the input |
| runtime completion policy | `sdk/packages/core/src/runtime/host/local-runtime-host.test.ts:8262-8490` — `task.completed` with `source=submit_and_exit`, `source=shutdown` fallback, exactly-once emission, no duplicate after shutdown |
| task-contract conservation | `sdk/packages/core/src/extensions/context/task-contract-conservation.test.ts`, `task-contract-budget-authority.test.ts`, `task-contract-conservation.historical.test.ts` |
| completion-reminder template | `sdk/packages/shared/src/agents/completion-reminder.ts` (producer/consumer shared definition) |
| deferred completion barrier | `apps/vscode/src/sdk/background-notify-coordinator.ts`, `command-status-tool.ts` |

---

## 6. Verification command run against the production seam

```
$ cd sdk/packages/core && bun x vitest run src/extensions/tools/definitions.test.ts --config vitest.config.ts
```

Exit code `0`; `87 passed (87)` in `1.24s`. Full output is captured in
`verification/01-production-seam-definitions-test.txt`.

This is the **control** case for the H2 hypothesis (see
`causal-discriminators.md`): the production seam that registers
`submit_and_exit` and exposes it to the model is exercised and green *at the
same source revision* as the historical session.

| `isCompletionToolReminderMessage` | `sdk/packages/shared/src/agents/completion-reminder.ts:72-90` | recognises the obligation by **byte-exact template equality** (producer and consumer share one definition) |
| `renderTaskContractSection` / `applyTaskContractToSummary` | `task-contract.ts:220-300` | idempotent carry-forward into the compaction summary |
| budget fail-closed | `task-contract.ts:503-514` | `TaskContractBudgetError` — never returns an un-contracted projection |
| provider-visible budget authority | `task-contract.ts:403-445` | measures the **provider-visible** projection, not the internal envelope |

### 3.5 Deferred-completion barrier (BCB01) — post-intervention only

| Seam | Location | Role |
|---|---|---|
| `KNOWN_COMPLETION_MECHANISMS` | `apps/vscode/src/sdk/background-notify-coordinator.ts:736` | `["submit_and_exit"]` |
| completion-continuation control | `apps/vscode/src/sdk/background-notify-coordinator.ts:580-624` | emits the `runtime-control: completion_continuation_control` message |
| installed runtime asset | `runtime-assets/completion-continuation-control.js` (+ `.sha256`) | shipped in the installed VSIX |
| installed runtime asset | `runtime-assets/deferred-completion-barrier.js` (+ `.sha256`) | shipped in the installed VSIX |

lineage, it cites `ENTRY_HEAD`. This ACT does **not** treat the local
`dist/extension.js` as the historical binary.
