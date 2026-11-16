# ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01

> **SUPERSEDED IN PART BY
> `ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02`** (2026-11-16).
>
> The second expert review of this ACT returned
> **`HALT_VERIFIED_EVIDENCE_SAFETY_INCOMPLETE`**. The three original P0
> repairs and the raw-output removal were **ACCEPTED and KEPT**. Two NEW
> correctness problems in this ACT's implementation were corrected by the
> successor:
>
> 1. **Command arguments could still expose credentials.** This ACT removed
>    raw tool OUTPUT, but still carried the first three words of the tool
>    INPUT. Command arguments are arbitrary user-controlled strings, so no
>    regex can establish that an arbitrary argument is safe —
>    `echo <secret>`, `curl https://user:pass@host/...` and
>    `psql postgresql://user:pass@host` all leaked a credential into the
>    provider-visible summary. The successor replaced this with a FINITE
>    allowlist of command CLASSIFICATIONS.
> 2. **Contradictory or incomplete statuses could certify success.** This
>    ACT's classifier used `continue` after `success === true`, which
>    BYPASSED the `isError` check on that same payload, so it accepted
>    `{success: true, isError: true}` and `[{success: true},
>    {isError: false}]` as `succeeded`. The successor checks all failure
>    indicators independently per payload and requires EVERY payload to
>    affirm success.
> 3. **Duplicate RESULTS sharing one call id** were not rejected. The
>    successor fails closed with the new `ambiguous_result_id` reason.
>
> The successor also relabelled the long-session test `SYNTHETIC_REAL`, to
> state plainly that it models the real transcript's SHAPE rather than
> replaying the transcript itself.
>
> See `.factory/acts/ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02.md`.
>
> Status: **CLOSED / VERIFIED_EVIDENCE_ATTRIBUTION_AND_PRIVACY_CORRECTED**.
>
> Epistemic purpose: **BOUNDED_PRODUCTION_ENGINEERING** — a single bounded
> correction to `fbee2279e` (`ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-
> RECON01`) addressing the three P0 findings and the one contract
> limitation raised by the expert review.
>
> ```text
> ENTRY_HEAD           = fbee2279e (ACT-CLINEMM-COMPACTION-EVIDENCE-
>                        CONTINUITY-RECON01)
> DEFECT              = (a) MISATTRIBUTED_CAUSAL_DISCRIMINATOR
>                        (b) FAILED_OPERATION_PROMOTED_TO_SUCCESS
>                        (c) UNSAFE_RAW_OUTPUT_CARRY_FORWARD
>                        (d) LONG_SESSION_SURVIVAL_NOT_ESTABLISHED
> CLASSIFICATION      = CAPTURE_INSUFFICIENT (historical boundary;
>                        the canonical/final-report contradiction is real)
> RED                 = 13 failed / 16 passed (29) at the pre-fix seam
> GREEN               = 29 passed / 29
> NO_REGRESSION       = 241/241 in src/extensions/context (1 skipped);
>                        the full core suite's failing-file set is
>                        BYTE-IDENTICAL before and after (diff = 0 bytes);
>                        50/50 in the apps/vscode compaction suites
> TYPECHECK           = 43 errors before AND after (ZERO regression;
>                        ZERO errors in the changed files)
> LINT                = biome 0 errors / 0 warnings on the 3 touched files
> SDK_BUILD           = EXIT 0
> EVIDENCE            = .factory/evidence/ACT-CLINEMM-COMPACTION-EVIDENCE-
>                        CONTINUITY-CORRECTION01/
> ```

## 0. What this correction does

`fbee2279e` was **directionally right**: deriving the carried evidence from
the canonical history rather than from generated prose is the correct
architecture, and that architecture is KEPT. What it got wrong were three
correctness properties and one unestablished contract. This ACT corrects
exactly those four things and nothing else. It does NOT reopen telemetry,
compaction eligibility, latency tracing, the task-contract conservation
machinery, or the rest of the runtime.

## 1. P0 (a) — The causal discriminator selected the WRONG tool result

### What was wrong

The first cut's `discriminate.py` selected the FIRST tool result mentioning
`helm template` or `rc=0`:

| | Result |
|---|---|
| Discriminator-selected result | `call_7735403ff4f640c3b9de90d0` |
| Selected result length | 8,181 chars |
| Decisive markers in it | **0 of 3** |
| Actual decisive Helm result | `call_f476e4ce0f204de8baabc31d` |
| Decisive result length | 3,536 chars (582 decisive payload) |
| Decisive markers in it | **3 of 3** |

The selected result did not contain the resolved image or the
security-context markers at all. The discriminator was reasoning about the
wrong tool call.

It then reconstructed the summarizer's input as `canonical[0..75)`. That is
**not** what production does: `runAgenticCompaction()` builds the summarizer
input from `previousSummary + newly folded messages` AFTER the input-budget
projection (`agentic-compaction.ts:74-84`, `:140-167`), so the original
canonical prefix is not necessarily submitted again.

### What is now established

- Selection is by **MARKER COMPLETENESS**, and the full ranked candidate
  list is printed so the selection can be checked against the transcript.
  The decisive call is now correctly identified as
  `call_f476e4ce0f204de8baabc31d` (3/3 decisive markers).
- The canonical-prefix serialization is reported as a
  **RECONSTRUCTION**, never as the actual request.
- The actual summarizer request capture is reported honestly: the canonical
  history contains **0** `compaction_summary` messages and **no**
  summarizer-request artifact exists on disk. The summarizer's actual input
  was never persisted.

### The verdict is corrected

```text
R1_EXECUTION_IN_CANONICAL_HISTORY     : True
R1_EXECUTION_IN_RECONSTRUCTION         : True
R1_EXECUTION_IN_SUMMARIZER_INPUT      : UNKNOWN (request not captured)
R1_EXECUTION_IN_INSTALLED_SUMMARY     : False
CANONICAL_FINAL_REPORT_CONTRADICTION  : True
CLASSIFICATION                        : CAPTURE_INSUFFICIENT
```

The **canonical/final-report contradiction remains real** — that is the
defect this repair exists for. What is **not** proven is the exact stage at
which the first loss occurred. The historical boundary is therefore
`CAPTURE_INSUFFICIENT`, not `SUMMARIZER_OMISSION`.

This correction does **not** weaken the repair's justification. The repair
does not depend on knowing the stage: it makes the canonical record
authoritative at the compaction seam regardless of where the loss occurred.

## 2. P0 (b) — A failed operation could be promoted to a success

### What was wrong

`classifyToolResultStatus()` returned as soon as it saw a positive flag:

```ts
for (const payload of payloads) {
    if (payload.success === true) return "succeeded";   // <-- promotes a mixed batch
    if (payload.success === false) return "failed";
    if (payload.isError === false) return "succeeded";   // <-- not affirmative
}
```

A `run_commands` result carries **one payload per command**. The real Round C
transcript contains two such mixed batches:

| tool_use_id | payload flags |
|---|---|
| `call_1741e2129191405986d10517` | `success=true`, `success=false` |
| `call_11bcc4342baf4d6d94e8ed6c` | `success=true` ×4, `success=false` |

Both were classified `succeeded` by the first cut: **one successful command
certified an entire mixed-result batch.**

Separately, `isError: false` establishes only that no error was REPORTED. It
is not evidence of success.

### The attribution defect

Duplicate tool-call ids were owned by the first call, but a later result was
still attributed to that first call with no check of the tool name or the
call/result chronology — attaching one tool's output to a different tool's
call. The existing test actually EXPECTED that behaviour.

### What is now correct

- Classification is the **aggregate over all payloads**, and a single
  failure poisons the aggregate: the batch did not wholly succeed, so it is
  not carried as a success. The order of payloads does not matter.
- `isError: false` is **not** an affirmative success signal. It is treated
  as "no signal", which fails closed.
- Attribution **fails closed**:
  - an id claimed by **more than one** canonical call is `ambiguous_call_id`
    and carries nothing;
  - a result whose declared tool name disagrees with the call is
    `tool_name_mismatch`;
  - a result that appears **before** the call it claims to answer is
    `result_precedes_call`;
  - a result with no matching call is `unmatched_result`.
- Every non-carried result is recorded in `ledger.rejected` with its
  reason, so the absence of a carried entry is **auditable** rather than
  silent.

## 3. P0 (c) — Credential safety: structured evidence, not raw output

### What was wrong

The first cut carried up to 240 characters of the **raw tool output** and
relied on a regex sanitizer to strip credentials. That sanitizer was not safe
for arbitrary output:

| Input | Redacted by the first cut? |
|---|---|
| `DB_PASSWORD=hunter2` | yes |
| `{"password":"sensitiveExample123"}` | **NO** |
| `password="two word secret"` | **NO** |
| `apiKey: "a b c"` | **NO** |

So the carry-forward could have **preserved** credential-bearing output that
the pre-repair pipeline would simply have discarded — a new exposure
surface, not a neutral one. This matters concretely for Keycloak, whose
canonical command output already contains credential-bearing configuration.

### What is now correct

The module **never carries raw tool output**. It carries a **structured,
allowlisted** evidence record derived from the tool CALL's own declared
input plus the result's own status:

```text
- run_commands (call_f476e4ce0f204de8baabc31d): succeeded — helm template kc-test
```

Every carried field is a tool name, a bounded count, or a redacted command
**subject** (the command name and its targets — deliberately NOT the whole
command line, which can carry a secret in an argument position). The
redaction is applied at the **VALUE POSITION** and consumes the entire
quoted value, so it covers JSON, YAML and multi-word quoted forms. A value
that cannot be shown to be safe is redacted rather than carried.

The RED test proves the property directly: a result whose output contains
all four of the review's counterexamples is carried as a verified success,
and **none** of the credential-bearing text reaches the provider request.

The sanitizer itself was also repaired (the value-position form), so it is
safe when applied to the subject it is now responsible for.

## 4. The long-session contract limitation is now ESTABLISHED

The review noted that the 12-outcome policy means "an early Helm
verification followed by 13 later successes will disappear from the carried
section", and that this "should be tested against the real transcript, not
promoted to another architecture project."

Two tests now pin this down against the real Round C shape:

1. an early Helm outcome followed by 13 later successes — the early outcome
   is dropped, and the 13 most recent are kept;
2. the real `1794780088950_tc1vx` shape — the decisive Helm render
   `call_f476e4ce0f204de8baabc31d` at canonical index 22/23 followed by 45
   later successful outcomes. **The decisive fact does NOT survive the
   bound.**

The bound is deliberate and the limitation is now **measured and asserted**
rather than implied. It is recorded here as a known, bounded limitation of
the 12-outcome policy; it is **not** reopened as an architecture project,
per the review's disposition.

## 5. What this ACT does NOT change

- **The architecture.** Deriving evidence from canonical history rather
  than generated summaries is kept as-is.
- **The compaction seam.** The carry-forward is applied at the same three
  production call sites as the task contract, after it, attached to the
  existing `compaction_summary` message, updating the provider-visible text
  and `metadata.summary` together.
- **Telemetry, compaction eligibility, latency tracing** — already repaired
  and closed; NOT reopened.
- **The task-contract conservation machinery** — untouched.
- **General memory architecture** — no evidence database, no retrieval
  service, no persistent ledger.

## 6. Verification

| Gate | Result |
|---|---|
| Focused suite (29 tests) | RED 13 failed / 16 passed -> GREEN 29/29 |
| `src/extensions/context` | 241 passed, 1 skipped |
| Full core suite failing-file set | BYTE-IDENTICAL before/after (diff = 0 bytes) |
| `apps/vscode` compaction suites | 50/50 |
| Typecheck (`tsconfig.dev.json`) | 43 errors before AND after; ZERO in changed files |
| Biome | 0 errors / 0 warnings on the 3 touched files |
| SDK build | EXIT 0 |
| Discriminator | `CLASSIFICATION = CAPTURE_INSUFFICIENT` |

NOTE on the failing-file-set baseline: the `fbee2279e` receipt recorded 19
failing files. In THIS environment the pristine `fbee2279e` tree measures 33,
because 14 macOS sandbox / seatbelt / subprocess-sandbox suites fail on this
host independently of the change. The BEFORE and AFTER sets were both
measured in this environment on the same tree, and they are byte-identical
(diff = 0 bytes), which is the property the gate actually asserts.

EVIDENCE: `.factory/evidence/ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-
CORRECTION01/` — `01-discriminator-output.txt`, `02-red-tests.txt`,
`03-green-tests.txt`, `05-baseline-failing-files.txt`,
`06-after-failing-files.txt`, `07-failing-file-set-diff.txt`,
`discriminate.py`


