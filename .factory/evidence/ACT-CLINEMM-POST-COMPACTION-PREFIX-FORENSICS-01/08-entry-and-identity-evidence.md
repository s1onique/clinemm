# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01 — Entry & Identity Evidence

---

## 1. Repository state at entry

| Item | Value |
|---|---|
| Repository root | `<local-checkout>/clinemm` |
| Remote | `git@github.com:s1onique/clinemm.git` |
| Branch | `main` |
| HEAD (entry) | `b0c5a0b232d4fb13291a754e1ac337e4e99b87fb` |
| HEAD subject | `ACT-CLINEMM-MCP-SUPERVISION-V2-CORR01: correct the two P0s` |
| Working tree at entry | **CLEAN** — `git status --short` empty |
| Unexpected tracked dirt | **NONE** → no `HALT_UNEXPECTED_TRACKED_DIRT` |
| History rewrite / force push | **NONE** |
| Push / PR | **NONE** |
| Installed-extension replacement | **NONE** |
| Inference-service restart | **NONE** |

### 1.1 Protected worktrees and stashes — preserved, untouched

| Item | Value | Action |
|---|---|---|
| `git stash list` | **EMPTY** | no stash was popped or dropped |
| `<tmp>/clinemm-stash-recovery-20261117` | `8b76c9e3e` `recovery/protected-stash-20261117` | untouched |
| `<tmp>/worktree-bun.7ddCHQ` | `bbdccf8a2` (detached, prunable) | untouched |
| `../clinemm-m31-action-first` | `38e726c45` `experiment/m31-action-first` | untouched |
| `../clinemm-m31-bounded` | `0366ea506` (detached) | untouched |

No worktree was created, removed, moved or pruned by this ACT.

---

## 2. Installed ClineMM versions and extension-bundle digests

The analysed captures were written by these INSTALLED extensions, each
identified independently by reading its own installed directory:

| Host profile | Installed extension | Extension bundle SHA-256 (`dist/extension.js`) |
|---|---|---|
| `course` | `s1onique.clinemm-4.1.16-5a1c485cb-691cf26ff` | `e6f3ca0905078f245043d48359b554581ec908ff39e49693a8e244f012375ed7` |
| `kurchatov` | `s1onique.clinemm-4.1.26-acea67fc2` | `fea80110d7b6277476ac54432bab491259c9b3d29ae34b2cff80bac89a2663bf` |

The `clientVersion` recorded **inside** the analysed capture records is
`4.1.16-5a1c485cb` for the `course` corpus — i.e. the capture's own
provenance agrees with the installed directory it was found in.

---

## 3. The existing dogfood tracing and capture configuration

The ACT reuses, and does not replace, the following EXISTING infrastructure:

| Mechanism | Where | Role in this ACT |
|---|---|---|
| `CLINE_CAPTURE_PROVIDER_REQUEST` (`off`/`summary`/`full`) | `sdk/packages/llms/src/providers/provider-request-capture.ts:31` | The pre-existing provider-request capture. Its `ai_sdk_prompt` stage is the corpus this ACT analysed. |
| `CLINE_CAPTURE_WIRE` | same file, `:39` | The pre-existing wire-capture switch. **Never enabled** in any preserved run → 0 wire records. |
| `CLINE_CAPTURE_DIR` / `CLINE_DATA_DIR` | same file, `:54` | The pre-existing capture directory resolution, reused by the new writer. |
| `modelBehaviorTraceIdentity` | `sdk/packages/shared/src/runtime/model-behavior-trace.ts:71` | The C2 correlation identities (`preparationRequestId`, `modelRequestId`, `sessionId`, `iteration`). |
| `computeFinalProjectionFingerprint` | `sdk/packages/shared/src/runtime/compaction-token-evidence.ts:257` | The existing final-projection fingerprint contract, whose "a CONTENT fingerprint is NOT a WIRE-request fingerprint" warning the new capture reproduces. |
| `summarizeWireReasoning` | `sdk/packages/llms/src/providers/provider-request-capture.ts:251` | The existing wire-reasoning view, reused unchanged. |
| `isProviderDispatchRecordRequired` | `sdk/packages/shared/src/runtime/model-behavior-trace.ts:2739` | The existing "no observer ⇒ no work" guard pattern the new capture follows. |
| `LatencyTraceSink` / `ModelBehaviorTraceSink` | `sdk/packages/core/src/observability/latency/latency-sink.ts` | The existing sink composition; the new capture is a SEPARATE opt-in, not a new sink. |
| `installRoundcLatencyTraceSink` / `dumpRoundcLatencyTrace` | `apps/vscode/src/sdk/roundc-latency-trace-runtime.ts:181`, `:659` | The existing Round C artifact writer, used as the model for the new artifact's identity fields. |
| `wrapFetchForProviderRequestCapture` | `sdk/packages/llms/src/providers/provider-request-capture.ts:646` | The existing wire seam; the new stage-C capture is invoked INSIDE it. |

**No second general-purpose tracing framework was introduced.** The new
capture reuses the existing writer's directory resolution, atomic
write-then-rename discipline, restrictive file mode and attempt-correlation
counters.

---

## 4. Current provider, model and serving-engine identity

### 4.1 The provider / model observed in the analysed captures

| Field | Value | Source |
|---|---|---|
| `providerId` | `minimax` | the capture's own `correlation` block |
| `modelId` | `MiniMax-M3` | the capture's own `correlation` block |
| `clineCoreVersion` | `0.2.0` | the capture's own `correlation` block |
| `distinctId` / `sessionId` / `runId` / `iteration` | present | the capture's own `correlation` block |

### 4.2 The serving engine, verified live on 2026-11-20

| Property | Value | Method |
|---|---|---|
| Strata endpoint | `http://192.168.50.111:8080` | — |
| `GET /health` | `{"status":"ok","max_context":131072,"model":"qwen3.8-flash-next-iq3_s","loaded":true,"service":"strata"}` | live, HTTP 200 |
| `GET /v1/tokenize` | **404** | live |
| `GET /tokenize` | **404** | live |
| Local engine `http://127.0.0.1:8000/health` | `{"status":"ok"}` — a **DIFFERENT** provider (models `qwen3.6-35b-a3b:16gb`, `flint:16gb`); **out of scope** | live |
| Local engine `GET /tokenize` | **404** | live |

**Note on the model identity.** The engine reports `qwen3.8-flash-next-iq3_s`
and the preserved captures report `minimax` / `MiniMax-M3`. These are
**different fields of different systems**: the captures are ClineMM's
configured provider/model pair, and the engine is the serving system
reachable at the Strata address. The ACT does **not** claim they are the
same serving path — that would be an inference, not an observation.

---

## 5. The evidence corpus this ACT analysed

| Property | Value |
|---|---|
| Location | `~/.vscodium-<host>/cline-data/provider-request-captures/` (16 host profiles) |
| In Git | **NO** — outside the repository, under the operator's control |
| Modified by this ACT | **NO** — read only |
| Records | 24,864 files scanned; 24,862 distinct `ai_sdk_prompt` records; **0** `wire_request` records |
| Capture mode | `full` (the pre-existing `CLINE_CAPTURE_PROVIDER_REQUEST=full`) |
| Corpus re-expressed as | 173 sanitized forensic records (the `course` / `run_dL4t9n8M` run), cohort `livecohort000001` |
| The cohort KEY | generated for this analysis, **not published, not committed** |

---

## 6. Live qualification status

The ACT's Section 10 requires a live qualification run that reproduces the
cache behaviour. The ACT's Section 10 ALSO says:

> *First inspect preserved historical capture files for an eligible
> post-compaction request pair. If none exists, instrument the installed
> dogfood build and collect the next naturally occurring useful session.*

**An eligible post-compaction request pair DID exist.** The preserved corpus
contains 20 compaction boundaries, of which 3 carry an in-place mutation at
message index 11 / 27 / 41, and the `course` corpus contains 172
consecutive request pairs. The ACT therefore used the preserved corpus and
did **not** repeat the Round C workload.

**The consequence is stated plainly:** the ACT reproduces the CLIENT-SIDE
mutation that is sufficient to explain a shallow, sticky prefix cache, but
it does **not** claim a live reproduction of the ENGINE's `cached_tokens`
behaviour in the same run, because that would require issuing new provider
requests against the serving engine — which the ACT explicitly does not do
without operator authorization, and which the "no additional provider
request" constraint of the instrumentation forbids.

The classification in `09-causal-classification.md` accounts for this
explicitly.
