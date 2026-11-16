# ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02

> Status: **CLOSED / VERIFIED_EVIDENCE_SAFETY_COMPLETE**.
>
> Epistemic purpose: **BOUNDED_PRODUCTION_ENGINEERING** — the final bounded
> correction to `ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01`,
> addressing the two new P0 categories raised by the second expert review
> (`HALT_VERIFIED_EVIDENCE_SAFETY_INCOMPLETE`).
>
> ```text
> ENTRY_HEAD           = CORRECTION01 working tree (uncommitted at review time)
> DEFECT              = (a) COMMAND_ARGUMENTS_CARRIED_INTO_SUMMARY
>                        (b) CONTRADICTORY_PAYLOADS_CERTIFY_SUCCESS
>                        (c) DUPLICATE_RESULTS_NOT_REJECTED
> CLASSIFICATION      = CONFIRMED_BY_REPRODUCTION (both P0s reproduced
>                        against the CORRECTION01 implementation)
> RED                 = 22 failed / 19 passed (41) at the pre-fix seam
> GREEN               = 41 passed / 41
> NO_REGRESSION       = 253/253 in src/extensions/context (1 skipped);
>                        the full core suite's failing-file set is
>                        BYTE-IDENTICAL before and after (diff = 0 bytes);
>                        50/50 in the apps/vscode compaction suites
> TYPECHECK           = 43 errors before AND after (ZERO regression;
>                        ZERO errors in the changed files)
> LINT                = biome 0 errors / 0 warnings on the 3 touched files
> SDK_BUILD           = EXIT 0
> EVIDENCE            = .factory/evidence/ACT-CLINEMM-COMPACTION-EVIDENCE-
>                        CONTINUITY-CORRECTION02/
> ```

## 0. Scope

This ACT touches ONLY the verified-outcome evidence module and its test
suite. Per the review's disposition it does **NOT** touch the
discriminator, the compaction lifecycle, telemetry, or the existing
task-contract machinery. The three original P0 repairs (wrong attribution,
unsupported conclusion, mixed-success promotion) and the raw-output removal
are all **kept as-is**.

## 1. P0-A — Command arguments could still expose credentials

### What was wrong

CORRECTION01 removed raw **tool output** from the carry-forward, but
`buildCommandSubject()` still copied the first three words of the **tool
input** into the provider-visible summary. Command arguments are arbitrary
user-controlled strings, and no regex can establish that an arbitrary
argument is safe. Reproduced against the CORRECTION01 implementation:

| Command input | Sensitive value survived? |
|---|---|
| `helm template kc-test .` | no |
| `echo synthetic-example-password` | **YES** |
| `curl https://demo:syntheticPassword@example.test/api` | **YES** |
| `psql 'postgresql://demo:syntheticPassword@db.example.test/app'` | **YES** |
| a `curl` invocation with an `Authorization: Bearer` header | no (bearer regex) |

The problem is structural, not a missing regex: an argument-position secret
has no distinguishing shape.

### What is now correct

The carried command information is a **CLASSIFICATION drawn from a finite
allowlist** — exactly the bounded fix the review prescribed:

- `COMMAND_CLASSIFICATION_ALLOWLIST` — the base commands
  (`helm`, `git`, `kubectl`, `curl`, …).
- `COMMAND_SUBCOMMAND_ALLOWLIST` — the two-word refinements
  (`helm template`, `git status`, `kubectl get`, …).

The longest matching entry wins, so `helm template` is preferred over
`helm`. A command that matches nothing yields **no label at all**: the
verified FACT still survives, and nothing unverified is invented.

**No user-supplied argument, path or URL is ever persisted.** The rendered
evidence is now:

```text
- run_commands (call_f476e4ce0f204de8baabc31d): succeeded — helm template
```

instead of the CORRECTION01 form, which embedded the user's `kc-test`
argument.

## 2. P0-B — Contradictory or incomplete statuses could certify success

### What was wrong

The CORRECTION01 classifier used `continue` immediately after
`success === true`, which **bypassed** the `isError` check on that same
payload:

```ts
if (payload.success === true) { sawSuccess = true; continue; }  // skips isError
if (payload.success === false) { sawFailure = true; continue; }
if (payload.isError === true) { sawFailure = true; }
```

So it accepted:

| Input | CORRECTION01 | Required |
|---|---|---|
| `[{success: true, isError: true}]` | `succeeded` | `failed` |
| `[{success: true}, {isError: false}]` | `succeeded` | `unknown` |

This contradicted the implementation's own stated invariant that every
payload must agree on affirmative success.

The related attribution case: duplicate **calls** were rejected, but
duplicate **results** sharing one call id were not. A successful result
followed by a contradictory failed result left the successful one carried.

### What is now correct

- All failure indicators are checked **independently on the SAME payload**.
  The `continue` bypass is gone.
- **Every payload must affirmatively succeed.** A payload carrying only
  `isError: false` (or no signal at all) leaves the batch `unknown` — not
  wholly verified — even when a sibling payload succeeded.
- The classification is **order-independent**; both orderings of every
  contradictory pair are tested.
- A call id answered by **more than one result** fails closed with the new
  `ambiguous_result_id` reason. Both orderings are tested.

## 3. The long-session test is relabelled `SYNTHETIC_REAL`

The review correctly noted that the long-session test uses a **synthetic
sequence modelled on** the real transcript, not the transcript itself. The
test is now explicitly named `SYNTHETIC_REAL: ...` and its comment states
the distinction: it establishes the bound's behaviour **for the real
transcript's shape**, not a live replay of that transcript.

## 4. The documented evidence-content limitation is unchanged

The carry-forward preserves **execution continuity** (the operation
succeeded, and which command classification), but deliberately does **not**
preserve the resolved image `quay.io/keycloak/keycloak:26.0.7`. The
provider-visible summary may therefore still contain the summary prose's
`NOT_EXECUTED` alongside the authoritative success record. The tests
establish that both statements survive, not that the model necessarily
resolves the contradiction correctly.

This limitation is **already documented** and, per the review's
disposition, does not reopen the architecture in this correction.

## 5. Verification

| Gate | Result |
|---|---|
| Focused suite (41 tests) | RED 22 failed / 19 passed -> GREEN 41/41 |
| `src/extensions/context` | 253 passed, 1 skipped |
| Full core suite failing-file set | BYTE-IDENTICAL before/after (diff = 0 bytes) |
| `apps/vscode` compaction suites | 50/50 |
| Typecheck (`tsconfig.dev.json`) | 43 errors before AND after; ZERO in changed files |
| Biome | 0 errors / 0 warnings on the 3 touched files |
| SDK build | EXIT 0 |

EVIDENCE: `.factory/evidence/ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-
CORRECTION02/` — `02-red-tests.txt`, `03-green-tests.txt`,
`05-baseline-failing-files.txt`, `06-after-failing-files.txt`,
`07-failing-file-set-diff.txt`

