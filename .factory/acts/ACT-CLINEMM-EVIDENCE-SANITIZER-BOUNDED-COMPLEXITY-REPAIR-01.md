# ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01

## Verdict

**GO_EVIDENCE_REFERENCE_TRUST_REPAIR**

The production `sanitizeOutcomeText()` had TWO pathological operations, both
reproduced against the REAL production sanitizer in an independently
terminable child process, both causally isolated by ablation, and both
removed by a bounded repair that produces **byte-identical output** to the
predecessor on every input tested.

```text
ENTRY_HEAD=1d45a8d845eca27bce311949a08fca7868f211cd
SUBJECT_HEAD=7a88dd10aafc20d5957d77b8616e752342cf6a42

PRODUCTION_SANITIZER_RED=REPRODUCED (12 watchdog terminations on the ladder)
PATHOLOGICAL_OPERATION_ISOLATED=YES (2 operations: credential-assignment
                                    key run; PEM lazy span)
NECESSITY_ABLATION=CONFIRMED (restoring either operation restores the failure)
PRODUCTION_SANITIZER_GREEN=CONFIRMED (0 watchdog terminations)

TIMING_50KIB_MS=0.626 (Node/V8 max) | 5.876 (bun max)   [limit 100]
TIMING_1MIB_MS=10.850 (Node/V8 max) | 116.509 (bun max) [limit 1000]
WATCHDOG_TERMINATIONS_AFTER_REPAIR=0
BOUNDED_COMPLEXITY_ARGUMENT=STRUCTURAL (see "Why the pathology cannot recur")

REDACTION_CONSERVATION=CONSERVED (byte-identical to the predecessor)
CONFIDENTIALITY_REGRESSIONS=0
ORDINARY_CONTENT_CONSERVATION=CONSERVED
PRODUCTION_SEAM_VERIFICATION=PASSED

ACT_OWNED_DIAGNOSTICS=0
NEW_REGRESSIONS=0

PCK_DEFAULT_OFF=UNCHANGED
SOURCE_BOUND_EVIDENCE_DEFAULT_OFF=UNCHANGED
A10_UNCHANGED=YES

VSIX_PACKAGING=NOT_EXECUTED
INSTALLED_LIVE=NOT_EXECUTED
INFERENCE_REQUESTS=0
```

## Identity

- ENTRY_HEAD: `1d45a8d845eca27bce311949a08fca7868f211cd` (the expected
  predecessor; verified present and the HEAD of `main`).
- PREDECESSOR: `ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01`.
- BRANCH: `main`. TRACKED TREE AT ENTRY: clean. STASHES AT ENTRY: none.
- ACT_BODY_BINDING: `.factory/acts/ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01.md` (this file).
- EVIDENCE_BINDING: `.factory/evidence/ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01/`.

## 1. Recon — the production surface

The sanitizer is `sanitizeOutcomeText()` in
`sdk/packages/core/src/extensions/context/evidence-continuity.ts`. It is
exported from the package barrel (`sdk/packages/core/src/index.ts`).

### The four production operations (the predecessor's implementation)

| # | Operation | Pathological? |
|---|-----------|--------------|
| 1 | Credential-assignment value redaction | **YES — quadratic** |
| 2 | Bearer / Basic / Token header redaction | no — measured linear |
| 3 | PEM private-key block redaction | **YES — quadratic** |
| 4 | Provider-shaped key redaction (`sk-`, `ghp_`, `xox`) | no — measured linear |

### Production callers

| Caller | Location | Input bound |
|--------|----------|-------------|
| `buildSourceFileFact()` | `evidence-continuity.ts:653` | **UNBOUNDED** — the sanitizer sees the WHOLE source body, and the excerpt is truncated only AFTER redaction |
| `admitEvidenceFragment()` | `bounded-evidence-contract/contract.ts:480` | bounded by `boundExcerpt()` BEFORE redaction |

`buildSourceFileFact()` is the seam the defect actually reached. It is
reachable from `compaction-shared.ts:269`.

### The redaction categories the sanitizer actually supports

Established from the production source, and each one asserted:

1. Value-position credential assignment whose KEY names a secret
   (`password`, `passwd`, `secret`, `token`, `api_key`, `apikey`,
   `credential`, `private_key`, `access_key`, `auth_key`, `passphrase`),
   in `key=value` and `key: value` form, with a quoted or bare value.
2. `Bearer` / `Basic` / `Token` headers with an 8+ character token.
3. PEM private-key blocks.
4. Provider-shaped keys: `sk-…`, `ghp_…`/`gho_…`/`ghu_…`/`ghs_…`/`ghr_…`,
   `xoxb-…`/`xoxa-…`/`xoxp-…`/`xoxr-…`/`xoxs-…`.

### Confidentiality versus presentation truncation

These are DIFFERENT mechanisms and were kept distinct:

- **Confidentiality** is the sanitizer: it removes a credential-shaped VALUE.
  The repair changes ONLY this.
- **Presentation truncation** is `truncateText()` and `boundExcerpt()`:
  they shorten a carried excerpt to a fixed cost. The repair changes NOTHING
  here.

The sanitizer executes **SYNCHRONOUSLY**, on the extension host's thread.
A `Promise.race()` against a timeout cannot bound it, because the event loop
is blocked for the whole of the backtracking — which is exactly why the
witness runs it in a terminable child process.

### Publication destinations affected

The sanitizer's output reaches the summarizer input and the carried
evidence section, and thence the provider request. A non-terminating
sanitizer blocks the compaction path entirely.

## 2. RED — the defect is reproduced against the REAL production sanitizer

The predecessor's own independently terminable child-process witness was
reused: `sdk/packages/core/scripts/sanitizer-bounded-complexity-witness.ts`.
It imports and executes the ACTUAL production sanitizer, not a copied
regular expression. The parent enforces an independent hard timeout and
`SIGKILL`s the child when it is exceeded.

**At the entry head, on the input ladder:**

```text
PREDECESSOR RED: watchdogTerminations: 12
  terminationModes: ['nonmatching@32768', 'nonmatching@51200',
                     'nonmatching@131072', 'nonmatching@524288',
                     'nonmatching@1048576',
                     'matching@32768', 'matching@51200',
                     'matching@131072', 'matching@524288',
                     'matching@1048576',
                     'pem-flood@524288', 'pem-flood@1048576']
  legacy unboundedCasesTerminated: 2 ['nonmatching', 'matching']
```

The predecessor's ORIGINAL witness, verbatim, at the entry head:

```json
{ "mode": "nonmatching", "length": 50000, "elapsedMs": 5001, "terminated": true },
{ "mode": "matching",    "length": 50000, "elapsedMs": 5001, "terminated": true },
{ "mode": "adversarial", "length": 50000, "elapsedMs": 4,    "terminated": false },
{ "mode": "nonmatching", "length": 2000,  "elapsedMs": 15,   "terminated": false }
```

Both the pathological (non-matching) and the credential-bearing (matching)
50 KiB inputs hit the 5 s watchdog. The 2 KiB input completed in 15 ms.

### Direct measurement of the predecessor's growth (Node 26 / V8)

```text
KEY-nonmatch len  10000   539.46 ms
KEY-nonmatch len  20000  1792.87 ms
KEY-nonmatch len  40000  4731.85 ms
```

**Quadratic**: doubling the input quadruples the time. The 32 KiB rung of
the ladder is already past the predecessor's practical limit.

### The PEM operation, measured separately (Node 26 / V8)

```text
PEM begin-no-end len  12400    1.45 ms
PEM begin-no-end len  24800    5.54 ms
PEM begin-no-end len  49600   22.19 ms
PEM begin-no-end len  99200   87.79 ms
PEM begin-no-end len 198400  352.96 ms
```

Also quadratic, in the number of `BEGIN` markers.

## 3. Causal discriminator — which operation is responsible

Each operation was measured in isolation, against the production pattern,
with the other three removed:

| Operation | Isolated result |
|-----------|-----------------|
| 1 — credential-assignment key run | **Quadratic. THE PRIMARY CULPRIT.** 50 000 chars → 3 816 ms. |
| 2 — bearer header | Linear. Not pathological. |
| 3 — PEM lazy span | **Quadratic. THE SECOND CULPRIT.** 50 000 markers → 22 ms, growing 4× per doubling. |
| 4 — provider-shaped key | Linear. Not pathological. |

### Necessity ablation

Restoring each operation in isolation, into the repaired implementation:

```text
REPAIRED (bounded key + linear PEM)      :    0.76 ms  [nonmatching 50 KiB]
ABLATED  (predecessor key regex restored) : 3816.93 ms  [nonmatching 50 KiB]
REPAIRED (bounded key + linear PEM)      :    2.30 ms  [PEM flood]
ABLATED  (predecessor PEM regex restored) :   17.54 ms  [PEM flood]
```

**Removing the suspected operation removes the pathological behaviour;
restoring it restores the failure.** Both operations are necessary.

### Why the two operations were pathological — the mechanism

**Operation 1.** The predecessor's pattern was

```
("?)((?:[A-Za-z0-9_.-]*(?:password|…)[A-Za-z0-9_.-]*)\1\s*[:=]\s*)(VALUE)
```

The leading `[A-Za-z0-9_.-]*` is greedy and there was NOTHING anchoring the
START of the key run. The engine therefore attempted the match at EVERY
offset inside the run, and at each offset it consumed the run and then
backtracked through the run's characters looking for the secret name, the
closing quote, the `:`/`=` and a value. On a body with no match, every one
of those attempts failed after a full traversal of the run. The cost is
**O(run length) per offset × O(run length) offsets = O(n²)**.

**Operation 3.** The predecessor's pattern was

```
-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----
```

The LAZY `[\s\S]*?` span means: for EACH `BEGIN` marker, rescan forward to
the end of the input looking for an `END` marker. A body with many `BEGIN`
markers and no matching `END` costs **O(markers × body length)**.

### A claim NOT made

**Exponential complexity is NOT claimed.** Both behaviours are
**superlinear (quadratic)**, established by the 2×/4× growth measurements
above. Superlinear pathological behaviour is sufficient to justify the
repair, and no stronger claim is made.

## 4. The bounded repair

The smallest mechanism that eliminates the identified complexity, in the
ACT's own candidate order:

**Candidate 1 (chosen) — simplify the offending expression into a
demonstrably bounded pattern.**

*Operation 1.* A single guard was added to the credential-assignment
pattern: the run-boundary lookbehind `(?<![A-Za-z0-9_.-])`, together with a
secret-name lookahead `(?=…)` so the engine can reject a position without
consuming and backtracking the whole run.

This is **semantics-conserving, not a policy change**. The predecessor's
greedy key run already spanned the ENTIRE run, and the left-to-right scan
always preferred the run's start; a match beginning at a later offset of
the same run could therefore never be preferred over the one beginning at
the run's start. The guard makes the engine attempt the match only at the
run's start — which is exactly the position the predecessor would have
selected.

*Operation 3.* The single PEM pattern was replaced by a **deterministic
linear scan** (`redactPemPrivateKeys`): the `END` markers are located ONCE
in a single left-to-right pass, and each `BEGIN` marker is paired with the
nearest `END` that starts at or after its end, using a binary search. The
`BEGIN` marker's greedy extent is resolved by walking the `[A-Z ]*` run
from its LONGEST form down to its shortest — the same order the engine's
backtracking used — and the `END` marker's extent is computed with a
**sticky** regex anchored at the literal offset, so the engine performs the
same greedy-and-backtrack search it performed inside the predecessor's
pattern.

**Candidate 2 (not needed) — deterministic scanning** was needed only for
the PEM operation, whose pattern could not be expressed as a bounded
single pattern.

**Candidate 3 (not needed) — a bounded parser** was NOT introduced: the
deterministic scan of candidate 2 is sufficient.

### What was NOT done

- No dependency, worker pool, new service, or runtime configuration was
  introduced.
- No input was silently truncated. The repair changes the sanitizer's
  COST, not its INPUT.
- No input was silently returned unsanitized on failure. The sanitizer
  either completes and redacts, or the process is genuinely wedged — as it
  was before.
- The redaction policy was NOT weakened. The output is byte-identical to
  the predecessor's.
- The sanitizer's API and its callers' semantics are unchanged:
  `sanitizeOutcomeText(text: string): string` keeps its signature and its
  contract.
- The bearer and provider-shaped patterns were left UNCHANGED: they were
  measured linear, and changing them would have been an unrequested
  change.

### Why the previous pathological behaviour cannot recur

This is a STRUCTURAL argument, not a timing argument.

1. **Operation 1.** The guard `(?<![A-Za-z0-9_.-])` makes a match
   ATTEMPTABLE only at the start of a key run — a position whose preceding
   character is not a key-run character. The number of attemptable
   positions in a body is therefore O(number of key runs), NOT O(body
   length). At each attemptable position the engine consumes the run ONCE
   (a single greedy pass) and, if the secret-name lookahead fails, it
   rejects the position WITHOUT having traversed the run. The
   backtracking-within-a-run cost is therefore paid once per run, and the
   quadratic "retry at every offset" behaviour is structurally impossible:
   no offset inside a run is attemptable.
2. **Operation 3.** The `END` markers are located in ONE left-to-right
   pass. The scan over the `BEGIN` markers advances a monotone cursor, and
   each pairing is a BINARY SEARCH over the already-located `END` markers.
   There is no forward rescan of the body from any `BEGIN` marker, so
   "markers × body length" is structurally impossible.

The measured ladder confirms the argument: growth is now **linear** (20×
input → ~20× time, and 2× input → 2× time), where the predecessor's was
quadratic.

## 5. GREEN — the ladder, measured

The exact RED witness, re-run against the repair. The parent enforces the
independent hard timeout and `SIGKILL`s the child on breach.

```text
watchdogTerminations: 0 []
secretSurvivals:      0
worst50KibMaxMs: 5.876  (limit 100)   ok=True
worst1MibMaxMs:  116.509 (limit 1000) ok=True
```

### Node 26 / V8 — the production extension-host runtime

5 repetitions per rung, median and maximum:

```text
mode         input      median_ms    max_ms
nonmatching      2048       0.014      0.509
nonmatching      8192       0.046      0.052
nonmatching     32768       0.176      0.188
nonmatching     51200       0.274      0.287
nonmatching    131072       0.739      0.753
nonmatching    524288       2.845      3.549
nonmatching   1048576       5.609      6.393
matching        1048576       4.387      4.611
nearmatch      1048576       5.685      6.444
pemflood       1048576      10.775     10.850

WORST_50KIB_MAX_MS=0.626   (limit 100)
WORST_1MIB_MAX_MS=10.850   (limit 1000)
```

### bun 1.3.14 — the SDK runtime

```text
worst50KibMaxMs: 5.876  (limit 100)   ok=True
worst1MibMaxMs:  116.509 (limit 1000) ok=True
```

Both runtimes satisfy the screening limits with a large margin, and NEITHER
produced a watchdog termination at any rung.

### The growth is linear, not merely "under the limit"

| Input | Predecessor | Repaired (Node) |
|-------|-------------|----------------|
| 8 192 | 101.73 ms | 0.046 ms |
| 32 768 | 1 935.62 ms | 0.176 ms |
| 1 048 576 | (did not terminate) | 5.609 ms |

A 4× input increase took the predecessor from 102 ms to 1 936 ms (19×) and
the repaired implementation from 0.046 ms to 0.176 ms (3.8× — linear).

## 6. Confidentiality conservation

### The gate

The strongest available gate: a **DIFFERENTIAL** comparison against the
predecessor's own output, over every input for which the predecessor
terminates. The predecessor implementation is frozen verbatim in the test
file as the reference oracle; the function under test is always the
production `sanitizeOutcomeText`.

### Results

```text
random fuzz:    300 000 inputs   0 mismatches
structured:         118 inputs   0 mismatches
pem fuzz:        200 000 inputs   0 mismatches
committed suite:   2 000 random + 47 structured   0 mismatches
```

### The categories asserted

| Category | Assertion | Result |
|----------|-----------|--------|
| `key=value` credential assignment | the value does not survive | PASS |
| `key: value` credential assignment | the value does not survive | PASS |
| Quoted value with spaces | the whole value does not survive | PASS |
| JSON-shaped `"password":"…"` | the value does not survive | PASS |
| Bearer / Basic / Token header | `[REDACTED]` emitted | PASS |
| PEM private-key block | `[REDACTED PRIVATE KEY]` emitted | PASS |
| Provider-shaped key (`sk-`, `ghp_`, `xox`) | `[REDACTED]` emitted | PASS |
| Ordinary content | unchanged, byte for byte | PASS |
| Marker and contextual label | `DB_PASSWORD=[REDACTED]` — the label is conserved | PASS |
| Repeated application | the predecessor's exact behaviour is reproduced | PASS |
| Credential at the START of a long input | redacted | PASS |
| Credential at the END of a long input | redacted | PASS |
| Credential crossing a chunk boundary | redacted | PASS |
| Long credential value (50 000 chars) | redacted | PASS |
| Multiple credentials in one input | all redacted | PASS |
| Long non-matching prefix | terminates, unchanged | PASS |
| Repeated separators and whitespace | terminates, identical to the predecessor | PASS |
| Near matches | identical to the predecessor | PASS |
| Mixed line endings | identical to the predecessor | PASS |
| Unicode and malformed text | identical to the predecessor | PASS |
| PEM markers with no closing marker | identical to the predecessor | PASS |
| Nested PEM blocks | identical to the predecessor | PASS |

### A correction the ACT made to itself

The ACT's first draft asserted that the sanitizer was IDEMPOTENT. It is
not — and it was not idempotent in the predecessor either, because the
redaction marker `[REDACTED]` is itself a value-position assignment whose
value runs up to the first `]`. The existing contract does NOT require
idempotency. The assertion was corrected to assert that the repair
**reproduces the predecessor's exact repeated-application behaviour**
(`[REDACTED]` → `[REDACTED]]`), because "improving" it would have been an
unrequested change to the emitted text.

### A correction the ACT made to itself (the PEM rewrite)

The FIRST PEM rewrite — locating both marker kinds with a global regex and
pairing them by offset — diverged from the predecessor on 9 138 of 200 000
adversarial PEM inputs. The divergence was in the pairing semantics: the
predecessor's greedy `[A-Z ]*` marker extent can OVERLAP the `END` literal,
and the predecessor's lazy span consumes a `BEGIN` marker that lies inside
an already-consumed span. The rewrite was replaced with the faithful
algorithm described above, which reproduces the predecessor exactly. The
divergence was caught by the differential fuzz, not by inspection.

### No newly-claimed coverage

No previously-unsupported credential category is claimed to be covered
now. The `.pgpass`-style credential, the legacy `_auth=` token and the
`scheme://user:password@host` URL still survive the sanitizer — exactly as
before. The repair does not change that, and the ACT does not claim it.

## 7. Production-seam verification

The ACT's own suite exercises the REAL production caller
`buildSourceFileFact()`:

- The production path REACHES the repaired sanitizer — asserted by
  observing the carried fact.
- The pathological input COMPLETES — a 100 000-char body is sanitized in
  under the screening limit.
- The credential-bearing value is NOT published — `hunter2` does not
  appear in the carried excerpt, and `[REDACTED]` does.
- Ordinary evidence remains unchanged — a source excerpt with no
  credential is carried verbatim, with the line gutter stripped.
- The carry-forward behaviour remains intact — the automatic carry-forward
  is still **DEFAULT OFF**, asserted by a control.

## 8. Executable gates

| Gate | Result |
|------|--------|
| ACT-owned suite (`sanitizer-bounded-complexity.repair01.test.ts`) | **20 tests PASSED** |
| `evidence-continuity.test.ts` | 62 tests PASSED |
| `compaction.evidence-fidelity01.test.ts` | 39 tests PASSED |
| `source-bound-evidence.test.ts` | 22 tests PASSED |
| The whole `src/extensions/context/` suite | **81 files passed, 1 skipped; 1152 tests passed** |
| Typecheck (`bun run typecheck`, `@cline/core`) | **45 → 45, ZERO DELTA** |
| Biome (`check --diagnostic-level=error`) on the three touched files | **CLEAN** |
| RED witness against the predecessor | 12 watchdog terminations |
| RED witness against the repair | **0 watchdog terminations** |

**ACT_OWNED_DIAGNOSTICS=0**
**NEW_REGRESSIONS=0**

No unrelated full-repository gate was executed: the change touches one
production module in one package, and that package's context suite, its
typecheck and its lint cover it.

## 9. Scope exclusions — honoured

Nothing outside the sanitizer was modified. Specifically untouched:

- PCK generation or inference policies — untouched.
- Experimental source-bound evidence selection — untouched.
- Carried-unit shape — untouched.
- Command-result pairing — untouched.
- A10 reference trust — untouched.
- Model settings, provider request policies — untouched.
- Compaction eligibility, context budgets — untouched.
- Oracle or scoring machinery — untouched.

The production delta is exactly:

```text
sdk/packages/core/src/extensions/context/evidence-continuity.ts          (the repair)
sdk/packages/core/src/extensions/context/sanitizer-bounded-complexity.repair01.test.ts  (new)
sdk/packages/core/scripts/sanitizer-bounded-complexity-witness.ts        (the witness)
```

```text
PCK_DEFAULT_OFF=UNCHANGED
SOURCE_BOUND_EVIDENCE_DEFAULT_OFF=UNCHANGED
A10_UNCHANGED=YES
VSIX_PACKAGING=NOT_EXECUTED
INSTALLED_LIVE=NOT_EXECUTED
INFERENCE_REQUESTS=0
```

## 10. Exit contract

```text
ENTRY_HEAD=1d45a8d845eca27bce311949a08fca7868f211cd
SUBJECT_HEAD=7a88dd10aafc20d5957d77b8616e752342cf6a42

PRODUCTION_SANITIZER_RED=REPRODUCED
PATHOLOGICAL_OPERATION_ISOLATED=YES
NECESSITY_ABLATION=CONFIRMED
PRODUCTION_SANITIZER_GREEN=CONFIRMED

TIMING_50KIB_MS=0.626 (Node/V8) / 5.876 (bun)
TIMING_1MIB_MS=10.850 (Node/V8) / 116.509 (bun)
WATCHDOG_TERMINATIONS_AFTER_REPAIR=0
BOUNDED_COMPLEXITY_ARGUMENT=STRUCTURAL

REDACTION_CONSERVATION=CONSERVED (byte-identical)
CONFIDENTIALITY_REGRESSIONS=0
ORDINARY_CONTENT_CONSERVATION=CONSERVED
PRODUCTION_SEAM_VERIFICATION=PASSED

ACT_OWNED_DIAGNOSTICS=0
NEW_REGRESSIONS=0

PCK_DEFAULT_OFF=UNCHANGED
SOURCE_BOUND_EVIDENCE_DEFAULT_OFF=UNCHANGED
A10_UNCHANGED=YES

VSIX_PACKAGING=NOT_EXECUTED
INSTALLED_LIVE=NOT_EXECUTED
INFERENCE_REQUESTS=0

VERDICT=GO_EVIDENCE_REFERENCE_TRUST_REPAIR
```
