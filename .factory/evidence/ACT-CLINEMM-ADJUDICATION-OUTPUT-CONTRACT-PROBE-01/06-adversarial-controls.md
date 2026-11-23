# 06 — Adversarial controls and the live model probe (G5, G6)

## G5 — Security negative controls

Executable source: `describe("G5 — security negative controls")` in
`compaction.adjudication-output-contract.probe01.test.ts`.

```text
EXECUTION CLASS: SYNTHETIC_REAL
```

Model output is untrusted even when formatted as JSON. Every control below
is an executable assertion.

| Control | Expected disposition | Observed |
|---|---|---|
| Forged tool-call ID | REJECT | `unresolvable_tool_reference:call_s1_source_read_9999` |
| Valid tool-call ID with irrelevant evidence | No independently verified support | `semantically_verified: false`, `authority: PROVISIONAL`, `source_support: NOT_INDEPENDENTLY_ADJUDICATED` |
| Failed or incomplete tool result | Not sufficient grounding | `failed_tool_result:<id>` / `unpaired_tool_reference:<id>` |
| Synthetic secret embedded in envelope | REJECT | `unknown_field:note` (the secret is smuggled through an unknown field; there is no field through which arbitrary content can travel) |
| Unknown free-form field | REJECT | `unknown_field:rationale` |
| Instruction masquerading as a qualification | REJECT | `unknown_qualification_code:ignore_all_previous_instructions_...` |
| Forged source revision | REJECT or `REVISION_UNVERIFIED` | `unbound_source_revision`, `revision: UNVERIFIED` |
| Changed source revision | STALE | `revision: STALE`, `authority: PROVISIONAL` |
| Contradictory later evidence | Revalidate; no stale authority | the same candidate moves VERIFIED -> STALE and cannot keep its authority |
| Duplicate conflicting decisions | Do not silently choose one | the conflict is OBSERVABLE (two distinct decisions are parsed and compared); the conflicting envelope is never semantically verified |
| Cross-session evidence ID | REJECT | `unresolvable_tool_reference:call_from_another_session_0001` |
| Oversized or deeply nested JSON | REJECT | `carrier_too_large`; a 40-deep nested payload is rejected as `unknown_field:extra` |
| Model thinking containing a valid-looking envelope | IGNORE | PROBE-8: 0 candidates collected |
| Tool output containing a valid-looking envelope | IGNORE | PROBE-8: 0 candidates collected |
| User's original allegation formatted as an envelope | Do not misclassify as model adjudication | the collector reads ASSISTANT text only; the published candidate stays `author: MODEL`, `authority: PROVISIONAL` |

### The special rule: semantic grounding

**Structural provenance is NOT semantic verification.**

The probe includes a candidate with a VALID, PAIRED, SUCCESSFUL tool-call
reference whose result does **not** support the decision (S2's decision
cited against an unrelated configuration read). The validator must not
label it `VERIFIED`. Observed:

```text
structural validation       -> passes (rejection === undefined)
semantically_verified       -> false
authority                   -> PROVISIONAL
source_support              -> NOT_INDEPENDENTLY_ADJUDICATED
SEMANTIC_SUPPORT_UNVERIFIED
```

This is not a blocker to publishing a provisional continuation aid. It IS a
blocker to claiming that the verdict itself is established.

### The confidentiality design consequence

The contract's transport surface is a CLOSED vocabulary of identifiers and
enums. There is no field through which arbitrary model prose, file content,
stdout or reasoning can travel. The ACT's warning — that an unrecognized
secret format in arbitrary model-authored prose cannot be made universally
safe by a finite sanitizer — is answered by **not creating that transport
surface at all**, rather than by writing a sanitizer for it.

## G6 — Actual model publication (LIVE)

```text
EXECUTED:                YES
MODEL / PROVIDER:        minimax / MiniMax-M3  (local settings provider)
CAPTURE IDENTITY:        sanitized observation report; raw provider payloads
                          were written to a PRIVATE temp path and are NOT
                          committed
EXECUTION CLASS:         REAL_MODEL_RESPONSE
NOT CLAIMED:             LIVE_INSTALLED_RUN  (the installed runtime was not
                          exercised end-to-end)
```

### The harness

`sdk/packages/core/scripts/adjudication-output-contract.live-probe.ts`

```bash
cd sdk/packages/core
CORE_LIVE_ADJUDICATION_PROBE=1 \
CORE_LIVE_ADJUDICATION_PROVIDER_KEY=minimax \
bun scripts/adjudication-output-contract.live-probe.ts
```

It is a standalone script, NOT a `*.test.ts` file, so it is excluded from
the default suite by construction. It:

- reads the LOCAL provider settings file and never prints a credential;
- runs a bounded synthetic task with ONE synthetic `read_files` tool;
- completes the tool-use loop by feeding the synthetic tool RESULT back as
  a user turn, exactly as the canonical record does;
- parses EACH assistant `text` carrier with the STRICT contract — one
  carrier at a time, never a concatenation of turns;
- prints a sanitized observation report (shapes, booleans, the parsed
  decision and qualifications) and NO raw model prose.

It does NOT alter the default Round C task prompt, the checkpoint cadence,
or any production state.

### Observations

> **CORRECTION — `ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01-CORRECTION01`**
>
> The observation block below was **WITHDRAWN**. The Factory runtime
> reviewer found that the committed live transcript
> (`verification/gate8-live-model-probe.txt`) contained **ONE** run, not
> nine, and that two of the harness's correlation metrics were
> implemented incorrectly. The block is preserved verbatim for the record
> and is superseded by:
>
> `.factory/evidence/ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01-CORRECTION01/02-live-receipts.md`
>
> The corrected measurement (10 runs, 10 committed receipts) is:
>
> ```text
> schema_valid                  = true in 9 of 10 runs
> canonical_refs_resolved       = true in 1 of 10 runs
> source_revision_bound         = false in 10 of 10 runs
> candidate_accepted            = false in 10 of 10 runs
> publishedTurnAlsoCarriedToolUse = true in 0 of 9 schema-valid runs
> publishedAfterToolResult      = true in 9 of 9 schema-valid runs
> ```
>
> The **same-turn tool-use claim is REFUTED**, not merely unverified.

The withdrawn observation block (PRESERVED VERBATIM, DO NOT RELY ON):

```text
publishedValidCandidate      = true in 8 of 9 runs
decision                     = "narrowed"            (8/8 published)
qualificationCodes           = ["manual_enforcement_only"] (8/8 published)
remainingQuestionIds         = ["S1.automated_enforcement"] (8/8 published)
publishedTurnAlsoCarriedToolUse = true               (8/8 published)
publishedAfterToolResult     = true                  (8/8 published)
```

The single non-publishing run ended after its tool turn without emitting a
carrier. **Publication is therefore reliable but NOT guaranteed** — this is
reported as measured, not smoothed over.

### What this live run establishes

1. **A real model DOES publish the envelope.** The `kind`,
   `schema_version`, `finding_id`, `decision` and `remaining_question_ids`
   fields were emitted exactly as specified.
2. **The qualification SURVIVES in the live output.** Every successful run
   carried `manual_enforcement_only` alongside `narrowed`. The live model
   did not launder the qualification into an unqualified `supported`.
3. ~~**The publishing turn ALSO carried a tool call** in every successful
   run.~~ **WITHDRAWN BY CORRECTION01 — REFUTED.** The corrected
   measurement records `publishedTurnAlsoCarriedToolUse = true` in **0 of
   9** schema-valid runs. The text+tool_use coexistence (PROBE-2) remains
   established **structurally** by the probe test file; it is NOT
   established by the live stream. The corrected harness reports the
   tool-call ids emitted in the publishing turn itself, so the property
   is now directly auditable rather than inferred.
4. **Publication happens AFTER the tool result**, in a separate assistant
   turn whose `text` carrier holds the envelope — the realistic ClineMM
   shape. (CONFIRMED by CORRECTION01: 9 of 9 schema-valid runs, derived
   from the conversation chronology rather than from the presence of text
   in a tool-calling turn.)

### What this live run also exposes (an important negative finding)

The model's `evidence_tool_use_ids` were **NOT reliable**:

```text
observed values across runs:  ["read_files"]
                               ["read_files_synthetic-pool-config.yaml"]
                               ["read_files_synthetic-pool-config.yaml_1", ...]
                               ["toolu_01CPzY7hHXBaRLF3vPMkVJd"]
                               ["call_1", "call_2"]
```

None of these are the canonical tool-call ids of the session. A real model
frequently cites the tool NAME, a synthetic label, or a made-up id. Under
this contract, **every one of those would be REJECTED** as
`unresolvable_tool_reference:<id>`.

That is the correct behaviour, and it is the reason the contract binds
evidence to the CANONICAL tool-call/result relation rather than to the
model's own account of it. It also means:

```text
A future implementation must make the canonical tool-call id AVAILABLE to
the model (e.g. in the tool result or the tool schema), otherwise the
evidence binding cannot be satisfied in practice.
```

This is recorded as a design constraint for the successor ACT, NOT
implemented here.

### The evidence categories are kept distinct

```text
SYNTHETIC CANONICAL FIXTURE   -> the serializer can handle the shape
                                 (03-producer-probe.md)
MOCKED PROVIDER RESPONSE       -> the adapter/compaction path handles it
                                 (05-compaction-consumer-probe.md)
REAL MODEL RESPONSE           -> this model/provider CAN emit it
                                 (THIS SECTION)
LIVE INSTALLED RUN             -> NOT CLAIMED
```

No category was promoted to another.

