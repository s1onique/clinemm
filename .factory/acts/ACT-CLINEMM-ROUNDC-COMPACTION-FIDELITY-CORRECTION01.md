# ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-CORRECTION01

> **Type:** evidence correction + bounded repair
> **Predecessor:** `ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-RECON02` (`eb245ae72f63159e180a12d1f6173d0ca4d0acb6`)
> **Trigger:** expert review of RECON02 → `PASS_WITH_CORRECTION_REQUIRED`
> **Evidence:** `.factory/evidence/ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-CORRECTION01/`

---

## 1. Mission

RECON02 established a **genuine** command-classification defect (S1) but
**overstated** the causal attribution of the ten live compactions (S2), and two
receipts contained claims that the evidence does not support.

This ACT does exactly two things, in this order:

1. **Correct the RECON02 receipts** so that no downstream ACT inherits an
   overstated causal claim or a false-positive fact.
2. **Implement the S1 repair** with RED → GREEN, bounded to the finite
   classification allowlist.

**S2 is NOT repaired.** It is HALTed pending matched decision-time evidence.

---

## 2. Dispositions carried from the review

| Finding | Decision | Implementation |
|---|---|---|
| S1 — `cd … &&` defeats command classification | `C1: GO` | **IMPLEMENTED** |
| S2 — trigger uses a representation different from the provider request | `HALT_ESTIMATOR_NOT_REPRODUCED_AT_ACTUAL_PATH` | **NOT IMPLEMENTED** — discriminator added |
| Result bodies deliberately omitted | Accept as policy, not a bug | Receipt authority corrected only |
| R1 — Helm render failed despite successful wrapper | `PASS` | False positive removed |
| R7 — existing Maven evidence recollected unnecessarily | `PASS`, bounded scope | Receipt unchanged in substance |
| New VSIX / Round C pass | `DEFER` | Nothing built, nothing installed |

---

## 3. S1 — the repair

### 3.1 The defect (reproduced)

`classifyCommand` matched the WHOLE LINE's leading words against a finite
allowlist. Every Round C command began `cd <path> && <cmd>`, and `cd` is not
in the allowlist, so the classification of the command that actually ran was
lost. The carried verified-outcome line degraded to
`- run_commands (call_…): succeeded — 10 commands` — with no indication of
what ran.

**RED (before the repair), reproduced in this ACT:**

```
classifyCommand("cd /repo && helm template kc .helm/roz")  === ""            // defect
classifyCommand("helm template kc .helm/roz")               === "helm template"  // control
```

**GREEN (after the repair):** both return `"helm template"`.

### 3.2 The design

The classifier now reads the command line as a sequence of quote-aware shell
**SEGMENTS** and classifies the executable of the segment that carries the
work.

The `cd` prefix is recognised as a **DIRECTORY CHANGE**, not as a command:
`cd <path> && <cmd>` classifies `<cmd>`. The `cd` segment's argument is a
path, and a path is never carried.

### 3.3 The invariants that must not regress

1. The carried value is **always** a finite-allowlist entry. The allowlist is
   **not** widened.
2. **No** user-supplied path, argument, URL or credential is ever carried.
3. The classifier is **not a shell**. A segment that could change WHICH word
   the shell executes is ambiguous, and the whole chain carries nothing.
4. **One** label is carried, or none.

### 3.4 Fail-closed rules

| Shape | Carried | Why |
|---|---|---|
| `cd <path> && <cmd>` | `<cmd>`'s allowlist label | the proven defect |
| `cd <path>; <cmd>` | `<cmd>`'s allowlist label | unconditional sequencing |
| `cd <path> && <a> && <b>` (both allowlisted) | **nothing** | which one ran is undecidable |
| `cd <path> && <cmd> \| head` | **nothing** | a pipeline's status is its LAST element's — the R1 shape |
| `cd <path> && <cmd> \|\| <fallback>` | **nothing** | the second segment runs only if the first FAILED |
| `cd <path> && $(…)` / backtick | **nothing** | command substitution |
| `cd <path> && <cmd> > file` | **nothing** | redirection |
| `cd <path> && ls *.yaml` | **nothing** | globbing |
| `cd <path> && <cmd> &` | **nothing** | backgrounding |
| `cd <path> && (<cmd>)` | **nothing** | grouping |
| `cd <path> && helm template 'a && b'` | `helm template` | a quoted operator is inert data |

### 3.5 What the repair does NOT claim

Recovering `helm template` as a classification **must not** be read as proof
that the render succeeded. The carried evidence records the tool's own success
signal; it never upgrades a wrapper status into a render outcome.

---

## 4. S2 — HALTED

### 4.1 The review's finding, independently confirmed

RECON02's counterexample compares two representations supplied **by hand** and
evaluates both through a **locally defined** `shouldCompactOn` helper
(`compaction.roundc-fidelity-recon02.test.ts:1128-1137`). It never drives the
production trigger.

### 4.2 The production facts

1. The trigger's request-size decision reads `context.apiMessages`, not
   `context.messages` (`compaction.ts:381-389`).
2. The production orchestrator populates `context.apiMessages` with the
   **API-safe projection** — `prepareProviderMessagesForApi` →
   `MessageBuilder.buildForApi` (`session-runtime-orchestrator.ts:1775`,
   `:1846-1856`) — **before** the trigger reads it.

So the upstream v4.1.26 correction (`43a976d93151`) is present on **both**
paths, and the raw view the counterexample compares against is not a
representation the production trigger can observe.

### 4.3 What is withdrawn

"The ten compactions were not justified" is **withdrawn**. The preceding
provider request's count is an **adjacent-request proxy**, not the decision
request; a later, unsubmitted request may legitimately cross the trigger.

### 4.4 What is NOT exonerated

The estimator's 3-chars-per-token assumption under-counting token-dense bodies
is a **separate, live and unmeasured** axis. It is the most likely remaining
candidate.

### 4.5 Precondition for any future S2 repair

Matched decision-time evidence: capture the request estimate, the
API-projection estimate, the trigger, the calibration factor and the request
identity through the existing compaction diagnostics — **default-off and
metadata-only** — and reproduce a mismatch through the **actual runtime
projection**, not a manually supplied raw view.

---

## 5. Gates

| Gate | Result |
|---|---|
| S1 RED reproduced | PASS — the pre-repair classifier returned `""` for the chain, `"helm template"` for the control |
| S1 GREEN | PASS — both return `"helm template"` |
| S1 regression suite | PASS — shell-chain classification, quoted paths, multiple commands, substitution, pipelines, unsupported operators, credentials |
| S2 discriminator | PASS — 6/6 tests, naming what it does **not** establish |
| Context suite | PASS — 17 files passed / 1 skipped; 316 tests passed / 2 skipped |
| Typecheck | PASS — 43 diagnostics, byte-identical to the pre-ACT baseline |
| Biome | PASS — zero errors, zero warnings on the four changed/new source files |
| JSON receipts | PASS — all four RECON02 JSON receipts re-parse |

---

## 6. Preservation

No history rewritten. No push. No VSIX built. No extension installed. No live
LLM request. No default-off instrumentation installed. No raw artifact, prompt,
tool output or credential is present in any published receipt.
