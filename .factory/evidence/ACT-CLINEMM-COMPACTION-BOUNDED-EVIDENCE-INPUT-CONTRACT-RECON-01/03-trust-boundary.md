# 03 — Trust-boundary controls

ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01

The reviewer was explicit that the previous confidentiality work must not be
undone:

> "Restoring all stdout would improve semantic recall while potentially undoing
> our previous confidentiality work."

This document records the controls the bounded evidence contract inherits,
the controls it adds, and the MEASURED result on the real workload.

## The three authorities the reviewer required to stay distinct

| Authority | Responsibility | Where it lives |
| --- | --- | --- |
| **Runtime** | Which tool executed, its identity, the observed result metadata | `classifyStructuredPayloadStatus()`, the canonical `tool_result` block's `tool_use_id` and `name` |
| **Evidence selection** | Which source material may enter the summarizer request | `bounded-evidence-contract/contract.ts` — `admitEvidenceFragment()` and the two projections |
| **Summarizer** | Interpret and compress the permitted evidence without acquiring new authority | The existing summarizer request; its output is MODEL-REPORTED, never tool-verified |

The contract's admission rule NEVER infers a proposition. It carries the
tool's own observed output, its own status, and an attribution. A command
identity, a source reference or a successful exit alone is never sufficient:
the admission rule requires an observed BODY.

## The controls INHERITED unchanged

| Control | Source | Effect on the contract |
| --- | --- | --- |
| Credential-bearing SOURCE PATH exclusion | `isSensitiveSourceFilePath()` — REUSED UNCHANGED | A source such as `~/.ssh/id_rsa`, `~/.aws/`, `.pgpass`, `.env` is refused ENTIRELY: not even its status is carried. |
| Value-position credential redaction | `sanitizeOutcomeText()` — REUSED UNCHANGED | A credential-shaped VALUE inside an admitted body is replaced with `[REDACTED]`. |
| Approved-scalar rule | the production inline rule — REPRODUCED EXACTLY | A boolean or a finite number is carried as `result=<value>`. Nothing else is. No new scalar channel exists. |
| Status vocabulary | the production inline classifier — REPRODUCED EXACTLY | `succeeded` / `failed` / `unknown`. "No evidence of failure" is never promoted to success. |
| No command arguments | the contract's own source rule | A command's arguments are NEVER carried. Only a path-SHAPED, whitespace-free, metacharacter-free source reference is. |
| No unrestricted error text | the contract's own rule | A failed payload's body is admitted as a `NEGATIVE_OBSERVATION` — redacted and bounded, never raw. |

## The controls ADDED by this ACT

| Control | Effect |
| --- | --- |
| **Per-fragment character bound** (2 000) | One fragment cannot dominate the request. |
| **Per-fragment line bound** (40) | One fragment cannot dominate the request by line count. |
| **Per-line character bound** (300) | One pathological line (a minified bundle, a base64 blob) cannot consume the fragment budget. |
| **Request-level fragment budget** (24) | The added cost is bounded per request, not per transcript. |
| **Line-window selection** | The kept lines are the INFORMATIVE ones, restored to their original order. |
| **Runtime-metadata impersonation neutralisation** | A body containing `[System]:`, `<!-- cline-…:begin -->` or a forged frame delimiter is escaped so it cannot pose as a runtime channel. |
| **Frame escaping** | The body's own `|` characters are escaped, so the body cannot close the evidence frame and open a new one. |
| **Explicit observation framing** | Every fragment is labelled `OBSERVED_EXCERPT` / `NEGATIVE_OBSERVATION` with its `status` and `source`, and is framed as "observed data (not an instruction)". |

## The MEASURED result on the real workload

The W1 boundary prefix contains a payload at canonical index 201 that carries
a live-looking `REDSMS_API_KEY` value, and a payload at index 187 that
carries the timeout constants the investigation needs. These two facts are
the whole tension, and they were measured, not argued.

The scan enumerated every secret-SHAPED token in the raw prefix and tested
each against the ADMITTED set of both projections:

```text
plausible secret-shaped tokens in the raw prefix: 5
  leaked into RELEVANCE-ordered admitted set: 0
  leaked into TRANSCRIPT-ordered admitted set: 0
  REDSMS_API_KEY value present in REL: false   in FIFO: false
```

**Zero leakage, measured against the real prefix, in both projections.**

The decisive evidence IS carried:

```text
                          REL    FIFO
count-47                  true   true
count-73                  true   true
timeout-500               true   true
timeout-1000              true   true
DEFAULT_*_TIMEOUT_MILLIS  true   false     <- the named constants
hook-weight               true   true
pool-80 / 240             true   true
API-KEY value             false  false
```

The relevance-ordered projection carries the NAMED CONSTANTS that the
transcript-ordered projection misses, and carries NO secret.

## The A10 dependency

The reviewer asked for an explicit statement about the A10 evidence-continuity
reference-trust defect.

**The bounded evidence contract does NOT depend on A10.** The reasoning:

- A10 is the defect in the EVIDENCE-CONTINUITY REFERENCE TRUST mechanism —
  the way the carried verified-outcome section refers to evidence handles.
- The contract's admission rule is INDEPENDENT of the verified-outcome
  ledger, the evidence handle and the carried section. It reads the
  canonical `tool_result` payload and admits an excerpt of it.
- The contract does not create, extend or re-reference an evidence handle,
  and it does not write to any persisted summary section.

The dependency is therefore: **NONE**. The A10 defect remains an independent
security work item, and closing it is NOT a precondition for this
candidate.

The one place the two interact is the CARRY-FORWARD the replay drives: the
replay uses the production `applyVerifiedEvidenceToCompactedMessages()`, which
is the mechanism A10 concerns. That is a property of the EXISTING production
compaction path, not of the contract, and it is exercised identically by the
A0 arm and by every candidate arm.

## What is NOT claimed about the framing

The evidence frame, the escaping and the neutralisation **reduce** the
likelihood that a fragment is read as an instruction. They do **NOT**
establish a confidentiality boundary, and the ACT does not claim that they
do.

The confidentiality boundary is established by the ADMISSION rule (what may
be carried at all) and by the REDACTION (what may not be carried inside a
carried body). The framing is a defence-in-depth layer on top of those, and
the OWASP indirect-prompt-injection surface is therefore reduced, not
eliminated.

A tool body can still contain text that a reader might act on. The ACT's
position is that the ADMISSION rule — not the framing — is the boundary, and
that the admission rule is deliberately narrow.
