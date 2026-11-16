# ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 — Qualification Report

**Verdict: `CAPTURE_INSUFFICIENT`** (installed qualification not performed) — with a
complete, GREEN offline capture and a source-faithful production seam.

> **Correction status (2026-11-16).** `CORRECTION01.md` is authoritative for the
> final source correction. The final review verdict is
> `PASS_WITH_NONBLOCKING_RESIDUE`. The bundle SHA and source identity in this
> historical report describe the pre-correction working-tree build and MUST NOT
> be presented as the corrected artifact identity. Packaging and installed
> qualification remain operator steps from the corrected committed HEAD.

---

## 1. Source and artifact identity

| Item | Value |
|---|---|
| Actual source HEAD | `25517f509a9f00167f5a65dbdaa70b60198a8fef` |
| Expected predecessor | `d14979749` — it IS the parent of the discovered HEAD |
| S1 closure | The approved S1 correction was **already committed** at the discovered HEAD; the working tree was CLEAN at entry, so no new S1 commit was made and no S1 review was repeated. `S1_HEAD == 25517f509a9f00167f5a65dbdaa70b60198a8fef`. |
| Extension version | `4.1.16-5a1c485cb` |
| Built bundle | `apps/vscode/dist/extension.js`, 28,091,785 bytes, SHA-256 `a3096983adb0280d98ced953b12a007db711539c8957ca648ca228cd19d0d713` |
| VSIX | **NOT PRODUCED** — packaging was deferred to the operator |
| Installed version | `4.1.16-5a1c485cb-ef1ef40ab` (the PRIOR ACT's build) |
| Installed bundle SHA-256 | `7d633cae332fc99a27b0885b946bf47d62f2195b8fe3f144309d43a538beb37e` |
| Capture code in the installed bundle | **NO** (`compaction_decision` count = 0) |

The installed extension therefore **cannot be bound** to the intended source:
`HALT_ARTIFACT_MISMATCH` for the C5 installed qualification specifically.

## 2. Was a production change necessary?

**YES.** The reconnaissance found two real gaps, both on the existing
`onCompactionDiagnostics` channel — no new tracing subsystem was introduced.

* **GAP 1 — a no-op eligibility check was invisible.** The latency sink
  returned early when `compactionInitiated === false`, so the decision that
  did NOT compact left NOTHING in the trace. The comment said "observed",
  but nothing was recorded.
* **GAP 2 — the published payload carried only a subset.** The production
  resolver computed `rawMaxInputTokens`, `actualPreviousInputTokens`,
  `underestimateFactor`, `requestOverheadTokens`, `apiMessageTokens`,
  `messageCount`, `apiMessageCount` and `apiMessagesJsonChars`, but none of
  them reached the diagnostic. The calibration step was invisible, so the
  captured `maxInputTokens` could not be verified against the captured
  inputs.

The repair is 201 lines across 3 files:

| File | Change |
|---|---|
| `sdk/packages/core/src/extensions/context/compaction.ts` | Publish the production resolver's OWN already-computed budget/calibration/structure values; add a per-session decision ordinal and `decisionId`. NOTHING is recomputed. |
| `sdk/packages/core/src/observability/latency/latency-sink.ts` | Record EVERY eligibility evaluation as a POINT observation on the new `compaction_decision` boundary. The `compaction` boundary remains exclusively the EXECUTION boundary. |
| `sdk/packages/core/src/observability/latency/latency-trace.ts` | Add the `compaction_decision` boundary, the `recordPoint` mechanism (no span, no manufactured duration), the finite metadata allowlist entries, and the point-observed set that keeps a point observation out of the "unavailable" list. |

## 3. Exact decision records obtained

**Offline (production-seam) records — GREEN and complete.** These are produced
by the ACT's own focused tests driving the REAL `createContextCompactionPrepareTurn`.
They are **not** live dogfood records and are not presented as such.

| Scenario | `mode` | `shouldCompact` | `compactionInitiated` | Execution span |
|---|---|---|---|---|
| Below threshold | `auto` | `false` | `false` | none |
| Above threshold | `auto` | `true` | `true` | exactly 1 |
| Provider calibration | `auto` | — | — | factor verified against production |
| User context ceiling | `auto` | — | — | `inputBudgetSource='userCeiling'` |
| Manual compaction | `manual` | `false` | `true` | — |
| Overflow recovery | `overflow_recovery` | — | `true` | — |
| Unknown model limit | `auto` | **no decision record** | — | none (the seam returns before deciding) |
| Consecutive decisions | `auto` | — | — | 3 distinct `decisionId`s, ordinals 0/1/2 |

**Live records: NONE.** No live automatic-compaction decision was captured,
because the installed dogfood qualification was not performed.


## 4. Was the production threshold calculation correct?

**YES — internally.** In every offline scenario the captured `shouldCompact`
equals the production policy recomputed from the captured values:

```
expectedTrigger     = capturedMaxInputTokens * COMPACTION_TRIGGER_RATIO   (0.9)
expectedEligibility = capturedRequestInputTokens >= expectedTrigger
```

and the calibration chain holds:

```
capturedMaxInputTokens       == capturedRawMaxInputTokens / capturedUnderestimateFactor
capturedRequestTriggerTokens == capturedMaxInputTokens * 0.9
```

**Important limitation:** an internally correct decision may still rest on an
inaccurate token estimate. This ACT does not claim the estimate is accurate.

## 5. Was the request representation source-faithful?

**YES.** The estimator consumed `context.apiMessages` — the API-safe projection
the production orchestrator supplies via
`prepareProviderMessagesForApi` → `MessageBuilder.buildForApi` — and not the
raw canonical history. The upstream v4.1.26 correction is present on BOTH the
first-compaction and re-compaction paths. The conservation test asserts that
the captured message counts are the counts of the projection the seam was
**handed**: the capture never invokes the stateful production `MessageBuilder`
a second time.

The four representations are kept distinct: canonical history, API-safe
projected candidate, post-compaction continuation, and the final
provider-submitted request.

## 6. Could estimator/provider accuracy be measured?

**NO — `CAPTURE_INSUFFICIENT`.**

* The decision candidate is **never submitted**, so no provider ever reported
  its input tokens. Its provider-measured count is `LIVE_UNOBSERVABLE`.
* No matched decision→dispatch observation was captured
  (`PROVIDER_DISPATCH_JOIN_UNAVAILABLE`).
* Therefore the estimator cannot be compared against provider usage for the
  decision candidate, and the previous request's usage is **not** a valid
  substitute.

What the ACT explicitly does **not** claim: that the pre-compaction candidate
equals the post-compaction submission; that the previous request's usage is an
error against a new candidate; that character estimates are provider token
counts; or that the historical ten compactions were premature.

## 7. Did diagnostic overhead or truncation affect the capture?

**No, in the offline capture.**

* **Overhead:** the diagnostic adds no production work when OFF — the
  decision ordinal is allocated ONLY when the sink is armed, no collector is
  allocated, no persistent record is written, no asynchronous task is created.
  The C3.3 conservation test compares tracing OFF vs ON across the canonical
  input, the prepared provider-visible messages, the compaction decision, the
  compacted continuation and the provider dispatch arguments: all IDENTICAL.
* **Truncation:** the existing 4096-event ring applies. The retention-overflow
  scenario drives 5000 decisions and asserts `truncation.truncated === true`
  with `droppedEventCount > 0` — explicit truncation metadata, no invented
  continuity.
* The `compaction_decision` point observation is never reported as an
  unavailable measurement and never leaves a "span left open" integrity
  failure.

## 8. Which historical claims remain `UNAVAILABLE_FROM_TRACE`

## 9. Is another full Round C justified?

**NO — `CAPTURE_INSUFFICIENT`.** The Round C gate requires an installed
dogfood trace capture that is qualified AND decision-time records attributable
to their originating turn. The offline capture is complete, but the installed
qualification has not been performed.

**Do not start Round C.** Do not attempt another long benchmark.
## 10. Next step — operator procedure

The build inputs are already in place: the SDK `dist/` and
`apps/vscode/dist/extension.js` both carry the capture code
(`compaction_decision`, `recordPoint`, `underestimateFactor`,
`apiMessagesJsonChars`, `decisionOrdinal`).

1. **Package** the exact-head VSIX. `vsce` hardcodes `npm run <prepublish>`
   and this repository uses bun, so either put a minimal `npm` shim on `PATH`
   that delegates `npm run X` to `bun run X`, or temporarily override the
   `vscode:prepublish` script and restore it afterwards. The prepublish
   (`bun run package`) has **already been executed successfully** at this
   source, so the bake-in is current.
2. **Install** into the isolated VSCodium dogfood profile
   (`~/.vscodium-roz`), not the ordinary profile.
3. **Launch** with `CLINEMM_RUNTIME_PROFILE=dogfood` and confirm the running
   extension host reports that profile.
4. **Run** a disposable task (one ordinary model turn and one harmless tool
   operation), then invoke `Cline Debug: Dump Latency Trace`
   (`cline.debug.dumpRoundcLatencyTrace`).
5. **Verify** the exported trace contains `compaction_decision` events with
   the decision-time fields, that a false decision opened NO execution span,
   and that the truncation metadata is present. Record the live decision into
   `decision-capture.json`.
6. **Exercise** an automatic compaction. Prefer reaching it naturally; if
   impractical, an explicitly labelled `PROBE_CONFIGURATION` with a smaller
   user context ceiling is acceptable (production algorithm unchanged,
   restored and independently verified afterwards).

## 11. Repository conservation

* `stash@{0}` **PRESERVED** — not popped, not dropped, not rewritten.
* All 6 worktrees preserved; no temporary stash was ever created (the
  baseline comparison used file copies under `/tmp`).
* No history rewrite, no force-push, no deployment, no PR, no push.
* The Keycloak repository was not touched.
* One test-regenerated timestamp in
  `.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md`
  was observed during a VS Code suite run and restored; it is not ACT-owned.
* The VS Code `src/sdk/` suite has **67 failing files / 176 failing tests**
  both WITH the change and at the HEAD baseline — identical counts, so none
  is attributable to this ACT.


* Whether each of the **ten historical Round C compactions** was justified —
  the decision-time estimate, threshold and calibration factor were never
  recorded before this ACT.
* The provider-measured input tokens of any unsubmitted pre-compaction
  candidate.
* The provider-reported model id and quantization for any historical run.
* Whether any historical compaction's threshold was internally correct under a
  calibration factor that was never captured.
