# 05 — Exit report

```text
ENTRY_HEAD=c92a45deb702eab5a3a84dee6e13f5b8f107b543
SUBJECT_HEAD=3f429aa42385b0f98f9963c9d68e78bbd3a09d17

SANITIZER_VERIFICATION_CORRECTION=COMMITTED (da82e0b7107a737e46504b00366955f93bff89a4)
SANITIZER_CONFIDENTIALITY_CONSERVATION=ESTABLISHED (28/28 ladder measurements, 0 mismatches, 20/20 sanitizer tests)

A10_PREDECESSOR_RED_RECOVERED=YES
A10_CURRENT_RED=YES (11 failed | 6 passed, at ENTRY_HEAD production code)
RAW_REFERENCE_PUBLICATION_BOUNDARY=renderEvidenceSection() -> createSessionCompactionState() / MessageBuilder.buildForApi()
A10_GREEN=YES (17 passed)
NECESSITY_ABLATION=YES (3 specific ablations, each reverting to RED)

PERSISTED_SUMMARY_REFERENCE_CONFIDENTIALITY=CONFIRMED
PROVIDER_CONTINUATION_REFERENCE_CONFIDENTIALITY=CONFIRMED
INTERNAL_REFERENCE_IDENTITY_CONSERVATION=CONFIRMED
REFERENCE_CORRELATION_CONSERVATION=CONFIRMED
REFERENCE_CARDINALITY_CONSERVATION=CONFIRMED
ASSURANCE_CONSERVATION=CONFIRMED
LEGITIMATE_EVIDENCE_CONSERVATION=CONFIRMED
ADVERSARIAL_CONTROLS=CONFIRMED (12 identifier families, 5 controls, both destinations)

ACT_OWNED_DIAGNOSTICS=0
NEW_REGRESSIONS=0

PCK_DEFAULT_OFF=CONFIRMED
SOURCE_BOUND_EVIDENCE_DEFAULT_OFF=CONFIRMED
B06_UNCHANGED=CONFIRMED

INFERENCE_REQUESTS=0
VSIX_PACKAGING=NOT_EXECUTED
INSTALLED_LIVE=NOT_EXECUTED

VERDICT=GO_MODEL_COMPARISON
```

## 5.1 — What was repaired

The evidence-continuity publication boundary published the canonical
tool-call id and the transcript-supplied tool name RAW. Both the persisted
compaction summary and the provider-visible continuation therefore carried
an arbitrary, transcript-supplied byte string as unrestricted text.

The repair publishes:

```text
- run_commands (ev-0): succeeded
```

instead of:

```text
- run_commands (toolu_01FAKE-CREDENTIAL-DO-NOT-USE-7P4xQz): succeeded
```

The alias is a runtime-controlled, publication-local sequence. The tool name
is escaped for the section delimiters and reduced to a single line.

The INTERNAL canonical identity is untouched: the call/result join, the
outcome record and the rejection ledger still use the canonical id.

## 5.2 — A second defect, found by the ACT's own control

The A3 control was written to assert on the RENDERED section rather than
the EXTRACTED one, because the extractor stops at the first end marker and
would have made the control vacuous. With that assertion in place it
FAILED against an otherwise-correct escaping: the escaping neutralised the
marker but not the LINE BREAK, and a line break in a transcript-supplied
name forged an ADDITIONAL carried outcome carrying an assurance and a
reference the runtime never minted.

The production treatment therefore reduces a published identifier to a
single line. This is recorded in the evidence package because it is a
defect the recovered predecessor RED did not name.

## 5.3 — What was NOT done

- The sanitizer was NOT made the publication authority. The defect is that
  an identifier was published at all; no regex can distinguish "safe to
  republish" from "happens to look harmless".
- The canonical id was NOT hashed or truncated. Both would still be a
  function of the id and would still carry its entropy.
- References were NOT discarded. That would satisfy the negative assertion
  only by destroying the evidence.
- No new public API, database, sidecar schema, provider field or
  general-purpose identity service was introduced. The alias helpers are
  module-internal; the package barrel is unchanged and the barrel witness
  passes.
- No cross-session or durable provenance requirement was invented. The
  alias lifetime was derived from the actual consumers.
- PCK was not revived, the PCK vocabulary was not expanded, the
  experimental source-bound evidence was not activated, and LEAMAS was not
  modified.

## 5.4 — The evidence package

```text
.factory/evidence/ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01/
  00-entry-and-subject-identity.md
  01-publication-boundary.md
  02-red-and-green.md
  03-conservation-and-adversarial.md
  04-gates.md
  05-exit-report.md
  verification/
    red-a10-reference-trust.txt
    green-a10-reference-trust.txt
    necessity-ablation.txt
    gates-relevant-suites.txt
    gates-containment-default-off.txt
    gates-lint-typecheck.txt
    full-suite-failing-after.txt
    full-suite-regression-comparison.txt
```

All identifiers in the committed evidence are SYNTHETIC. No real
credentials, private histories or unrelated source excerpts are published.

## 5.5 — The board

The existing A10 board row was UPDATED IN PLACE (not duplicated) in
`.factory/epic-board.md`, from `STATUS: RED_REPRODUCED /
PRODUCTION_CHANGE: NONE` to `STATUS: GREEN / PRODUCTION_CHANGE: APPLIED`,
with the exit contract recorded in the row.

No new ACT was started.

## 5.6 — The changed files

```text
sdk/packages/core/src/extensions/context/evidence-continuity.ts              (the repair)
sdk/packages/core/src/extensions/context/evidence-continuity.reference-trust01.test.ts   (new, 17 cases)
sdk/packages/core/src/extensions/context/evidence-continuity.test.ts         (alias-aware assertions)
sdk/packages/core/src/extensions/context/compaction.summary-churn01.test.ts
sdk/packages/core/src/extensions/context/compaction.stable-prefix-repair01.test.ts
sdk/packages/core/src/extensions/context/compaction.roundc-fidelity-recon02.test.ts
sdk/packages/core/src/extensions/context/bounded-evidence-contract/boundary-witness.ts
sdk/packages/core/src/extensions/context/bounded-evidence-contract/source-prefix.ts
sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/pck-reference-confidentiality.test.ts
.factory/epic-board.md
.factory/evidence/ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01/**
```

The updated regression suites changed their carried-line assertions from
"the raw id is present" to "a runtime-owned alias is present", so they
assert the alias SHAPE rather than depending on the raw identifier.
