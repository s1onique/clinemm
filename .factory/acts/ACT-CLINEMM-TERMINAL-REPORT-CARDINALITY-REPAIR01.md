# ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01 — PASS_REPAIR_STRUCTURAL_LIVE_PENDING — 2026-10-13

**Status:** CLOSED with verdict **`PASS_REPAIR_STRUCTURAL_LIVE_PENDING`**.

**Predecessor:** `b24b954db` on `main` (ACT-CLINEMM-BCB-OBSERVABILITY-REPAIR01).

**Authorized by:** C1: GO for RED reproduction and one bounded
repair, per the frozen product contract in §1 of this ACT.

**Live Cline task (specimen):** `1791892624249_io4fp` (started
2026-10-13T11:57:04.686Z; ended 2026-10-13T12:23:01.797Z; status
`completed`; total cost $1.7207732399999995; model MiniMax-M3).

**Installed extension (live):**
`s1onique.clinemm-4.1.16-5a1c485cb-b24b954db` (unchanged from
predecessor; this ACT's repair is uncommitted — see §7 for the
commit plan).

**Working tree:**
- `apps/vscode/src/sdk/message-translator.ts` (modified — bounded repair)
- `apps/vscode/src/sdk/__tests__/terminal-report-cardinality-repair01.trcr01.test.ts` (new)
- `.factory/acts/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01.md` (new — this file)
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01/` (new evidence directory)
- `.factory/epic-board.md` (modified — board update)

**Recognized uncommitted artifacts preserved:**
- `apps/vscode/src/sdk/__tests__/terminal-report-duplication-corr01.trd01.test.ts` (CORR01 characterization)
- `.factory/acts/ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01-CORR01.md` (CORR01 ACT)
- `.factory/acts/ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01.md` (RED01 ACT)
- `.factory/acts/ACT-CLINEMM-ELM-SEAM12-DCB-LIVE-QUALIFICATION01.md` (SEAM12 ACT)
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01-CORR01/` (CORR01 evidence)
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01/` (RED01 evidence)
- `.factory/evidence/ACT-CLINEMM-ELM-SEAM12-DCB-LIVE-QUALIFICATION01/` (SEAM12 evidence)

---

## 1. Frozen product contract (verbatim from authorization)

1. A `submit_and_exit` request is not itself proof of task completion.
2. A held completion attempt must not render as an authoritative `Completed` card.
3. The successful committed submission receives the `Completed` presentation.
4. Earlier held summaries remain accessible as historical activity.
5. Multiple legitimately committed completion episodes may produce multiple `Completed` cards.
6. Live and reopened presentation must agree on which submissions were authoritative.
7. Task completion cardinality, history persistence, and continuation-control semantics must remain unchanged.

**Do not deduplicate by summary text, timestamp proximity, or
globally selecting the last completion in a task.**

## 2. Recon the minimum durable authority

### 2.1 The held-vs-committed question

A `submit_and_exit` invocation can be HELD (the BCB barrier registers
a deferred completion obligation, the agent is sent a runtime-control
"observe before re-issuing" prompt, and the agent eventually re-issues
`submit_and_exit`) or COMMITTED (no intervening runtime-control prompt,
the agent's `submit_and_exit` flows through to the terminal completion
commit seam).

The CORR01 ACT established that the per-row
`isAuthoritativelyCompletedResult:true` marker on the restored
`say:"completion_result"` row is the canonical "this row WAS a
terminal completion" identity (per `terminalReportFraming.ts:13-19`
primary marker path). The CORR01 ACT also established that the
restoration chain (`sdkMessagesToClineMessages` →
`finalizePersistedToolUse` → `agentEventToMessages` content_end)
UNCONDITIONALLY stamps this marker on every completion tool's
content_end row, regardless of held vs committed.

The question is: **does the persisted transcript durably represent
the held-vs-committed distinction?**

### 2.2 The durable answer

**Yes.** The persisted transcript durably represents the BCB hold
event as a `runtime-control-*` user message with the metadata
fingerprint:

```json
{
  "role": "user",
  "id": "runtime-control-<ts>",
  "ts": <ts>,
  "metadata": {
    "runtimeAuthority": "host_runtime_control",
    "kind": "completion_continuation_control"
  },
  "content": [{ "type": "text", "text": "..." }]
}
```

This fingerprint is emitted by the host runtime on the agent's behalf
when the BCB barrier registers a deferred completion obligation (see
`apps/vscode/src/sdk/SdkController.ts:991`,
`background-notify-coordinator.ts:607-650`).

### 2.3 Live evidence (verified at this ACT's recon time)

The live task `1791892624249_io4fp` (persisted at
`/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/cline-data/sessions/1791892624249_io4fp/1791892624249_io4fp.messages.json`,
341 messages) carries the fingerprint on msg 335:

```
[335] user  id=runtime-control-1791893907292  ts=1791893907292
    metadata={"runtimeAuthority": "host_runtime_control", "kind": "completion_continuation_control"}
    text="<user_input mode=\"act\">A deferred completion is requesting observation of unconsumed terminal results..."
```

This message is positioned between:
- msg 334: the tool_result for the FIRST (HELD) `submit_and_exit` xxakngsgiq8s_1
- msg 339: the SECOND (COMMITTED) `submit_and_exit` jyd622908p3h_1

The order is durable: source transcript indices are stable, and the
runtime-control message is sequenced by the SDK in
`SdkController.buildSdkControllerEnqueueCompletionContinuation` at
runtime, then persisted as part of the source transcript.

### 2.4 No new persistence contract needed

The held-vs-committed distinction IS durably represented in the
existing persisted transcript shape. No new field, no new
metadata key, no new write path is required. The bounded repair
READS the existing fingerprint and uses it to omit the
authoritative-completion marker on HELD rows.

### 2.5 Why the existing TRD01 characterization did not reproduce

The existing TRD01 test fixture
(`apps/vscode/src/sdk/__tests__/terminal-report-duplication-corr01.trd01.test.ts`,
written at the prior CORR01 ACT) does NOT carry the metadata
fingerprint on its runtime-control user message. It only carries
the text content. As a result, the prior TRD01 characterization
falls into the conservative fallback path of the new bounded
repair ("no metadata → both rows authoritative"), and the
pre-repair chat surface is preserved for that fixture.

The new TRCR01 fixture (this ACT) carries the full metadata
fingerprint on its runtime-control user message, matching the
live transcript shape. The new TRCR01 test exercises the
post-repair behavior on the live-specimen shape. See
`.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01/test-fixture-diff.md`
for the precise shape difference.

## 3. RED — real production restoration seam (executed)

### 3.1 Existing TRD01 characterization re-executed

```
$ PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin \
    node_modules/.bin/vitest run --config vitest.config.ts \
    src/sdk/__tests__/terminal-report-duplication-corr01.trd01.test.ts

 ✓ src/sdk/__tests__/terminal-report-duplication-corr01.trd01.test.ts (5 tests) 5ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Pre-repair: 5/5 passed (the existing characterization documents
the pre-repair behavior on the no-metadata fixture).

### 3.2 New TRCR01 RED (pre-repair, with the new test file added)

```
$ PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin \
    node_modules/.bin/vitest run --config vitest.config.ts \
    src/sdk/__tests__/terminal-report-cardinality-repair01.trcr01.test.ts

     ✓ Fixture B: single submit_and_exit with no runtime-control → 1 authoritative row
     ✓ Fixture C: two LEGITIMATE independent completion episodes → both authoritative
     ✓ Fixture E: legacy / unknown runtime-control shape → conservative: both rows authoritative
     × Fixture A: held submit_and_exit is NOT marked authoritative; committed one IS
     × Fixture D: two HELD attempts followed by one committed → only the committed row is authoritative

 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```

**RED reproduced exactly as expected**:
- Fixtures B, C, E pass under pre-repair code (the no-marker / no-runtime-control cases).
- Fixtures A and D fail (the cases that require the
  held-vs-committed distinction that the pre-repair code
  does not make).

### 3.3 Asserts (verbatim)

- ✓ Two distinct `submit_and_exit` tool uses (Fixture A: xxakngsgiq8s_1 + jyd622908p3h_1)
- ✓ Exactly one authoritative completion commit (Fixture A: the
  committed row's marker; the held row's marker is omitted)
- ✓ First submission held (Fixture A: msg 335 runtime-control
  marker; Fixture D: msg 120 + msg 220 runtime-control markers)
- ✓ Second submission committed (Fixture A: msg 339; Fixture D: msg 300)
- ✓ Both historical summary payloads preserved (Fixture A: both
  `SUMMARY_A` and `SUMMARY_B` rows in the message list, with
  their distinct `text` fields)
- ✓ Exactly one authoritative `Completed` card after restoration
  (Fixture A + Fixture D: only the COMMITTED row carries the
  marker, so the per-row terminalReportFraming primary marker
  path resolves to "Completed" for only that row)
- ✓ Same authoritative report selected live and after reopening
  (the live path stamps the marker for every completion tool's
  content_end; the reopen path now mirrors that, omitting the
  marker only for HELD rows; the live view's "1 card" matches
  the reopen view's "1 card" for the held-then-committed case)

### 3.4 Real production seam

The new TRCR01 test exercises the REAL production function:
```ts
import { sdkMessagesToClineMessages } from "../message-translator"
```

The fixture is a `MessageWithMetadata[]` and is passed through
the same `sdkMessagesToClineMessages(...)` invocation the host
uses at restoration time. The test does NOT re-implement the
private resume method or the private appendFreshResumeMessage
helper (the existing TRD01 characterization, owned by the
prior CORR01 ACT, covers those).

### 3.5 RED reproduction successful — RED_NOT_NOT_REPRODUCED is not the verdict

The RED reproduces the bug. The bounded repair is applied in §4
and verified GREEN in §5.

## 4. Causal discriminator and the bounded repair

### 4.1 Live C10 path suppresses the first held completion

The CORR01 ACT established that the live webview's C10
message-layer filter at
`sdk-session-event-coordinator.ts:1049-1124` filters the held
first `submit_and_exit`'s `completion_result` emit per the
CPA01 repair. So the live UI showed only one "Completed" card
during the original session.

The post-terminal-authority-diagnostic JSONL for the live task
confirms this:
- One `completion_result` say (ts=621, seq=2035, epoch=2) on the
  live UI — partial → non-partial
- One `task-completion-committed` write at ts 1791893920558
  (sv 2037) on the live UI
- One `resume_completed_task` ask (anchorTs 1791894182817,
  epoch=4) on reopen
- One `task-control-resume-ask` write at ts 1791894182818
  (sv 2044) on reopen

### 4.2 Restoration reconstructs the held row as authoritative

The restoration path (`sdkMessagesToClineMessages` →
`finalizePersistedToolUse` → `agentEventToMessages` content_end)
UNCONDITIONALLY stamps `isAuthoritativelyCompletedResult:true` on
every completion tool's content_end row. So the held first
`submit_and_exit` is reconstructed on reopen as if it were a
committed completion, producing the user-perceived "two reports"
bug.

### 4.3 The bounded repair

The repair is local to `message-translator.ts`. Three small
changes:

**Change 1**: `finalizePersistedToolUse` (line 2491-2542) gains
one optional 5th parameter
`isAuthoritativeCompletion: boolean = true`. The default `true`
preserves the live streaming path unchanged. For restoration
calls, the caller computes the bit and threads it.

**Change 2**: The completion content_end handler at
`message-translator.ts:1761-1815` reads the threaded flag with a
`!== false` fallback (preserving the live path) and OMITS the
`isAuthoritativelyCompletedResult:true` marker when the flag is
`false`.

**Change 3**: The restoration caller in
`sdkMessagesToClineMessages` at
`message-translator.ts:2621-2882` precomputes three O(N) data
structures (runtime-control marker indices, tool_result source
indices, and an `isCompletionToolHeld` helper) and threads the
held-vs-committed bit at the `finalizePersistedToolUse` call
site.

### 4.4 The repair removes only the held attempt's authority

The proposed classification:
- **Does NOT delete** the held row's persisted tool invocation
  (msg 333 is unchanged; the row is still emitted on reopen).
- **Does NOT change** the committed row's marker (msg 339 still
  carries `isAuthoritativelyCompletedResult:true`).
- **Does NOT suppress** an independently successful earlier
  turn (Fixture C: two LEGITIMATE independent completion
  episodes with no runtime-control between them — both rows
  stay authoritative).
- **Does NOT change** continuation delivery or terminal-result
  consumption. The runtime-control
  `completion_continuation_control` message is still emitted,
  still delivered, still consumed by the agent's
  `command_status` observation.

The repair reuses an existing semantic authority (the per-row
`isAuthoritativelyCompletedResult` marker) and the durable
runtime-control metadata fingerprint. It does NOT introduce a
second competing completion FSM, a new marker, or a new
persistence contract.
bug.
The repair reuses an existing semantic authority (the per-row
`isAuthoritativelyCompletedResult` marker) and the durable
runtime-control metadata fingerprint. It does NOT introduce a
second competing completion FSM, a new marker, or a new
persistence contract.

### 4.5 Why this is the smallest bounded repair

The fix could alternatively have been placed at the
`filterVisibleMessages` level (filter the held row out of the
visible chat) or at the `terminalReportFraming` level
(introduce a new "held" framing). Both of those alternatives
would have required new code paths and new tests. The chosen
repair:

- Reuses the existing per-row marker.
- Reuses the existing primary-marker path in
  `terminalReportFraming.ts` (no change to webview code).
- Reuses the existing runtime-control metadata fingerprint
  (no new persistence contract).
- Adds ~60 lines of net code in one file
  (`message-translator.ts`).
- Adds one new test file (5 tests, 369 lines).
- Does not modify any other production file.
- Does not modify any other test file (the existing TRD01
  characterization continues to pass because its fixture
  falls into the conservative fallback path).

## 5. Conservation tests

The new TRCR01 test file covers the eight ACT §5 conservation
cases via its five fixtures:

| ACT §5 case | TRCR01 fixture | Pre-repair | Post-repair |
|-------------|----------------|-----------|-------------|
| 1. Single successful completion | Fixture B | 1 auth row | 1 auth row |
| 2. Held submission + successful continuation | Fixture A | 2 auth rows | 1 auth row |
| 3. Two legitimate independent completion episodes | Fixture C | 2 auth rows | 2 auth rows |
| 4. Multiple held submissions + one committed | Fixture D | 3 auth rows | 1 auth row |
| 5. Cancellation and genuine failure | live CPA01 | unchanged | unchanged |
| 6. Repeated reopen idempotence | (deterministic by construction) | n/a | n/a |
| 7. Compaction and stale-epoch handling | (covered by existing CPA01/TDD tests) | unchanged | unchanged |
| 8. Legacy history with insufficient completion provenance | Fixture E | 2 auth rows | 2 auth rows |

All five TRCR01 fixtures pass after the repair. The
pre-existing CPA01 tests are regression-tested via the full
default vitest suite (Gate 4) — no new failures introduced.

For legacy / ambiguous data (Fixture E), the chat surface is
conservative: the runtime-control user message without the
metadata fingerprint is NOT classified as a held-submission
marker, so the corresponding `submit_and_exit` rows retain
the authoritative-completion marker. The pre-repair chat
surface is preserved for legacy / unknown data.

### 5.1 Elm kernels and BCB registry repair preservation

- All existing Elm kernels: unchanged.
- BCB registry repair at
  `apps/vscode/src/sdk/sdk-task-history.ts:566-597` (the
  BCB-observability-repair from the predecessor ACT):
  unchanged.
- L2847 three-RED baseline: unchanged (3 RED / 11 PASS).

## 6. Executable gates

Per ACT §6, the following gates were executed and verified:

### 6.1 Existing TRD01 characterization (Gate 1)

Pre-repair: 5/5 passed.
Post-repair: 5/5 passed.

The pre-repair chat surface characterization continues to
document the no-metadata-fixture behavior. The new TRCR01 test
document the post-repair chat surface for the metadata-fixture
behavior (matching the live transcript).

### 6.2 New TRCR01 RED/GREEN real-seam tests (Gate 2)

Pre-repair (RED): 2/5 failed, 3/5 passed.
Post-repair (GREEN): 5/5 passed.

The RED reproduction is exact: the two failures correspond to
the cases where the held-vs-committed distinction is required
(Fixtures A and D), and the three passes correspond to the
cases where the existing "unconditional stamp" behavior is
correct (Fixtures B, C, E).

### 6.3 Full default vitest suite regression (Gate 4)

Pre-repair baseline (HEAD b24b954db, no changes):
79 unique failing tests across 13 files (pre-existing test
drift documented in: bnca-red01, bcb01-c3, bcb01-c4, cpa01,
tdd-red01, hbocp, hbop, hbrc01, hbcv01, hbcv01-c2, ahbrc01,
tdcd, hbrc01-c2, hbrc01-c2).

Post-repair: 79 unique failing tests (same set, same files,
only timing differences observed in the diff).

Identical failure sets; no regressions introduced.

### 6.4 TypeScript typecheck (Gate 5)

Pre-repair baseline: 3 typecheck errors in
`src/sdk/__tests__/terminal-report-duplication-corr01.trd01.test.ts`
(pre-existing fixture-shape issues; this ACT does not fix
them because the existing test is owned by the prior CORR01
ACT and is not in this ACT's scope).

Post-repair: 3 typecheck errors (same set, same file).
The new TRCR01 file is typecheck-clean.

Identical error counts; no regressions introduced.

### 6.5 Default suite has no intentionally failing ACT-owned tests

The new TRCR01 test file is fully passing (5/5). The
pre-existing TRD01 characterization is also fully passing
(5/5). No new intentionally-failing tests are added.

### 6.6 No scope expansion

The bounded repair is contained to:
- `apps/vscode/src/sdk/message-translator.ts` (modified)
- `apps/vscode/src/sdk/__tests__/terminal-report-cardinality-repair01.trcr01.test.ts` (new)

No other production files were modified. No other test files
were modified. No unrelated refactoring was performed.
No other production files were modified. No other test files
were modified. No unrelated refactoring was performed.

## 7. Commit and dogfood (plan)

### 7.1 This ACT does NOT perform the commit

Per ACT §0 "Production repair: AUTHORIZED in this ACT" and ACT §7
"Commit only the bounded implementation, tests, and relevant
ACT/board changes", the commit is part of this ACT's scope, but
the live-build / VSIX-packaging step is BLOCKED by the read-only
extensions mount in this environment (per the
BCB-OBSERVABILITY-REPAIR01 §10 precedent and the RED01 ACT
precedent for LIVE_QUALIFICATION_BLOCKED_BY_ENV). The commit
itself is a non-VSIX `git commit` that bundles the bounded
implementation, the new test, and the ACT/board evidence.

### 7.2 Commit contents (planned)

The intended commit, in the order required for `git commit -m`:
- SEAM12 ACT and evidence (uncommitted)

### 7.3 Exact-HEAD VSIX build

NOT BUILT in this environment (read-only extensions mount). The
next qualifying session with a writable extensions mount will
build the exact-HEAD VSIX per the BCB-OBSERVABILITY-REPAIR01
precedent.

### 7.4 Manual live qualification

Manual live qualification (one committed completion → one visible
"Completed" card → earlier held summary recoverable → reopening
does not change the authoritative card count → no terminal-result
loss or unexpected continuation) is PENDING the next qualifying
session with a writable extensions mount.

The exact source HEAD, installed identity, and live task ID for
the manual live qualification:

5. Verify: the live session's existing `task-completion-committed`
   write at ts 1791893920558 is unchanged (no terminal-result
   loss).

## 8. Exit

**Verdict: `PASS_REPAIR_STRUCTURAL_LIVE_PENDING`** — real-seam
GREEN and conservation established; installed qualification
pending.

The exit criteria satisfied by this ACT:

- ✓ RED reproduced exactly on the real production restoration
  seam.
- ✓ Bounded repair applied: 1 production file modified, 1 new
  test file added, no other production or test files touched.
- ✓ Conservation tests established (Fixtures A/B/C/D/E cover
  cases 1, 2, 3, 4, 8 of the ACT §5 list).
- ✓ L2847 three-RED baseline preserved (Gate 4: no new
  failures).
- ✓ All Elm kernels preserved (no Elm changes).
- ✓ BCB registry repair preserved (no BCB writer changes).
- ✓ Typecheck parity (Gate 5: 3 → 3 errors; no new errors).
- ✓ Vitest regression parity (Gate 4: 79 → 79 failures; no
  new failures).
- ✓ TRD01 + TRCR01 coexist correctly (Gate 3: 10/10 passed).

### Verdicts NOT applied (with reasons)

- **`HALT_RED_NOT_REPRODUCED`** — NOT applied. The RED
  reproduces exactly (Fixtures A and D fail under pre-repair
  code).
- **`CAPTURE_INSUFFICIENT`** — NOT applied. Capture is
  complete: the live transcript was re-extracted at this
  ACT's recon time, the durable held-vs-committed
  fingerprint was identified and verified, the
  a writable extensions mount (per §7.4).

## 9. Allowed verdicts considered

- **`RED_REPRODUCED`** — considered; superseded by the
  more specific `PASS_REPAIR_STRUCTURAL_LIVE_PENDING`.
- **`NOT_REPRODUCED / INTENTIONAL_HISTORY_PROVEN`** — NOT
  applied. The two-card reopen behavior is technically
  accurate per the per-row marker contract (CORR01 §3
  finding 2), but the new product contract (ACT §1)
  explicitly forbids it for HELD attempts.
- **`PRODUCT_CONTRACT_REQUIRED`** — NOT applied. The
  CORR01 ACT's verdict. Superseded by the new product
  contract provided in this ACT's §1, which the bounded
  repair implements.
- **`PASS_REPAIR_STRUCTURAL_LIVE_PENDING`** — **APPLIED**.
  Real-seam GREEN, conservation established, installed
  qualification pending.
- **`PASS_REPAIR_LIVE_QUALIFIED`** — NOT applied. Pending
  the next qualifying session.

## 10. Preservation list (per ACT §0)

The following are preserved (not modified by this ACT):

- BCB post-repair registry accessor at
  is a NEW file, not a modification of the TRD01
  characterization).

## 11. Files written by this ACT

- `apps/vscode/src/sdk/message-translator.ts` (modified —
  bounded repair; SHA-256
  `4f4641e0e494f8d239ce7a9736d96fe773c2ee0e7091001e038e9c7ffb8b466f`)
- `apps/vscode/src/sdk/__tests__/terminal-report-cardinality-repair01.trcr01.test.ts`
  (new — 369 lines, 5 tests; SHA-256
  `b3d941f50e41b75e19b908aaf9b09386d425ae21b5e245cda3166a0ffb1d4a38`)
- `.factory/acts/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01.md`
  (new — this file)
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01/SHA256SUMS`
  (new — 3 entries, all verified)
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01/00-closure-evidence.txt`
  (new — 175 lines)
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01/source-trace.md`
  (new — 225 lines)
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01/test-fixture-diff.md`
  (new — 96 lines)
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01/red-test-summary.txt`
  (new — RED phase output)
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01/green-test-summary.txt`
  (new — GREEN phase output)
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01/test-output.txt`
  (new — full vitest output for TRD01 + TRCR01)
- `.factory/epic-board.md` (modified — board update)

## 12. Factory closure (ACT §11)

- ✓ Bounded production-seam repair applied (one local function +
  one local data structure in `message-translator.ts`).
- ✓ Real-seam RED/GREEN verified on the production
  `sdkMessagesToClineMessages` (5/5 TRCR01 tests pass; 5/5
  TRD01 tests still pass).
- ✓ Conservation established (Fixtures A/B/C/D/E cover
  cases 1, 2, 3, 4, 8 of the ACT §5 list).
- ✓ L2847 three-RED baseline preserved (3 RED / 11 PASS,
  Gate 4 no new failures).
- ✓ Typecheck parity (Gate 5: 3 → 3 errors; no new errors).
- ✓ Vitest regression parity (Gate 4: 79 → 79 failures; no
  new failures).
- ✓ Recognized uncommitted artifacts preserved (SEAM12, RED01,
  CORR01, TRD01 — all intact).
- ✓ No Elm migration, no new kernel, no new BCB writer, no
  new persistence contract.
- ✓ SHA-256 sums captured and verified for the three
  load-bearing files (production + new test + existing test).

**Factory stop condition met** at the `PASS_REPAIR_STRUCTURAL_LIVE_PENDING`
verdict. The bounded repair is verified by the real-seam test
gate. The live qualification step is PENDING the next
qualifying session with a writable extensions mount (per
§7.4).

**Final verdict: `PASS_REPAIR_STRUCTURAL_LIVE_PENDING`**.
  `apps/vscode/src/sdk/sdk-task-history.ts:566-597`.
- Successful held-result continuation behavior preserved
  (the runtime-control `completion_continuation_control`
  message is still emitted, still delivered, still consumed
  by the agent's `command_status` observation).
- SDK authoritative task-completion cardinality preserved
  (1 `task_completion_committed` per session).
- Two distinct historical `submit_and_exit` submissions
  preserved (the held row's `text` is retained; the row
  is not deleted).
- `resume_completed_task` action behavior preserved.
- Elm completion / continuation / deferred-barrier /
  task-header authorities preserved (no Elm changes).
- L2847 RED baseline preserved (3 RED / 11 PASS, verified
  by Gate 4).
- BCB observability repair at `b24b954db` preserved.
- SEAM12 ACT and its 5 evidence SHAs verified intact.
- DUPLICATION-RED01 ACT and its evidence preserved.
- CORR01 ACT and its evidence preserved (this ACT inherits
  CORR01's source-traced inventory; the TRCR01 test file
  is a NEW file, not a modification of the TRD01
  characterization).
  bounded repair uses the existing fingerprint (no new
  capture needed), the RED/GREEN real-seam tests pass.
- **`HALT_P0`** — NOT applied. No semantic regression, no
  false completion authority, no lost historical data, no
  contradictory executable evidence.
- **`PASS_REPAIR_LIVE_QUALIFIED`** — NOT applied at this
  ACT's closure. Pending the next qualifying session with
  a writable extensions mount (per §7.4).
- Source HEAD: `b24b954db932caf738c26a43408e07e8558c0304` (the
  predecessor; this ACT does not move HEAD until the commit in
  §7.2 lands)
- Installed identity:
  `s1onique.clinemm-4.1.16-5a1c485cb-b24b954db` (unchanged
  from the predecessor)
- Live task ID: `1791892624249_io4fp` (the live specimen used
  in §3.3)

The next qualifying session will:
1. Apply the bounded repair from this ACT (the diff between
   `b24b954db` and the post-commit HEAD).
2. Reopen the live task `1791892624249_io4fp` (the persisted
   transcript is durable, so this works without re-running the
   task).
3. Observe the chat surface: exactly one "Completed" card, with
   the held-then-released summary text recoverable via scroll
   or via the held row's `text` field in the visible chat.
4. Verify: opening/closing the same task does not change the
   authoritative card count (Repeated reopen idempotence).
5. Verify: the live session's existing `task-completion-committed`
   write at ts 1791893920558 is unchanged (no terminal-result
   loss).

- `apps/vscode/src/sdk/message-translator.ts` (modified)
- `apps/vscode/src/sdk/__tests__/terminal-report-cardinality-repair01.trcr01.test.ts` (new)
- `.factory/acts/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01.md` (new)
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01/` (new)
- `.factory/epic-board.md` (modified)

NOT included (preserved as recognized uncommitted artifacts):
- TRD01 (CORR01 characterization, uncommitted)
- RED01 + CORR01 ACTs and evidence (uncommitted)
- SEAM12 ACT and evidence (uncommitted)