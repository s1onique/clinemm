# 00 — Entry identity and scope

**ACT:** `ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01`
**Type:** bounded deterministic implementation
**Verdict:** `PASS_STRUCTURAL_ONLY`
**Authorization:** `C1: GO.` (operator brief "FWL02 — Interchange Import Contract")

| Property | Value | Label |
|---|---|---|
| Repository | `s1onique/clinemm` | REAL |
| Entry HEAD | `29774ba05851f9dd5a46a33a90d963ff3ef286d5` | REAL |
| Branch | `main` | REAL |
| Frozen FWL02 source HEAD | `29774ba05851f9dd5a46a33a90d963ff3ef286d5` | REAL |
| Board size at entry | 44,731 lines / 3,571,144 bytes | REAL |
| Epic detail files at entry | 22 | REAL |
| Production ClineMM code changed | **0 files** | REAL |
| Board / epic files / native closure plans / evidence changed | **0 files** | REAL |

## Scope boundary

This ACT implements the ClineMM-side adapter only. The FWMI v1 interchange package
itself is produced by codium-clinemm's historical-reconciliation ACT; the operator
supplies the real package afterwards. **No actual-source migration was executed against
the real board.** Every import in this ACT was exercised against an isolated scratch
repository under `/tmp`.

## The M1–M5 corrections

The operator's brief asks to "complete the previously authorized bounded M1–M5
corrections where they remain relevant to native ledger integrity and the interchange
import path."

Those corrections are **Leamas-side**: FWL01 "Deterministic ledger core" was closed as
*accepted with remaining integrity corrections*, and the M1–M5 items are properties of
the Go ledger core in the separate `s1onique/leamas` repository. The Leamas checkout
available in this sandbox (`/tmp/leamas-baseline-check`) is the pre-FWL baseline
(`v0.1.1-0.20261127023441`) and contains no `FWL01`/`FWL02` ACT; the FWL02 experiment
binary in `/tmp/fwl02.3kjYK9Nh/leamas` is `github.com/s1onique/leamas/cmd/leamas` at
`v0.1.1-0.20261127023441-7a09631b2973`.

**No Leamas-side work was performed** — it is outside this repository and outside this
agent's scope.

The ClineMM-side obligation that the M1–M5 corrections imply — *the interchange import
path must not weaken native ledger integrity* — is discharged here by:

- the strict validator (`validate.ts`), which refuses any import whose records are not
  fully and specifically valid;
- the persisted semantic conservation checks C1–C9 (`conserve.ts`), which re-read the
  written records and prove that no meaning was lost or promoted;
- the additive-namespace write discipline, which cannot corrupt a native closure plan,
  the board, an epic detail file or an evidence package.

