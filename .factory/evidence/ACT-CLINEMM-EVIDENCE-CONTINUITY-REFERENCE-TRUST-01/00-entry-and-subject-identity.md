# 00 — Entry and subject identity

```text
ACT:            ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01
ENTRY_HEAD:     c92a45deb702eab5a3a84dee6e13f5b8f107b543
C2_COMMIT:      da82e0b7107a737e46504b00366955f93bff89a4
SUBJECT_HEAD:   (see 05-exit-report.md)
CLASSIFICATION: SYNTHETIC_REAL_PRODUCTION_SEAM
```

## 0.1 — Entry identity

The contract named the expected predecessor:

```text
c92a45deb702eab5a3a84dee6e13f5b8f107b543
```

The actual `ENTRY_HEAD` discovered in the repository is exactly that commit,
and the predecessor ancestry is intact:

```text
c92a45deb702eab5a3a84dee6e13f5b8f107b543  docs(factory): record SUBJECT_HEAD for the sanitizer bounded-complexity repair
7a88dd10a                                    fix(core): bound sanitizeOutcomeText complexity without changing redaction
```

The tracked tree was clean at entry, and the protected evidence and stash
identities were unchanged by this ACT.

## 0.2 — The bounded predecessor verification correction (C2)

The three sanitizer review corrections were completed and committed BEFORE any
A10 production code was changed, in commit `da82e0b71`:

| Correction | Substance |
|---|---|
| C2.1 timing authority | The requested ladder length is recorded INDEPENDENTLY of the generated input length; the worst case is computed across all FOUR input families at EVERY required rung; watchdog termination, child-process failure and malformed measurement output are DISTINGUISHED rather than conflated. |
| C2.2 differential coverage | The PRNG multiplication uses `Math.imul()`; the synthetic PEM fixtures really CONTAIN the assembled PEM markers rather than literal interpolation placeholders; the differential scripts EXIT NONZERO on a mismatch. |
| C2.3 regression isolation | The pathological timing assertions run behind an INDEPENDENTLY TERMINABLE child process; the small functional and differential tests are preserved; no new testing framework was introduced. |

C2 verification passed under Node and Bun: 28/28 ladder measurements, zero
mismatches across the differential campaigns, 20/20 sanitizer tests, Biome
clean, and the typecheck unchanged at the 45-error baseline with zero
ACT-owned diagnostics.

No new confidentiality or availability defect was exposed by the corrections,
so the ACT continued directly into A10, with no additional pre-execution
review round.

## 0.3 — The subject

The subject is the EVIDENCE-CONTINUITY publication boundary in:

```text
sdk/packages/core/src/extensions/context/evidence-continuity.ts
```

The production function that mints the published representation is:

```text
renderEvidenceSection(ledger: VerifiedOutcomeLedger): string | undefined
```

## 0.4 — Scope exclusions observed

```text
LEAMAS untouched                     VERIFIED (0 touched paths)
PCK not revived                      VERIFIED (opt-in env var only)
Experimental source-bound evidence   VERIFIED (DEFAULT OFF)
B06 not repaired                     VERIFIED (not in the diff)
PCK vocabulary not expanded          VERIFIED
Command-result semantic frames       NOT IMPLEMENTED
Value-qualification pairing          NOT IMPLEMENTED
Ordinary compaction not redesigned    VERIFIED
Provider inference / retry policies  VERIFIED (unchanged)
Reasoning settings not modified      VERIFIED
Sanitizer credential coverage        NOT EXPANDED
New public API                       NONE (barrel witness passes)
```