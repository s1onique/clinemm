# ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-RECON01

> Status: **CLOSED / VERIFIED_OUTCOME_CONTINUITY_REPAIRED**.
>
> Epistemic purpose: **BOUNDED_PRODUCTION_ENGINEERING** — reproduce the
> R1 evidence loss at the production compaction seam, discriminate the
> causal boundary mechanically, and apply the smallest repair that makes a
> canonical successful execution survive compaction.
>
> ```text
> ENTRY_HEAD           = 0871dd9f1 (ACT-CLINEMM-ROUND-C-TRACE-QUAL01
>                        CORRECTION01)
> DEFECT              = VERIFIED_TOOL_OUTCOME_LOSS_ACROSS_COMPACTION
> CLASSIFICATION      = SUMMARIZER_OMISSION (mechanically discriminated)
> RED                 = 5 failed / 13 passed at the pre-fix production seam
> GREEN               = 18 passed / 18
> NO_REGRESSION       = 230/230 in src/extensions/context (1 skipped);
>                        the full core suite's failing-file set is
>                        BYTE-IDENTICAL before and after (diff = 0 bytes);
>                        50/50 in the apps/vscode compaction suites
> TYPECHECK           = 43 errors before AND after (ZERO regression;
>                        ZERO errors in the new files)
> LINT               = biome 0 errors / 0 warnings on the 3 touched files
> EVIDENCE            = .factory/evidence/ACT-CLINEMM-COMPACTION-
>                        EVIDENCE-CONTINUITY-RECON01/
> ```

## 0. The defect, as observed

The Round C successor run (`1794780088950_tc1vx`) produced a final report
whose **Explicit NOT_EXECUTED** section says:

> `- helm dep up + helm template offline render (would populate charts/ —
>   side effect on workspace); substituted with authoritative upstream
>   values.yaml fetch.`

The canonical history of that SAME session contradicts it. Canonical index
22/23 (`msg_HHzUjSeh` / `msg_sYj09Sd3`, tool_use id
`call_f476e4ce0f204de8baabc31d`) records a **successful** render:

```text
rc=0
13
213:          image: "quay.io/keycloak/keycloak:26.0.7"
210:          securityContext:
211:            runAsNonRoot: true
212-            runAsUser: 1000
290:      securityContext:
291-        fsGroup: 1000
294-      nodeSelector:
295-        dedicated: keycloak
```

The operation **executed and succeeded**. The report's claim that it was
NOT_EXECUTED is false.

## 1. Where the evidence was lost — the mechanical discrimination

`discriminate.py` reads the REAL on-disk transcript and the REAL compaction
artifact and answers four questions. It never invents an observation.

| Stage | Evidence present? |
|---|---|
| Canonical history | **YES** — `rc=0`, `quay.io/keycloak/keycloak:26.0.7`, `runAsNonRoot: true`, `fsGroup: 1000` |
| Compaction INPUT (the summarizer's window) | **YES** — all five markers, in the production serialization of the folded prefix `canonical[0..75)` (94,335 chars) |
| Installed compaction summary | **NO** — none of the five markers (17,152 chars) |
| Final report | **NO** — and it asserts `NOT_EXECUTED` |

```text
R1_EXECUTION_IN_CANONICAL_HISTORY : True
R1_EXECUTION_IN_SUMMARIZER_INPUT  : True
R1_EXECUTION_IN_INSTALLED_SUMMARY : False
CLASSIFICATION                    : SUMMARIZER_OMISSION
```

### What this rules OUT

The 2,000-character compaction truncation (`TOOL_RESULT_CHAR_LIMIT`) is
**NOT** the cause: the decisive tool result is **582 characters**, well
under the limit, and the production serialization of the folded prefix
carries every marker. The budget projection is **NOT** the cause either.
The evidence reached the summarizer's window and was dropped in the
**generated prose**.

This matters: a summarizer-prompt change ("preserve completed verification
results") is not a correctness guarantee, and it would not have been
diagnosable as a *different* defect from truncation. The discrimination
establishes that the boundary is the generated summary itself.


## 2. The violated invariant

> A generated summary may omit historical detail, but it must **not** become
> more authoritative than the canonical record of what actually executed.

The compaction summary is a **lossy projection** of the canonical history.
Nothing in the pipeline made the canonical record of executed operations
survive that projection, so the continuing model could — and did — assert
the opposite of what the canonical history said.

## 3. The repair

`sdk/packages/core/src/extensions/context/evidence-continuity.ts` — a
**deterministic** carry-forward of verified tool outcomes, integrated with
the EXISTING conservation machinery (`task-contract.ts`), not a new ledger,
not a retrieval service, not a persistent evidence database.

### Authority

The canonical session history is the ONLY authority — exactly as for the
active task contract. A previous summary is never an authority source. The
carried section is a pure function of the canonical tool-call/tool-result
pairs, so it never depends on the summary prose that lost the evidence.

### What counts as "verified"

An outcome is carried only when ALL of:

1. the canonical history contains the tool CALL;
2. the canonical history contains the matching tool RESULT (by
   `tool_use_id`);
3. the result is NOT an error;
4. the result carries an explicit, POSITIVE success signal.

Rule 4 is deliberately strict: **"no evidence of failure" is not "evidence
of success"**. A result with no success signal is NOT carried. A failed or
not-run operation is therefore never promoted to a success — the absence of
a carried entry is the truthful representation of "not established".

The success signal is matched on the **data shape** (`is_error`,
`success: boolean`, `isError: boolean`), never on a provider id and never
on a tool name.

### Boundedness

At most `MAX_CARRIED_OUTCOMES = 12` outcomes, each at most
`MAX_CARRIED_OUTCOME_CHARS = 240` characters of sanitized output. The
overhead is a fixed constant, not a function of transcript size.

### Credential safety

Carried output is **sanitized**: credential-shaped values are redacted
before they can reach the carried section. The sanitizer is shape-based and
never inspects whether a value IS a credential, so the carried section can
never become a new credential-exposure surface.

### Composition with the existing machinery

The carry-forward is applied at the SAME three production call sites as the
active task contract, AFTER it, so the two compose without either
overwriting the other's section. It attaches to the EXISTING
`compaction_summary` message — no second summary message, no provider tool
call — and updates the provider-visible text AND `metadata.summary`
together.

Idempotency follows the established pattern: the carried section is
stripped (heading included) and replaced on every compaction, so repeated
compactions converge on the canonical record instead of accumulating copies.


## 4. Conservation tests

`sdk/packages/core/src/extensions/context/evidence-continuity.test.ts` —
18 tests, all driving the REAL production boundary
(`createCompactionStateAwarePrepareTurn` → `projectSessionCompactionState`
→ `input.compact` → `createSessionCompactionState` →
`MessageBuilder.buildForApi`).

| Conservation | Test |
|---|---|
| The reproduced defect | a successful execution survives a summary that omitted it |
| The false claim | the summary's `NOT_EXECUTED` prose cannot stand alone against the canonical record |
| Failed operation | never carried as a success |
| Explicit error flag | never carried |
| Not run (call, no result) | never carried |
| No success signal at all | never carried |
| Mismatched tool id | a result is not attributed to a different call |
| Reused tool id | the FIRST canonical call owns the id |
| Repeated compaction | exactly ONE section across three compactions |
| Stale section | replaced by the current canonical one |
| Bounded overhead | ≤ 12 outcomes regardless of transcript length |
| Bounded excerpt | each excerpt ≤ 240 chars |
| Credential safety | `KEY=value`, bearer tokens and PEM keys redacted |
| Purity | a pure function of the canonical history |
| Idempotency | strip + re-apply is a fixed point |
| No invented section | a summary with nothing verified is not rewritten |

## 5. RED → GREEN

At the pre-fix production seam (`compaction.ts` reverted, module and test
present):

```text
× carries a SUCCESSFUL execution into the provider request even when the
  generated summary omitted it
× does not let the generated summary's NOT_EXECUTED claim stand against
  the canonical record
× keeps exactly ONE evidence section across repeated compactions
× replaces a STALE carried section with the current canonical one
× redacts credential-shaped values in the carried excerpt
Tests  5 failed | 13 passed (18)
```

With the repair:

```text
✓ src/extensions/context/evidence-continuity.test.ts (18 tests)
Tests  18 passed (18)
```

The RED is a **behavioural** RED at the production seam: the compaction
result handed to the pipeline deliberately OMITS the outcome, so a repair
that merely asked the summarizer to preserve outcomes would not turn these
tests GREEN.

## 6. What this ACT does NOT change

- **R5 reporting fidelity** — the successor's report stated four exact
  index names versus one in the original. That is a benchmark-level
  finding and deserves benchmark-level verification; it is not a runtime
  defect and is not addressed here.
- **`run_commands` execution/delivery measurements** — they do not explain
  the false Helm execution claim and are untouched.
- **Compaction eligibility and latency tracing** — already repaired and
  closed; not reopened.
- **General memory architecture** — no evidence database, no retrieval
  service, no persistent ledger. The repair is a bounded, deterministic
  projection of the canonical history that already exists.

## 7. Evidence

```text
.factory/evidence/ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-RECON01/
  01-discriminator-output.txt   the causal discrimination, real transcript
  02-red-tests.txt              RED at the pre-fix production seam
  03-green-tests.txt            GREEN with the repair
  discriminate.py               the discriminator itself (re-runnable)
```
