# ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01

## 00 — Entry identity and the bounded A10 correction

```text
ACT_ID:    ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01
TYPE:      bounded repair + upstream recon + behavioural qualification
BRANCH:    main
ENTRY_HEAD (expected): df99675ed40a899ceae2b22ffe5224537c88f2fd
ENTRY_HEAD (discovered): df99675ed40a899ceae2b22ffe5224537c88f2fd  — MATCHES
PREDECESSOR: ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (df99675ed)
```

### 1.1 Entry checks

| Check | Result |
| --- | --- |
| Branch | `main` |
| `ENTRY_HEAD` (full SHA, discovered at runtime) | `df99675ed40a899ceae2b22ffe5224537c88f2fd` |
| `ENTRY_HEAD` (short, as the ACT expected) | `df99675ed` — **matches** |
| Tracked worktree cleanliness | **CLEAN** — `git status --porcelain` reported only the ACT's own new untracked files |
| Stash inventory | **EMPTY** — `git stash list` returned nothing |
| Predecessor ancestry | `df99675ed` is `docs(factory): record the A10 reference-trust exit contract`, the recorded predecessor closure |

**Unexpected tracked dirt: NONE. No HALT.**

### 1.2 Default-off posture

| Mechanism | State at ENTRY_HEAD |
| --- | --- |
| PCK (pre-compaction knowledge checkpoint) | **DEFAULT OFF** — `isPckClosedEnabled()` gates it; no PCK input, vocabulary, budget or deadline was changed |
| Experimental source-bound evidence | **DEFAULT OFF** — `SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false` |

Neither was touched by this ACT.

## 01 — The bounded A10 correction (tool-name publication)

### 1.1 The counterexample, reproduced

The predecessor's reference-trust repair removed the canonical tool-call id
from the published form and minted a runtime-owned alias (`ev-N`). It left the
**TOOL NAME** published verbatim — escaped for the section delimiters and
reduced to one line.

The tool name is TRANSCRIPT-SUPPLIED. The escaping neutralises the section's
structure, but the name's BYTES still reach the published artifact.

The counterexample is a synthetic, VALID canonical call/result pair whose tool
name carries a confidential sentinel:

```text
- run_commands-FAKE-CREDENTIAL-DO-NOT-USE-7P4xQz (ev-0): succeeded — helm template
```

**REPRODUCED** against the production seam. The measurement was taken by
driving the REAL production seam
(`createCompactionStateAwarePrepareTurn()` -> `createContextCompactionPrepareTurn()`
-> `createSessionCompactionState()` / `MessageBuilder.buildForApi()`) with a
canonical history whose single observation is that pair.

The observation is REPRESENTATIVE AND VALID: the call/result join is
unambiguous, the tool names agree, the result carries an affirmative success
signal, and it IS carried. The defect is that its LABEL is published in an
uncontrolled form — not that the observation is dropped.


### 1.2 Why a shape rule is not enough

A tool name is an IDENTIFIER, not content — but an identifier is still an
arbitrary byte string supplied by whoever produced the transcript. A
credential-shaped name satisfies every shape rule an identifier might have, so
no regex can decide that it is safe to republish. The sound rule is the one the
alias repair already established for the reference id: **the published form
must be runtime-owned**.

### 1.3 The correction

`sdk/packages/core/src/extensions/context/trusted-tool-labels.ts` (NEW):

```text
UNTRUSTED_TOOL_LABEL = "tool"
TRUSTED_TOOL_LABELS  = <the runtime's own built-in tool identities>
resolvePublishedToolLabel(toolName) -> toolName | UNTRUSTED_TOOL_LABEL
```

The vocabulary is a FIXED list of the runtime's own tool identities (the core
built-ins, the team tools and the VS Code host's `command_status`). It is
deliberately NOT derived from the transcript, from the session's live tool
inventory, or from any provider message: a vocabulary assembled from the
transcript would re-admit exactly the bytes this repair removes.

The publication site (`renderEvidenceSection()`) now resolves the name before
publishing it. The INTERNAL canonical identity is untouched: the outcome
record, the call/result join and the rejection ledger still use the canonical
name. Only the PUBLISHED REPRESENTATION changes.

### 1.4 A witness regression the correction EXPOSED

The bounded-evidence-contract boundary witness FAILED against the corrected
code — 2 of its 6 cases. The failure was **informative, not incidental**: the
witness's POSITIVE control detected the synthetic post-boundary observation
**only** through its published tool name. That is precisely the route the
correction closes.

The witness was therefore re-based onto a detection route that the correction
PRESERVES and that is stronger: the **command CLASSIFICATION**. The
classification is drawn from the finite, runtime-owned classification
allowlist, so it is published verbatim, and it is a property of the
OBSERVATION rather than of the transcript-supplied name. The synthetic
history's pre-boundary messages carry no tool outcomes at all, so the synthetic
observation is the only outcome the carry-forward can publish and the
classification identifies it unambiguously.

The negative control (the observation is INACCESSIBLE at the original
boundary) still holds: the classification is inside the boundary prefix, so it
is not carried at the original boundary either.

### 1.5 Gates

```text
RED    (production reverted)    6 failed | 9 passed (15)     EXIT=1
GREEN  (after the correction)   15 passed (15)               EXIT=0
A10 REFERENCE-TRUST SUITE       17 passed (17)               EXIT=0
EVIDENCE-CONTINUITY SUITE       62 passed (62)               EXIT=0
BOUNDED-EVIDENCE-CONTRACT       40 passed (40)               EXIT=0
WHOLE CONTEXT SUITE             83 files passed | 1 skipped; 1 184 passed | 2 skipped
TYPECHECK                       45 -> 45, ZERO DELTA; 0 ACT-owned diagnostics
BIOME (changed files)           0 errors, 0 warnings
BIOME (whole context tree)      26 errors / 18 warnings / 63 infos == the entry-HEAD baseline
```

**A10_TOOL_NAME_PUBLICATION=REPRODUCED_AND_CORRECTED**
**A10_SOURCE_CLOSURE=SOURCE_QUALIFIED**
