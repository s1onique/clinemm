# Containment record — ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CONTAINMENT-01

This file records the third review of the ACT (of `1427bbabc`), its
`HALT_P0_EXCERPT_CONTENT_CONFIDENTIALITY` verdict, and the bounded containment
the review directed.

## Verdict of the review

`HALT_P0_EXCERPT_CONTENT_CONFIDENTIALITY`. The review confirmed that SECURITY01
fixed the KNOWN sensitive-path bypass and that the rest of the evidence-fidelity
work was sound, but held the automatic fact-preservation feature because the
broader confidentiality defect was still open:

> SECURITY01 successfully fixes the known sensitive-path bypass. It does not
> close the broader confidentiality defect introduced by automatic file-excerpt
> carry-forward.

## The review's counterexample — confirmed against the production code

```
$ probe buildSourceFileFact(
    { query: "/repo/docs/build-notes.md",
      result: "1 | db.example:5432:production:app:FAKE-CREDENTIAL-DO-NOT-USE",
      success: true }, "read_files")
path sensitive?   : false
FACT EXCERPT       : "db.example:5432:production:app:FAKE-CREDENTIAL-DO-NOT-USE"
credential leaked  : true
```

The path is NOT sensitive under the SECURITY01 rules, and the content has the
credential shape already proven to bypass the sanitizer. So an ordinary source
file could still forward an unconventional credential into a summarizer request
and into a persisted, repeatedly-transmitted compaction summary.

## The containment

The review's instruction was explicit and is followed literally:

> Disable automatic raw `read_files` excerpt carry-forward **by default**, at the
> shared extraction boundary used by both the summarizer and deterministic
> file-fact section.

`buildSourceFileFact()` is exactly that shared boundary: it is the single
function through which BOTH the summarizer-input projection
(`compaction-shared.ts` -> `renderStructuredToolPayload`) and the deterministic
file-fact section (`evidence-continuity.ts` -> `extractSourceFileFacts`) obtain
an excerpt. The switch is therefore TOTAL: with it off, no excerpt is produced
for any source, and there is no path by which one can be carried.

```ts
export const SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false;
```

### Why the default is off

The excerpt path copies file CONTENT into a summarizer request and into a
PERSISTED, repeatedly-transmitted compaction summary. Source attribution proves
WHERE the bytes came from; it does not prove that those bytes are safe to
retain or forward.

- The content sanitizer recognizes credential-shaped SYNTAX only.
- The sensitive-PATH rule closes KNOWN credential locations.
- Neither closes an unconventional credential inside an ORDINARY file, and no
  additional regex or path denylist can: the set of credential formats is
  unbounded. OWASP's secrets-management guidance makes the same point —
  detection based on recognizable formats cannot reliably identify human-created
  or unconventional credentials.

So the capability is retained and demonstrated, but it is NOT deployed by
default. Turning it on is a deliberate, explicitly opt-in decision that belongs
to a broader trusted-evidence design — a separate ACT.

### The capability is not removed

`setSourceFileFactCarryForwardForTesting()` lets a test exercise the mechanism
without changing the production default. The restore function is returned, and
an `afterEach` restores it unconditionally, so an override can never leak into
another case.

## The RED (the review's requirement 2)

`CONTAINMENT 1` .. `CONTAINMENT 5`:

| Control | Asserts | Result |
|---|---|---|
| CONTAINMENT 1 | the automatic excerpt carry-forward is OFF by default | PASS |
| CONTAINMENT 2 | the review's counterexample: an unrecognized credential in an ORDINARY source is NOT carried | PASS |
| CONTAINMENT 3 | the ordinary-file credential reaches neither the summarizer request nor the persisted/provider-visible summary | PASS |
| CONTAINMENT 4 | no source-file fact is produced for ANY source while the carry-forward is off | PASS |
| CONTAINMENT 5 | the CAPABILITY still works when explicitly enabled | PASS |

### The RED is load-bearing

With the switch forced ON (`SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = true`),
exactly the containment cases fail:

```
× CONTAINMENT 1: the automatic excerpt carry-forward is OFF by default
× CONTAINMENT 2 (the review's counterexample): an unrecognized credential in an
              ORDINARY source is NOT carried
× CONTAINMENT 3: the ordinary-file credential reaches NEITHER the summarizer
              request NOR the persisted/provider-visible projection
× CONTAINMENT 4: no source-file fact is produced for ANY source while the
              carry-forward is off
 Test Files  1 failed (1)
      Tests  4 failed | 35 passed (39)
```

## Requirement 3 — the existing mechanisms are preserved

The task-contract carry-forward, the verified-outcome carry-forward and the
stable-prefix behaviour are UNCHANGED. The only behavioural change is that the
automatic EXCERPT path no longer produces anything.

The R4 fidelity tests are **kept as evidence of the capability**. They now run
with the switch explicitly enabled, and their names state that they are
capability cases. The DEPLOYED behaviour is asserted separately by the
CONTAINMENT cases. The ACT no longer claims that the capability is deployed.

## Requirement 4 — the re-run receipts

```
$ cd sdk/packages/core
$ bunx vitest run --config vitest.config.ts \
    src/extensions/context/compaction.evidence-fidelity01.test.ts
 Test Files  1 passed (1)
      Tests  39 passed (39)
EXIT=0

$ bunx vitest run --config vitest.config.ts src/extensions/context/
 Test Files  26 passed | 1 skipped (27)
      Tests  456 passed | 2 skipped (458)
EXIT=0

$ bun tsc -p tsconfig.dev.json --noEmit | grep -cE '^src/.*error TS'
43
```
43 is the entry-HEAD baseline; the ACT-owned diagnostics are 0.

```
$ bunx biome check <the modified production file> <the test file>
Checked 2 files. 0 errors, 0 warnings.
```

## What this containment does NOT claim

- It does **not** claim that the automatic fact-preservation feature is
  deployed. It is not.
- It does **not** claim that the excerpt path is safe. It is OFF.
- It does **not** remove the R4 fidelity evidence. The mechanism is proven; the
  safe default deployment is a separate decision.
- It does **not** reopen the compaction investigation. The provenance
  corrections, the causal withdrawal (`BEHAVIORAL_CAUSE_UNPROVEN`) and the
  budget-boundary RED all stand.
- It adds **no** generic secret scanner, **no** further path denylist and **no**
  new memory framework.

## The withdrawal the review anticipated

The review said: *"This may require withdrawing `PASS_STRUCTURAL_ONLY` for the
automatic fact-preservation feature."*

It is withdrawn **for the automatic feature**. The correct verdict for the ACT
as a whole is:

- The **information-loss mechanism** is `REPRODUCED` and the responsible
  transformation is `IDENTIFIED`.
- The **fidelity capability** is `DEMONSTRATED` but **NOT DEPLOYED**.
- The **automatic excerpt path** is `CONTAINED` (default off).
- Live qualification of the SAFE configuration is the next step; broader
  trusted-evidence preservation is a separate design ACT.
