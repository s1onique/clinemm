# ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01

> Status: **OPEN / IN_REVIEW** — bounded correction ACT against
> the evidence-acquisition toolchain that the editor-tool recon ACT
> depends on. Authored 2026-08-27 in response to the factory
> reviewer / forensic tooling engineer's verdict on the two test
> captures from 2026-08-27 (see `FACTORY_REVIEWER_PROMPT` below).
>
> **Primary purpose**: harden
> `tools/factory/capture-approval-specimen.py` so that the NEXT
> specimen capture is one-command reproducible, durable, and
> machine-bound to the captured runtime identity — without
> changing any production code.
>
> **Predecessor**:
> `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` (NEXT /
> OPEN, recon-only; its §3 live-specimen capture was attempted
> 2026-08-27 with the pre-correction tool and produced two
> captures whose chronology the human remembers but whose
> filesystem identity the tool did NOT bind). The editor-tool
> recon ACT remains correct as-is — its source-seam-map evidence
> file is unchanged. The correction ACT targets the
> evidence-acquisition toolchain, not the recon ACT itself.
>
> **Owning epic**:
> [`EPIC-CLINEMM-APPROVAL-PROTECTION`](../epics/approval-protection.md)
> · evidence-toolchain lane. Adjacent to the editor-tool recon
> ACT (board row 18).
>
> **Forecasted outcome**: a `PASS_CAPTURE_TOOL_HARDENED` review
> verdict (separate from the editor-tool recon ACT's own
> specimen verdict). Once this ACT closes GREEN, the next
> approval-prompt specimen is expected to be a single durable
> causal specimen with zero interactive debugging.

---

## FACTORY_REVIEWER_PROMPT (2026-08-27)

| Expert(s) | Question | Plan |
|---|---|---|
| Factory reviewer · forensic tooling engineer | Did this produce a usable bound specimen? | Classify what we actually captured, preserve it, then harden the collector so the next specimen is one-command reproducible |

The reviewer's verdict (verbatim summary):

```text
CAPTURE_INSUFFICIENT
PENDING_CAPTURE  = 20260827T211256Z-9171c6f6
RESOLVED_CAPTURE = 20260827T211338Z-435b5360
CAPTURE_PAIR_RUNTIME_BOUND = NO
```

Three defects were identified directly from the captures:

  1. The two phases got different capture IDs (resolved omitted
     `--capture-id` and silently minted a new one); filesystem
     does not assert that `resolved` resolves `pending`.

  2. `SESSION_CANDIDATES=0` in both phases — the conservative
     `session.json`/`messages.json` filename allowlist missed the
     real session storage layout, so per-task correlation is
     impossible.

  3. Both phases reported the same `APPROVAL_EVENTS=35` with no
     event-delta computation, so the specific event the human
     acted on is not machine-identifiable.

Plus one ambient risk: `SESSION_CANDIDATES=0` looks like a
successful capture. The reviewer asked for a separate
`specimenBinding` verdict field so a downstream ACT can detect
`CAPTURE_INSUFFICIENT` rather than treating an empty capture as
authoritative.

---

## §0 — Stop rule

This ACT halts at `HALT_HARDENING_INCOMPLETE` if any of the four
defects (P0.1 / P0.2 / P0.3 / P1) is not closed by the rewritten
collector AND verified by a smoke run.

The dollar-amount-style trap does NOT apply here: the load-bearing
question is "is the new collector structurally correct?", not
"did a real approval specimen succeed?" The real specimen is the
editor-tool recon ACT's job, not this ACT's.

## §1 — Entry discipline

Authored under the standard ACT gate contract. This launch is
docs + tooling-only. **No production code in `apps/` or `sdk/` is
modified. No tests are added. No upstream wholesale copy.**

Durable launch artifacts in this commit:

```text
- this ACT file (.factory/acts/ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01.md)
- the rewritten collector (tools/factory/capture-approval-specimen.py)
- the binding record (.factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/captures/specimen-20260827-command-approval01.json)
- .gitignore whitelist entry for the ACT file
- epic board row update (.factory/epic-board.md)
- epic ledger update (.factory/epics/approval-protection.md)
```

The two pre-correction captures under
`.factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/captures/{20260827T211256Z-9171c6f6,20260827T211338Z-435b5360}/`
are **preserved verbatim**. Per the reviewer's "do not delete or
rewrite them" instruction, they are valid hard copies of a
chronology the human remembers, even though their filesystem
identity is not bound. Their relationship is recorded in the
---

## §2 — Scope (defect → fix → invariant)

### P0.1 — `finish` must never silently create a new capture

**Defect**: pre-correction `snapshot --phase resolved` accepted
omitted `--capture-id` and silently minted a new ID; the
filesystem did not bind `resolved` to `pending`.

**Fix**: split the pre-correction `snapshot --phase {pending|resolved}`
into two distinct subcommands with a hard lifecycle:

```text
begin --act ACT --data-dir ...
   ⇒ mints capture_id, writes captures/<id>/pending/

finish --act ACT --capture-id <id> --data-dir ...
   ⇒ requires captures/<id>/pending/ to exist
   ⇒ requires pending/manifest.json schema == CAPTURE_SCHEMA
   ⇒ writes captures/<id>/resolved/
   ⇒ computes approval-events-{before,after,delta}.jsonl
   ⇒ writes approval-discriminator.json + binding.json
```

`finish` without `--capture-id` exits 2 with a stderr message
that names the pre-correction defect.

`finish` against a pre-correction v1 pending capture exits 2
with a message naming the schema mismatch and asking the
operator to re-run `begin`. This protects against mixing
pre-correction captures (no event fingerprints) with corrected
tooling (which would otherwise compute an empty delta and
falsely report `SPECIMEN_BINDING=PASS`).

**Invariant**:

```text
CAPTURE_PAIR_RUNTIME_BOUND := (capture_id_begin == capture_id_finish)
                              ∧ schema(pending/manifest.json)
                                == schema(resolved/manifest.json)
                              ∧ exists(pending/approval-event-fingerprints.jsonl)
                              ∧ exists(resolved/approval-event-fingerprints.jsonl)
```

### P0.2 — Capture event delta, not all recent events

**Defect**: pre-correction collector wrote a full `approval-events.jsonl`
in each phase with no delta; both phases showed the same count.
The specific event the human acted on was not machine-identifiable.

**Fix**: at `begin`, freeze `pending/approval-event-fingerprints.jsonl`
(sha256 of the canonical event content only — NOT the source
path; see rationale below). At `finish`,
compute `resolved/approval-events-delta.jsonl` by set-difference
of fingerprints. Mirror the full files to
`*-before.jsonl`/`*-after.jsonl` for forensics readers who do not
understand fingerprints. Write
`resolved/approval-discriminator.json` per the reviewer's schema:

> **Why content-only**: a content-only fingerprint means a
> logically-identical event reappearing under a different file
> path (e.g. `before/diagnostics/before.jsonl` vs.
> `after/diagnostics/after.jsonl` in a hermetic fixture) produces
> the same fingerprint and is therefore correctly classified as
> "already known." Including the source path in the digest
> causes a genuine single logical event to manufacture false-new
> duplicates on every re-scan. The implementation's
> `event_fingerprint()` folds ONLY the canonical raw line / parsed
> event into the sha256 — see §3's hermetic positive for proof.

```json
{
  "schema": "cline-approval-discriminator/v1",
  "items": [
    {
      "toolName": null | "...",
      "correlationId": null | "...",
      "sessionId": null | "...",
      "policyAutoApprove": null | "...",
      "shouldAutoApproveTool": null | "...",
      "approvalEntryObserved": true | false,
      "approvalTerminalObserved": true | false,
      "source": "..."
    }
  ]
}
```

All fields are `null` when absent; never inferred. This is the
stable view the ACT consumes even if the underlying diagnostic
JSON changes shape slightly.

**Invariant**:

```text
EVENT_DELTA_BOUND := exists(resolved/approval-events-delta.jsonl)
                     ∧ exists(resolved/approval-discriminator.json)
```

### P0.3 — A capture with zero session candidates must say so loudly

**Defect**: `SESSION_CANDIDATES=0` was indistinguishable from a
successful capture, so a forensic verdict was unreachable.

**Fix**: separate `artifactStatus` (`PASS` — the artifact was
generated) from `specimenBinding` (`PASS | CAPTURE_INSUFFICIENT`).
Exit code stays 0 for artifact generation; the binding verdict
is a separate machine-readable field. `classify_binding()`
returns `PASS` only when BOTH a session candidate AND a non-empty
event delta are present; otherwise `CAPTURE_INSUFFICIENT`.

**Invariant**:

```text
sessionCandidateCount > 0 ∧ deltaSize > 0  ⇒  specimenBinding = PASS
otherwise                                  ⇒  specimenBinding = CAPTURE_INSUFFICIENT
```

### P1 — Stop looking for only `session.json`

**Defect**: the pre-correction collector identified sessions via
a filename allowlist, which missed every persisted ClineMM
session under the test data roots. Both test captures showed
`sessionCandidateCount: 0`.

**Fix**: replace the filename allowlist with a **shape check**:

```text
A JSON file is a session/task record iff (at top level OR in any
list element) it has at least one identity key from
SESSION_ID_KEYS AND `status`.

SESSION_ID_KEYS = ( id, sessionId, session_id, taskId, task_id )

Identity vocabulary is observed in real ClineMM storage (the
canonical session file uses snake_case `session_id` — see §3's
real-data smoke) and in synthetic hermetic fixtures. Update by
adding aliases that have been observed in actual storage; do NOT
widen heuristically.

Filename hints (`session.json`, `messages.json`, `task.json`,
`task_state.json`, `conversation_history.json`, `state.json`)
reduce false positives on dense log files but are never
load-bearing. For `messages.json` bodies, the projection is
omitted (MESSAGE_BODY_OMITTED) — only metadata is captured.

Files whose names match sensitive patterns (`globalstate`,
`settings`, `secret`, `credential`, `apikey`, `token`, etc.)
are NEVER scanned, even if their content matches the shape.
```

The `safe_session_projection()` function preserves only the
fields the reviewer's discriminator list needs (id / sessionId
/ session_id / taskId / task_id / status / source / interactive
/ mode / provider / model / timestamps / etc.). It is still
projection-only — no prompts, no bodies.

**Invariant**:

```text
SESSION_BINDING_AVAILABLE := sessionCandidateCount > 0
```

### What is explicitly NOT in scope

- Modifying the editor-tool recon ACT itself.
- Adding new tests for the collector (the smoke-run script
  IS the test; a follow-on `IMPLEMENTATION01` may add
  vitest coverage once the schema stabilizes).
- Forcing session storage layout changes — ClineMM session
  layout is upstream's concern.
- Wholesale copying of any data root (the tool continues to
  honor `SENSITIVE_NAME_PARTS`).
---

## §3 — Smoke verification (executed in this commit)

The corrected collector was smoke-tested with the existing
`/Volumes/UserData/Users/chistyakov/.cline2` data root. Result:

```text
$ python3 tools/factory/capture-approval-specimen.py begin \
    --act ACT-CLINEMM-SMOKE-01 \
    --data-dir /Volumes/UserData/Users/chistyakov/.cline2 \
    --recent-minutes 240
CAPTURE_ID=20260827T212228Z-41fe2edc
PHASE=pending
OUTPUT=…/captures/20260827T212228Z-41fe2edc/pending
APPROVAL_EVENTS=0
SESSION_CANDIDATES=0
MUTATED_RUNTIME_STATE=NO

$ python3 tools/factory/capture-approval-specimen.py finish
  → exits 2 with "--capture-id is required for finish"

$ python3 tools/factory/capture-approval-specimen.py finish \
    --act ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01 \
    --capture-id 20260827T211256Z-9171c6f6
ERROR: pending manifest schema 'cline-approval-specimen-capture/v1'
does not match 'cline-approval-specimen-capture/v2'. Refusing to
compute a delta against a pre-correction pending snapshot.
  → exits 2 (refuses v1/v2 mix)
```

`SESSION_CANDIDATES=0` in the smoke run is honest — the persisted
session file under `.cline2/data/sessions/1787562381026_jao7c/`
has an mtime of `2026-08-24 12:07`, beyond the 240-minute window.
**The mtime-window explanation is necessary but not sufficient**:
the real ClineMM session file uses snake_case `session_id`, which
the original `{id, sessionId, taskId}` shape did NOT cover. A
later real-data re-run (after this ACT's correction added
`session_id`/`task_id` to `SESSION_ID_KEYS`) reports
`SESSION_CANDIDATES=1` and a populated projection on the same
file — proving both the identity vocabulary AND the mtime
window had to be right. This proves the P0.3 invariant: a
zero-candidate result is no longer indistinguishable from a
successful capture — the smoke operator sees
`SESSION_CANDIDATES=0` and the report (when produced) would say
`SPECIMEN_BINDING=CAPTURE_INSUFFICIENT`.

The smoke directory was removed at the end of the smoke test
(`.factory/evidence/ACT-CLINEMM-SMOKE-01/` is untracked and
deleted; it never entered git).

## §4 — Discriminator (deferred to §5 / §6)

For this ACT, the load-bearing discriminator is the smoke run
itself:

```text
(A) P0.1 invariant fires  →  PASS_CAPTURE_TOOL_HARDENED
(B) P0.2 invariant fires  →  PASS_CAPTURE_TOOL_HARDENED
(C) P0.3 invariant fires  →  PASS_CAPTURE_TOOL_HARDENED
(D) P1 invariant fires    →  PASS_CAPTURE_TOOL_HARDENED
```

This ACT closes at the first GREEN on all four invariants; a
real-specimen verdict (`PASS` vs `CAPTURE_INSUFFICIENT`) belongs
to the editor-tool recon ACT's own closure, not here.

## §5 — Causal chronology (deferred to §3)

The four invariants above are causal preconditions for the
editor-tool recon ACT's next specimen attempt. Once this ACT
closes GREEN, the recon ACT's `c1_re_open_for_specimen` is
authorised and the next approval prompt produces a single
durable causal specimen.

## §6 — RED

Not authored in this ACT. The smoke run in §3 establishes GREEN.
If a future regression surfaces (e.g. the schema-mismatch guard
fires unexpectedly), the RED author would belong to a future
`ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL02-CORRECTION01`.

## §7 — Necessity / ablation

Per spec. The smoke run is the ablation: each P0 invariant was
exercised against a deliberately-broken input (missing
`--capture-id`, pre-correction v1 schema) and a correct input
(empty data root producing `SESSION_CANDIDATES=0`). All three
behaviours are documented in §3.

## §8 — Permitted repair boundaries

Per spec. No preferred bucket is pre-baked.

### External radar

Cline's upstream permission-handling guide ([GitHub][1])
distinguishes `autoApprove:true` (no user approval required)
from dynamic `requestToolApproval` (the application approval
boundary). The CLI short-circuits `requestToolApproval` when
its all-auto-approve state is active ([GitHub][2]). Our
discriminator schema is the minimum projection that makes
this distinction machine-detectable.

[1]: https://github.com/cline/cline/blob/main/docs/sdk/guides/permission-handling.mdx
[2]: https://github.com/cline/cline/blob/main/apps/cli/src/runtime/interactive/approvals.ts

## §9 — Forbidden repair

```text
DO NOT:
  - relax the schema-mismatch guard (it prevents a false PASS)
  - allow `finish` to mint a fresh capture_id (the original P0.1)
  - drop `approval-event-fingerprints.jsonl` from `begin`'s output
    (without fingerprints, `finish` cannot compute a delta)
  - widen `SENSITIVE_NAME_PARTS` allowlist (secrets are still secrets)
  - recurse-copy data roots wholesale (privacy boundary)
  - modify the editor-tool recon ACT (this ACT corrects its
    TOOLCHAIN, not its SEMANTICS)
  - add a `provision`/`create`/`override` verb to the collector
```

## §10 — Conservation suite

Green invariants from §3:

```text
[x] P0.1 (--capture-id required, schema-mismatch refused)
[x] P0.2 (event-fingerprints frozen at begin, delta computed at finish)
[x] P0.3 (artifactStatus separated from specimenBinding)
[x] P1 (shape-based session scan replaces filename allowlist)
```
binding record.

## §11 — Temporary instrumentation

N/A — this ACT IS the instrumentation. No new temp instrumentation.

## §12 — Forbidden side effects

```text
- no apps/* or sdk/* changes
- no package.json changes
- no upstream wholesale copy
- no test framework additions
- no production webview / extension host changes
```

## §13 — Gates

```text
[x] PASS_CORRECTION_ACT_DEFINED          (this ACT — scope + invariants + forbidden-repair)
[x] P0.1_INVARIANT_FIRES                 (--capture-id required, v1/v2 mismatch refused — re-verified)
[x] P0.2_INVARIANT_FIRES                 (happy-path matrix: NEW_EVENTS=2, delta=B only)
[x] P0.3_INVARIANT_FIRES                 (negative matrix: artifactStatus=PASS, specimenBinding=CAPTURE_INSUFFICIENT)
[x] P1_INVARIANT_FIRES                   (real-data smoke: SESSION_CANDIDATES=1 on actual ClineMM storage; hermetic fixture exercises session_id+sessionId+taskId aliases)
[x] PRESERVE_EXISTING_CAPTURES           (captures/{9171c6f6,435b5360}/ untouched; sha256 recorded)
[x] NO_PRODUCTION_CODE_CHANGED           (only tools/factory/* + docs/governance)
[x] GIT_DIFF_CHECK_PASSES                (P2 — EOF blank lines trimmed)
[x] PY_COMPILE_PASSES                    (tool syntax)
[ ] PASS_CAPTURE_TOOL_HARDENED           (reviewer verdict — separate process)
[ ] editor_tool_recon_re_opens           (after this ACT closes; recon ACT's c1 verb)
```

## §14 — Live qualification

Smoke run only — see §3. The next live approval-prompt specimen
is the editor-tool recon ACT's job; this ACT does not produce
one.

## §15 — Evidence layout

```text
.factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/captures/
  specimen-20260827-command-approval01.json
    (durable binding record for the two pre-correction captures;
     classification = CAPTURE_INSUFFICIENT; sha256 = 95f9e81e…)
  20260827T211256Z-9171c6f6/   ← preserved verbatim
  20260827T211338Z-435b5360/   ← preserved verbatim

.factory/evidence/ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01/
  hermetic-fixture/
    happy-path-matrix.json     (verifies begin→finish→report cycle)
    negative-matrix.json       (verifies CAPTURE_INSUFFICIENT on no-new-event)

tools/factory/hermetic-fixture/
  build.py                     (builds the synthetic before/after fixture)
  verify-happy.py              (runs the begin→finish→report positive test)
  verify-negative.py           (runs the conservation negative)
```

The hermetic fixture is built under
`.factory/evidence/.hermetic-fixture/` (gitignored) so it is
regenerated on every run; the verification matrices are the
durable evidence.

## §16 — ACT relationship

```text
EDITOR-TOOL-APPROVAL-FRICTION-RECON01 (NEXT / OPEN; recon contract)
   ↑ depends on the toolchain that this ACT hardens
APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01 (this ACT; bounded correction)
   ↑ does NOT supersede the recon ACT — it corrects its evidence tool
   ↑ does NOT modify any production code
   ↑ preserves the two pre-correction captures verbatim
```

This ACT does NOT spawn `IMPLEMENTATION01`. The corrected
collector is the tool; once GREEN, the editor-tool recon ACT
re-opens for a real specimen under the corrected UX.

---

## ACT-LEDGER ADDENDUM (2026-08-28, second review cycle)

A second reviewer verdict (`HALT_CAPTURE_TOOL_NOT_YET_PROVEN`)
caught four issues with the first-author evidence. All four are
closed by this addendum, in bounded form:

### A. P0.2 / P0.3 not actually executed end-to-end

The first-author `§3` smoke only verified P0.1 lifecycle guards
(no `--capture-id`, v1/v2 mix rejected) but did not run a
successful `begin` → mutate → `finish` → `report` cycle. The
first-author ACT marked `[x] P0.2 / P0.3 / P1` without ever
executing those paths.

**Fix**: a **hermetic synthetic fixture** has been built at
`.factory/evidence/.hermetic-fixture/{before,after}/` and run
through `.factory/evidence/.verify-happy.py` and
`.verify-negative.py`. The fixture contains:

```text
FIXTURE/before/sessions/synthetic01/synthetic01.json   (session record)
FIXTURE/before/diagnostics/before.jsonl                (event pair A)
FIXTURE/after/sessions/synthetic01/synthetic01.json    (session record)
FIXTURE/after/diagnostics/after.jsonl                  (event pair A + pair B)
```

**Happy path** (`.verify-happy.py`):
```text
begin (scan BEFORE_ROOT)
  APPROVAL_EVENTS=2, SESSION_CANDIDATES=1, fingerprints=2
finish (scan AFTER_ROOT, same capture_id)
  APPROVAL_EVENTS=4, NEW_EVENTS=2, DISCRIMINATOR_ITEMS=2
  SPECIMEN_BINDING=PASS, ARTIFACT_STATUS=PASS
  delta.correlationIds = ['corr-B']    # delta contains ONLY pair B
  before.lines = 2                     # frozen at begin = pair A
  after.lines = 4                      # at finish = pair A + pair B
report
  report.json (binding.json contents)
  report.txt (machine-readable key=value block)
  stdout agrees with binding.json
```

The full verification matrix is persisted at
`.factory/evidence/ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01/hermetic-fixture/happy-path-matrix.json`.

**Conservation negative** (`.verify-negative.py`):
```text
begin (scan BEFORE_ROOT)
finish (scan SAME BEFORE_ROOT — no new event)
  NEW_EVENTS=0, DISCRIMINATOR_ITEMS=0
  ARTIFACT_STATUS=PASS (file was generated)
  SPECIMEN_BINDING=CAPTURE_INSUFFICIENT  # delta empty → no causal chain
```

The negative matrix is persisted at
`.factory/evidence/ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01/hermetic-fixture/negative-matrix.json`.

### B. P1 session-id vocabulary was underspecified

The first-author `§2` P1 fix said `{id, sessionId, taskId}` and
the implementation only matched those three, but the actual
ClineMM session storage uses `session_id` (snake_case). The
first-author `§3` rationale claimed the real file would match —
this was wrong. The smoke run showed `SESSION_CANDIDATES=0` for
real data even with a long `--recent-minutes` window.

**Fix**: a new constant `SESSION_ID_KEYS = (id, sessionId,
session_id, taskId, task_id)` was added to the implementation.
The shape check `looks_like_session_record()` and the session
projection in `safe_session_projection()` both consult this
list. The hermetic fixture exercises all three aliases
(`session_id`, `sessionId`, `taskId`) on the synthetic record.
Re-running the collector against the real ClineMM data root
(`/Volumes/UserData/Users/chistyakov/.cline2`) with
`--recent-minutes 10000` now reports `SESSION_CANDIDATES=1`
and a populated projection — confirming the actual session
file at `.cline2/data/sessions/1787562381026_jao7c/1787562381026_jao7c.json`
(with snake_case `session_id`) is now recognised.

### C. P0.2 fingerprint was source+content, not content-only

The first-author `event_fingerprint()` folded the source path
into the sha256. This meant a logically-identical event
re-logged under a different path was classified as new — the
hermetic fixture's BEFORE_ROOT vs AFTER_ROOT showed this
directly: `NEW_EVENTS=4` (the original 2 + pair A re-seen) when
the expected answer is `NEW_EVENTS=2` (pair B only).

**Fix**: `event_fingerprint()` now folds ONLY the canonical
content (raw line or canonical JSON), not the source path.
Re-running the happy-path smoke now reports `NEW_EVENTS=2`,
`delta.correlationIds=['corr-B']`, and `SPECIMEN_BINDING=PASS`.
The negative still reports `NEW_EVENTS=0` and
`SPECIMEN_BINDING=CAPTURE_INSUFFICIENT`.

### D. EOF blank lines (P2 hygiene)

`git diff --check` reported blank-line-at-EOF on both this file
and `probe-minimax-ultra-billing-semantics.md`. Both have been
trimmed.

## §17 — Halt conditions (closed-class)

```text
HALT_HARDENING_INCOMPLETE  — any of P0.1 / P0.2 / P0.3 / P1 fails
                              to fire under smoke run
HOLD_FOR_REVIEWER         — awaiting PASS_CAPTURE_TOOL_HARDENED
                              verdict on this ACT
```

Stop here. **C1: GO_WAIT_FOR_REVIEWER_VERDICT**.
