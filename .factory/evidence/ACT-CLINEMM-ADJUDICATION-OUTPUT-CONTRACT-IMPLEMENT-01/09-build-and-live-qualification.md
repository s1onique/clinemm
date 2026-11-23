# 09 — The build and the live qualification

## The build

```text
sdk/packages/core   bun run build   EXIT 0
apps/vscode         bun run package EXIT 0
```

The VSIX:

```text
Path:   dist/clinemm-adj-implement01-95307eef1e9f898f1fde9869c4d1c5f3c7fdb73e.vsix
Bytes:  66453643
SHA256: d20367753a5a4fd1f92b5390076d7b3eef26234ac246aaecc1d6fcde14b281db
```

## The live qualification

### G9.1 — The minimal synthetic repository

The fixture is entirely SYNTHETIC and non-sensitive:

```text
the synthetic file    synthetic-pool-config.yaml
the synthetic content maxWorkers: 36 / documentedBudget: 400 / automaticEnforcement: absent
the synthetic finding S1
the synthetic revision 9ca5309aa18e43c97343d87171de20f2a198f6ccfe8f266c1f1c33557afa5dcd
```

The revision is the SAME value the historical Round C canonical snapshot
carries, so the receipt is comparable with the predecessor's.

### G9.2 — The actual publication

```bash
cd sdk/packages/core
CORE_LIVE_ADJUDICATION_PROBE=1 \
CORE_LIVE_ADJUDICATION_PROVIDER_KEY=minimax \
CORE_LIVE_ADJUDICATION_RUNS=16 \
bun scripts/adjudication-output-contract.implement01.live-probe.ts
```

```text
EXECUTION CLASS: REAL_MODEL_RESPONSE
MODEL / PROVIDER: minimax / MiniMax-M3
RUNS MEASURED:   16
```

Every run is emitted as its own sanitized observation, and the committed
transcript contains the whole report. The per-run receipts:

```text
run | schema | nonempty | refs | revision | accepted | semantic
  1 |  True  |   True   | True |   True   |   True  | False
  2 |  False |  False   | False|  False  |  False | False
  3 |  False |  False   | False|  False  |  False | False
  4 |  True  |   True   | True |   True   |   True  | False
  5 |  False |  False   | False|  False  |  False | False
  6 |  True  |   True   | True |   False  |  False | False
  7 |  True  |   True   | True |   True   |   True  | False
  8 |  True  |   True   | True |   False  |  False | False
  9 |  False |  False   | False|  False  |  False | False
 10 |  False |  False   | False|  False  |  False | False
 11 |  False |  False   | False|  False  |  False | False
 12 |  False |  False   | False|  False  |  False | False
 13 |  False |  False   | False|  False  |  False | False
 14 |  False |  False   | False|  False  |  False | False
 15 |  False |  False   | False|  False  |  False | False
 16 |  True  |   True   | True |   True   |   True  | False
```

```text
schema_valid              6 / 16
nonempty_evidence_refs    6 / 16
canonical_refs_resolved   6 / 16
source_revision_bound     4 / 16
candidate_accepted        4 / 16
semantic_support_verified 0 / 16
```

**THE LOAD-BEARING LIVE SUCCESS IS MET.** Four runs produced
`candidate_accepted = true` with a genuine, NONEMPTY, runtime-bound
evidence reference and an independently bound source revision. This is NOT
a vacuous resolution and NOT a model-invented id.

The predecessor's corrected measurement was `candidate_accepted: 0 / 10`.

Runs 6 and 8 are the independent-gate reporting working as designed:
`canonical_refs_resolved: true` with `source_revision_bound: false`.

`semantic_support_verified` is `0 / 16` and MUST remain `0`.

### G9.3 — The actual compaction

The compaction boundary is observed with the REAL agentic summarizer and
the REAL provider credentials, so the production agentic path is exercised
rather than a mock.

In ALL FOUR accepted runs:

```text
kinds=         ['compaction_summary', '(none)']
persisted=     True
visible=       True
finding=       True
handle=        True
count=         1        <-- exactly ONE section, no duplication
error=         None
```

So the chain is qualified end to end:

```text
REAL provider response
  -> canonical assistant text
  -> strict adjudication parsing
  -> C1: canonical evidence identity (a genuine handle)
       + source-revision binding (runtime-derived)
       + task-scoped validation (host-supplied vocabulary)
  -> ACCEPTED PROVISIONAL CANDIDATE
  -> real agentic compaction
  -> persisted bounded section
  -> provider-visible continuation
```

### The controlled summarizer-omission negative case

The DETERMINISTIC continuity under summarizer omission is exercised in
the STRUCTURAL suite (`RED-C2`), where the summarizer deliberately omits
the candidate:

```text
RED-C2: the summarizer OMITS the candidate and the continuation KEEPS it
```

That case drives the mocked summarizer, which is the only way to
CONTROL the omission. The live run above exercises the REAL summarizer,
which is the only way to observe the REAL compaction. Both are required,
and both were run.

### The capture

The committed transcript is
`verification/gate9-live-model-probe-implement01.txt`. It contains ONLY
the sanitized observations: the metrics, the decision, the qualification
codes, the remaining-question ids and the rejection reasons. It contains
NO raw provider payload, NO model prose, NO reasoning block, NO source
excerpt and NO credential. This was verified:

```bash
grep -ciE "sk-|api[_-]?key|secret|token" <transcript>   ->  0
grep -c "maxWorkers|documentedBudget|Let me|thinking"   ->  0
```

## G9.4 — The installed identity

```text
SOURCE_HEAD                 95307eef1e9f898f1fde9869c4d1c5f3c7fdb73e
SOURCE_VERSION              4.1.26
VSIX_PATH                   dist/clinemm-adj-implement01-95307eef1e9f898f1fde9869c4d1c5f3c7fdb73e.vsix
VSIX_BYTES                  66453643
VSIX_SHA256                 d20367753a5a4fd1f92b5390076d7b3eef26234ac246aaecc1d6fcde14b281db
INSTALLED_VERSION           NOT INSTALLED
INSTALLED_BUNDLE_SHA256     NOT INSTALLED
SESSION_ID                  live-adjudication-probe-session
CAPTURE_RUN                 16
COMPACTION_BOUNDARY         observed in 4 of 4 accepted runs
```

**The runtime was NOT installed.** A GUI-driven LIVE INSTALLED RUN is not
possible on this substrate: the branded VS Code AND the
harness-downloaded VS Code both die with SIGSEGV under the Seatbelt
profile, which is the same constraint the established precedent
(`live-installed-vsix-qualification.tcrr01.mjs`) records.

The live evidence above is therefore classified:

```text
EXECUTION CLASS: REAL_MODEL_RESPONSE
```

and NOT `LIVE_INSTALLED_RUN`. The VSIX was packaged and its bundled
bytes were verified to contain the implementation, but it was not
installed and driven.

## G9.5 — The behavioural convergence

**NOT ESTABLISHED, and NOT CLAIMED.**

> Improved time to completion or fewer repeated source reads is not
> established merely by accepted-candidate continuity.

A separate, controlled comparison is required, and this ACT did not run
one. The multi-hour Round C benchmark was NOT replayed.
