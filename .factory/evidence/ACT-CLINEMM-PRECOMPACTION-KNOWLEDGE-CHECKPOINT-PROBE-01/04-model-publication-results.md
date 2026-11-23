# 04 — Model publication results

**Evidence class:** `REAL_MODEL_RESPONSE` — the checkpoints were produced by the
operator's already-authorized local provider from the exact canonical history.

**Provider:** `openai-compatible` (the OpenAI-compatible transport), base URL
`https://api.minimax.io/v1`, model **`MiniMax-M3`**.
**Authorization:** the ACT required "the existing authorized local/provider execution
environment". The operator's own configured provider and key were read from the
operator-local `~/.cline/data` stores and used unchanged. **No new external provider was
introduced**, and no private transcript was sent anywhere the operator's own agent does
not already send it.

**Credential handling:** the API key is read from the operator-local secrets store at
runtime. It is never written to an output file, a log line, an evidence artifact or a
test fixture.

---

## 4.1 Generation contract

| | Boundary 1 | Boundary 2 |
|---|---|---|
| Canonical source prefix | first **47** canonical messages | first **101** canonical messages |
| Controlled input size | 22 490 chars (~7 497 est. tokens) | 39 799 chars (~13 267 est. tokens) |
| Model records emitted | **13** | **20** |
| Raw response size | 25 978 chars | 57 009 chars |
| **Generation latency** | **66 496 ms** | **80 654 ms** |
| Model calls | **1** (the ACT's maximum of one per boundary) | **1** |

The controlled input view renders assistant **text** and tool results through the
**production** `serializeMessage()`, and **excludes `thinking` blocks entirely**. The
model had **no execution tools**: it could only read the controlled input.

---

## 4.2 The availability discriminator (G4.3) — THE DECISIVE RESULT

For each witness, the full chain:

| Chain step | R4 | R6 | R2 |
|---|---|---|---|
| `in_canonical_history` | **true** | **true** (boundary 2) | **true** |
| `in_precompaction_provider_request` | **true** | **true** (boundary 2) | **true** |
| `in_checkpoint_model_input` | **FALSE** | **FALSE** | **FALSE** |
| `published_by_checkpoint_model` | subject only | subject only (boundary 1) | subject only |
| `validly_bound` | subject only | subject only | subject only |
| `retained_after_compaction` | subject only | subject only (boundary 1) | subject only |

**The measured root cause** (reproduced directly against the production serializer):

The R4 observation lives in canonical index 7 as a `tool_result` whose payload is the
production structured shape `{query, result, success}`:

```json
{"query": "cat startup.sh && cat Dockerfile.roz | head -60",
 "result": "...\n/opt/keycloak/bin/kc.sh build\n...\nexec /opt/keycloak/bin/kc.sh start --optimized \"$@\"...",
 "success": true}
```

The production serializer `renderStructuredToolPayload()` renders that payload as:

```text
[Tool result]: [succeeded] #1: [result omitted]
```

because **arbitrary command output is never copied**. The observation therefore never
reaches the summarizer, and — identically — never reaches the checkpoint model.

**This is the ACT's discriminator, answered precisely:**

> If R4 is not visible in checkpoint input, its omission is a source-selection/input
> defect, not a failure of knowledge extraction.

**Confirmed.** R4's exact omission is an **input-visibility defect**, upstream of the
model. It is *not* a knowledge-extraction failure, and this ACT does not report it as
one. The evaluator's answer key was never silently supplied to the model: the model saw
only the controlled view, and it explicitly reported that it could not see the tool
output bodies.

The model's own words (boundary 1, record `obs-002`):

```text
... The available tool-result bodies are omitted, so the ...
```

and (boundary 2, record `verification-scope-005`):

```text
Most successful tool-result bodies are rendered as omitted in the supplied transcript.
Consequently, individual match counts, effective values, file contents, and exact
command exit statuses cannot be reconstructed safely.
```

**The model detected the omission itself and refused to fabricate the missing content.**
That is the correct behaviour, and it is itself a positive result for the checkpoint
contract.

---

## 4.3 What the model DID publish — the qualification discipline

The model's output was of a high standard on everything it could legitimately see.

### Boundary 1 (13 records, 10 accepted, 2 rejected)

| Record | Kind | Assurance | Status | Substance |
|---|---|---|---|---|
| `obs-001` | observation | tool_observed | active | Repository identity commands were invoked. **REJECTED** — `CREDENTIAL_SHAPED_TEXT` (the absolute path matched the credential shape; see §4.6) |
| `obs-002` | observation | tool_observed | active | Which bounded searches were attempted; explicitly states the output bodies are omitted |
| `obs-003` | observation | tool_observed | active | Helm render batches were run with and without custom-image arguments; the filtered output is not retained |
| `obs-004` | observation | **model_reported** | active | The frozen R1–R10 ratings, qualified: *"These are frozen claims and original ratings, not adjudicated or runtime-verified findings."* |
| `obs-005` | observation | tool_observed | **unresolved** | The session did not reach terminal completion; no verdict matrix exists |
| `open-001` | open_question | unverified | unresolved | Identity is unverified because the output is not visible. **REJECTED** — `CREDENTIAL_SHAPED_TEXT` (path) |
| `open-002` | open_question | unverified | unresolved | *"None of CONFIRMED, NARROWED, CONDITIONAL, DISPROVEN, or UNKNOWN can be assigned from the retained checkpoint alone."* |
| `open-003` | open_question | unverified | unresolved | Whether upstream semantics were consulted is not established |
| `constraint-001..002` | constraint | model_reported | active | The read-only mission constraints |
| **`constraint-004`** | constraint | model_reported | active | **"A committed configuration value proves only that the value exists; absence from inspected paths does not prove absence of an external mechanism; and a historical incident proves occurrence, not persistence in the current revision."** |
| `constraint-005` | constraint | model_reported | active | The retracted `KC_LIQUIBASE_DATABASE_ON_STATE_CONFLICT` claim must not be resurrected |
| `constraint-003` | constraint | model_reported | active | The ten-row deliverable contract. **REJECTED** — `UNRESOLVED_INVESTIGATION_PROMOTED` |

**`constraint-004` is precisely the R6 qualification discipline the ACT demanded**, stated
as a standing constraint, without being prompted for R6 specifically.

### Boundary 2 (20 records, 12 accepted after the ceiling, 0 rejected)

| Record | Kind | Assurance | Status | Substance |
|---|---|---|---|---|
| `session-completion-001` | observation | tool_observed | active | The session did not reach terminal completion |
| `repository-path-002` | observation | tool_observed | active | The path was used successfully as a Git work tree |
| `repository-identity-003` | open_question | unverified | **unresolved** | *"The expected identity is a user-supplied requirement, not an observed repository fact."* |
| `working-tree-004` | open_question | unverified | **unresolved** | Working-tree cleanliness remains unknown |
| `verification-scope-005` | observation | tool_observed | active | The bounded static review that was performed |
| `repository-side-effects-006` | observation | tool_observed | active | No repository-writing command; only `/tmp` chart extraction |
| `upstream-semantics-007` | open_question | unverified | **unresolved** | Whether `start` implicitly builds was not established |
| `mission-constraints-008` | constraint | tool_observed | active | The read-only adjudication constraints |
| `reporting-contract-009` | decision | tool_observed | active | The deliverable contract |
| `r1-010` | open_question | unverified | **unresolved** | R1 unadjudicated |
| **`r2-011`** | open_question | unverified | **unresolved** | R2 unadjudicated. *"A class name alone is not evidence that the breaker is wired into the production sender path or prevents worker exhaustion."* |
| `r3-012` | open_question | unverified | **unresolved** | R3 unadjudicated |
| **`r4-013`** | open_question | unverified | **unresolved** | R4 unadjudicated. *"An intentional startup build can be operationally valid; the decisive issue is whether it produces inconsistent or unsafe effective configuration under the image's persisted build state."* |
| `r5-014` | open_question | unverified | **unresolved** | R5 unadjudicated |
| **`r6-015`** | open_question | unverified | **unresolved** | R6 unadjudicated. *"Repository absence searches are bounded and do not prove that no database job, external scheduler, or operational purge process exists."* |
| `r7-016` .. `r10-019` | open_question | unverified | **unresolved** | R7–R10 unadjudicated |
| `final-deliverables-020` | decision | tool_observed | active | What completion still requires |

**Every one of R1–R10 is published as `unresolved` / `unverified`.** No finding was
promoted. The R6 qualification in `r6-015` is exactly the boundedness the ACT required,
and the R4 qualification in `r4-013` keeps the drift hypothesis open without certifying
it.

---

## 4.4 The SECOND bottleneck — model prioritization vs. the experimental ceiling

At boundary 2 the model emitted **20** records. The 12-record experimental ceiling kept
the first 12 and dropped 8, including:

| Dropped record | Index | Why it matters |
|---|---|---|
| **`r4-013`** | 12 | The R4 subject AND its qualification |
| `r5-014` | 13 | — |
| **`r6-015`** | 14 | The R6 subject AND its qualification |
| `r7-016` .. `r10-019` | 15–18 | — |
| `final-deliverables-020` | 19 | — |

So at boundary 2 there are **two** independent reasons a subject's exact content is
missing from the projected checkpoint:

1. **Input visibility** (the exact observation was never in the model's input), and
2. **The experimental record ceiling** (the model DID write a qualified R4 and R6 record,
   but they fell outside the first 12).

These are different defects with different fixes. The ceiling is an artifact of the
ACT's own experimental bound; the input-visibility defect is a property of the
production source-selection contract.

**The two are not conflated.** The ceiling is reported as a ceiling effect, not as a
model failure and not as a source-selection defect.

---

## 4.5 Publication accounting

| Metric | Boundary 1 | Boundary 2 |
|---|---|---|
| `model_reported_records` | 13 | 20 |
| Records after the 12-record ceiling | 12 | 12 |
| `valid_checkpoint_records` (parsed) | 12 | 12 |
| `supported_records` | 10 | 12 |
| `qualified_records` (carry a qualification) | 12 | 12 |
| `unsupported_promotions` | **0** | **0** |
| `extra_tokens` (projected section) | 1 010 est. | 1 117 est. |
| `extra_model_calls` | **1** | **1** |
| `checkpoint_latency` | **66 496 ms** | **80 654 ms** |
| `summarizer_omissions` | see §4.2 — the summarizer never saw the detail either | same |
| `provider_visible_retention` | subject-level, not token-level | subject-level, not token-level |

### `unsupported_promotions` = 0 — and why that is the important number

Across both boundaries, **no published record promoted a hypothesis into a fact**, a
bounded negative into a global nonexistence, or an investigation target into a completed
finding. This is the single most important semantic result of the treatment, and it is
what the ACT's G5.1 negative controls are designed to protect.

### The latency cost, stated honestly

66–81 seconds is a **material** per-compaction cost. It is measured, not estimated. A
production deployment would need to justify it — for example by generating the checkpoint
only when the summarizer has actually lost bounded observations, or by using a smaller
model for the checkpoint role. **This ACT does not propose either.**

---

## 4.6 A measured false positive, and its correction

The first run of the validator rejected two boundary-2 records that carry **no secret**:

- `repository-path-002` — statement contains the absolute path
  `/Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak`
- `repository-identity-003` — statement contains the 40-hex revision
  `42de653b59708e712d694aeb9732f822b7f8fe5b`

Both matched a length-based "base64-shaped" credential pattern. This is a concrete
instance of the ACT's own warning that a regex sanitizer is not a confidentiality
control: an over-broad shape check destroys legitimate records.

The pattern was corrected to require **mixed character classes** (an uppercase letter
AND a digit) in addition to length, which separates a credential from a filesystem path
or a git revision. After the correction:

| | Boundary 1 | Boundary 2 |
|---|---|---|
| Accepted | 10 | **12** |
| Rejected | 2 | **0** |
| Rejection codes | `CREDENTIAL_SHAPED_TEXT` (a path record), `UNRESOLVED_INVESTIGATION_PROMOTED` | none |

The `UNRESOLVED_INVESTIGATION_PROMOTED` rejection at boundary 1 is a **true positive**:
`constraint-003` asserts the deliverable must "include ... assessment of R[1-10] ...
using only the five allowed verdict labels", and the phrasing matched the
completed-finding pattern. It is recorded here as a conservative gate behaviour, not as
a defect.
