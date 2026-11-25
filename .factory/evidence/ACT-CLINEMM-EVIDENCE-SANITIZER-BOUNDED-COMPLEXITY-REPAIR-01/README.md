# ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01 — evidence

| File | What it is |
|------|------------|
| `01-identity.txt` | Entry and subject identity. |
| `02-production-caller-inventory.txt` | The production callers, their input bounds, and the four sanitizer operations. |
| `03-red-receipt.txt` | The RED receipt: the predecessor's watchdog terminations and the measured quadratic growth. |
| `04-causal-discriminator.txt` | Which operation is responsible, and the necessity ablation. |
| `05-green-ladder.txt` | The GREEN timing ladder on both runtimes, and the structural bounded-complexity argument. |
| `06-confidentiality-conservation.txt` | The differential confidentiality gate and the two self-corrections. |
| `07-production-seam.txt` | The production-seam verification against `buildSourceFileFact()`. |
| `08-gates.txt` | The executable gates and the scope exclusions. |
| `09-typecheck-baseline.txt` | The typecheck diagnostics at the entry head (45). |
| `09-typecheck-after.txt` | The typecheck diagnostics after the repair (45) — byte-identical. |
| `regenerate.sh` | Regenerates the evidence scripts' inputs and re-runs them. |
| `ablate.mjs` | The necessity ablation. |
| `ladder2.mjs` | The Node/V8 timing ladder against the production sanitizer. |
| `difffuzz.mjs` | 300 000 random differential cases against the predecessor. |
| `diffcases.mjs` | 118 structured adversarial differential cases. |
| `pemfuzz.mjs` | 200 000 PEM-shape differential cases. |

## Re-running

```bash
bash .factory/evidence/ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01/regenerate.sh
```

The script extracts the PRODUCTION sanitizer from the real module and the
PREDECESSOR sanitizer verbatim from the entry head, then runs the five
evidence scripts.

The committed witness — which exercises the real production module through
an independently terminable child process — is:

```bash
cd sdk/packages/core && bun scripts/sanitizer-bounded-complexity-witness.ts
```

The committed regression suite is:

```bash
cd sdk/packages/core && bunx vitest run --config vitest.config.ts \
  src/extensions/context/sanitizer-bounded-complexity.repair01.test.ts
```
