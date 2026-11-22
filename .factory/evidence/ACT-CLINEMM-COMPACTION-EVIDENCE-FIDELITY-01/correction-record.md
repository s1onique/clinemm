# Correction record — ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CORRECTION01

This file records the review of `ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01` (commit
`e9ab27bc8`), the findings it raised, and what was done about each one.

## Verdict of the review

`HALT_NEW_P0_EVIDENCE_AND_SECURITY_DEFECTS`. The review accepted the RED->GREEN work and the
code-level discovery, but found **three P0 defects and one P1** in the ACT's own evidence and
repair. **All four are accepted.** Two of them (P0-2 and P0-3) are real defects in the shipped
repair, not only in the documentation.

| Finding | Disposition | Action |
|---|---|---|
| **P0-1** — historical replay used the FINAL canonical history for every boundary | **ACCEPTED — the claim was wrong** | The five-boundary replay is regenerated with each boundary's AUTHORITATIVE canonical prefix. |
| **P0-2** — summarizer visibility is not provider-visible preservation | **ACCEPTED — a real defect in the repair** | A dedicated, independently budgeted source-file-fact section was added, and a realistic outside-the-budget production-seam RED (SCENARIO 16) now guards it. |
| **P0-3** — source attribution does not establish confidentiality | **ACCEPTED — a real security defect in the repair** | The carried excerpt is now REDACTED with the module's existing value-position sanitizer, and four confidentiality controls (CONTROL 16-19) guard it. |
| **P0-4** — the behavioural causal claim used the wrong observation boundary | **ACCEPTED — the claim was wrong** | The behavioural claim is downgraded to `BEHAVIORAL_CAUSE_UNPROVEN`; the corrected chronology is reported. |
| **P1** — the fixture is labelled with a `run_commands` call id but reconstructed as `read_files` | **ACCEPTED — the label was wrong; the id was right** | Verified against the canonical transcript and the documentation corrected. The id `call_362cfbf4cd5d44c19d876aeb` IS the historical `read_files` call. |

## P0-1 — the historical replay was invalid

### What the review found

`verification/boundary-replay.json` reported the same **13** source-file reads for **every**
boundary, while `qualification-report.md` located those reads at canonical indices **7, 16, 164
and 216**. A replay of an early compaction cannot use evidence generated later in the session: the
corrected projection had been evaluated over the **complete final canonical history**.

### What was done

The authoritative canonical prefix of each boundary is now derived from the boundary's own
PRE-compaction provider request: the last tool-call id in that request is looked up in the
canonical transcript, and its assistant-message index is the prefix end.

| Boundary | Pre-compaction request's last tool-call id | Canonical prefix end | Prefix size |
|---|---|---|---|
| 7 -> 8 | `call_cf2e104766564657b26b14ca` | 15 | 16 messages |
| 23 -> 24 | `call_9fc3edfd1ee141c78a50efb8` | 49 | 50 messages |
| 41 -> 42 | `call_0bb085b10d764636b9b3e66a` | 85 | 86 messages |
| 62 -> 63 | `call_53285fd8d21a40fdb41a2ad3` | 127 | 128 messages |
| 84 -> 85 | `call_2b533113c5be408a8431fcc7` | 171 | 172 messages |

The persisted sidecar's own `source_message_count = 217` /
`source_last_message_key = id:msg_AdPPg-ET` (canonical index 216) independently confirms the
method for the final generation.

### The corrected result

The source-file reads inside each boundary's TRUE prefix are **6, 8, 8, 8 and 10** — not 13 for
every boundary. The regenerated `verification/boundary-replay.json` carries the corrected numbers.

## P0-2 — summarizer visibility was not provider-visible preservation

### What the review found

The ACT's own metrics distinguished the two: the corrected projection delivered the fact to the
**summarizer** at all five boundaries, but the **deterministic carry-forward** delivered it at
**only two**. At the 23->24, 41->42 and 62->63 boundaries the R4 read (canonical index 6) was
outside the `MAX_CARRIED_OUTCOMES = 12` window (whose oldest retained outcome was at canonical
indices 18, 59 and 99 respectively), so the summarizer's prose alone decided preservation.

The ACT's production-seam test used a small synthetic history where the R4 fact stayed eligible
for the deterministic carry-forward, so it did not reproduce the historical retention pressure.

### The RED that was missing (now present)

`SCENARIO 16` in `compaction.evidence-fidelity01.test.ts` reproduces the pressure honestly: the
R4 read is old, there are **twenty** later verified outcomes (more than
`MAX_CARRIED_OUTCOMES`), and the summarizer OMITS the fact exactly as the historical one did.

Against the `e9ab27bc8` repair this scenario **FAILED**:

```
× SCENARIO 16: with the R4 fact outside the 12-outcome budget and the summarizer
  omitting it, the provider-visible projection must still carry the fact
AssertionError: expected '[{"role":"user","content":[{"type":"t…' to contain
  '/opt/keycloak/bin/kc.sh build'
```

So the defect was real: the repair improved what the summarizer got to read, but did NOT
guarantee that the fact survived into the provider-visible projection.

### The repair

A **dedicated source-file-fact section** was added, with its own budget:

```
## Source file facts (canonical record)
<!-- cline-file-facts:begin -->
- <path>: <bounded, redacted excerpt>
<!-- cline-file-facts:end -->
```

- `MAX_CARRIED_FILE_FACTS = 12` — a **separate** constant from `MAX_CARRIED_OUTCOMES`. The
  outcome budget is an execution-status budget; it must not be the thing that decides whether a
  bounded factual excerpt survives.
- Derived from the **same boundary-scoped canonical prefix** as the outcome ledger, so the
  stable-prefix property is preserved (the section is byte-identical across continuations).
- Idempotent: the section is stripped and replaced, never appended twice.
- `MAX_CARRIED_OUTCOMES = 12` is **unchanged**.

`SCENARIO 16` now passes, and the regenerated boundary replay shows the file-fact section
carrying the witness at **all five** boundaries (it carried it at 2 of 5 before this correction).

## P0-3 — source attribution did not establish confidentiality

### What the review found

The repair copied a source file's content verbatim into the summarizer request and into the
PERSISTED compaction summary. A source file can contain passwords, API keys, private keys or
deployment credentials. The published `CONTROL 12` tested a secret in `run_commands` **stdout**,
not in a `read_files` result, so the excerpt path's confidentiality contract was unestablished.

This was confirmed directly: a `read_files` result containing `DB_PASSWORD=...` and
`API_KEY=sk-...` produced an excerpt containing both, verbatim.

### The repair

The carried excerpt is now passed through the module's **existing** value-position sanitizer
(`sanitizeOutcomeText()`) before it is carried. The sanitizer operates on the VALUE position of a
credential-shaped assignment and consumes the entire quoted value, so it handles
`DB_PASSWORD=hunter2`, `{"password":"..."}`, `password="two word secret"` and `apiKey: "a b c"`,
plus bearer headers, PEM private-key blocks and provider-shaped keys.

The confidentiality contract is now:

1. Only a **source-attributed file read** is carried. An arbitrary command's stdout has no
   attribution and is still `[result omitted]` (CONTROL 19).
2. A credential-shaped value in the carried excerpt is **redacted** (CONTROL 16, 18).
3. A credential in a source file never reaches the **summarizer request** or the
   **persisted/provider-visible projection** (CONTROL 17).
4. The excerpt is bounded (`SOURCE_FILE_FACT_CHAR_LIMIT = 2_000`) and marked when truncated.
5. The section delimiters inside a carried body are escaped, so a file body cannot forge a new
   authority.

The sanitizer is **not** claimed to make arbitrary content safe. It is applied ON TOP of the
source-attribution requirement, and it is the module's own already-reviewed mechanism.

## P0-4 — the behavioural causal claim used the wrong observation boundary

### What the review found

The ACT treated `messages[5]` inside the captured provider request 85 as "the model's first
action after seeing the iteration-85 compacted context". But a provider-request capture records
the **input sent to the model**, not the response generated afterwards. A tool call already
present in that input cannot demonstrate the model's reaction to that same request.

### What the corrected chronology shows

Comparing the tool calls in request 85 against request 84:

```
$ compare tool-calls(req84) vs tool-calls(req85)
req84 tool-calls: 24
req85 tool-calls: 4
--- are req85 calls present in req84? ---
IN-84  {"requests": [{"prompt": "Does this class write/persist build-time configuration
IN-84  {"requests": [{"prompt": "Quote the code showing how the build command persists
IN-84  {"commands": ["cd ... && grep -rn -l \"startup.sh\" ...
IN-84  {"commands": "cd ... && git rev-parse HEAD ...
```

**All four tool calls in request 85 were already present in request 84.** The
`grep -rn "kc.sh build"` call was issued BEFORE the boundary, so it was in the context before the
compaction and cannot be the model's reaction to the compacted summary.

The first genuinely NEW tool call after the boundary (request 86) is:

```
{"commands": ["cd ... && git rev-parse HEAD && git branch --show-current && git status --porcelain | head -30", ...]}
```

— re-establishing **repository identity**, not re-seeking the R4 `kc.sh build` fact.

And the canonical transcript shows the `read_files` of `startup.sh` occurs **exactly once**, at
canonical index 6. The model never re-read `startup.sh` after the boundary.

### The corrected disposition

| Claim | Disposition |
|---|---|
| Representation loss | `REPRODUCED` |
| Re-investigation afterwards | `NOT_OBSERVED` — the model did not re-read the R4 fact after the boundary |
| Behavioural causality | **`BEHAVIORAL_CAUSE_UNPROVEN`** |

The earlier `BEHAVIORAL_CAUSE_SUPPORTED` was **withdrawn**. It was based on a tool call that
predated the boundary.

This does not weaken the repair's justification: the preservation contract is that a
source-verified fact remains **accessible** in the provider-visible working context. The ACT's
RED is a fidelity assertion, not a behavioural-convergence claim, and it stands.

## P1 — the fixture identity

The review noted that the test named the historical `run_commands` -> `cat startup.sh` call id
but reconstructed the fixture as a `read_files` call.

Verified against the canonical transcript:

```
assistant idx 6 tool_use id = call_362cfbf4cd5d44c19d876aeb name = read_files
user      idx 7 tool_result tool_use_id = call_362cfbf4cd5d44c19d876aeb name = read_files
```

The id and the tool name are **both** the historical ones. The defect was in the file's
DOCUMENTATION, which mislabelled the id as a `run_commands` call. The documentation is corrected,
and it now records the verification.

The historical call read SIX files in one batch. The fixture reproduces the single-file shape so
the assertion isolates the R4 fact; the multi-file batch shape is covered by CONTROL 7.

## P2 — non-blocking

The invalid legacy `.factory/gate-summary.json` was **not** touched, as instructed.
