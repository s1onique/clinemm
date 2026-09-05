# 06 — Outcome: B (consolidate effective-config derivation)

## Selected outcome

```text
SELECTED_OUTCOME = B   (consolidate effective-config derivation)
F3_VERDICT       = PASS_F3_RECON_OUTCOME_B
                  (= "recon succeeded; production fix is the next ACT")
F3_STATE         = RECON_CLOSED_PRODUCTION_OPEN
```

## §17 RED authorization (Outcome B specific)

Per §17, RED becomes authorized only if recon chooses Outcome A or
C (it chose B). Outcome B's RED authorization is gated on the
production ACT (F3B) that will implement the consolidation.

Specifically: F3B ACT's first action is to add the two RED tests
(T17 ollama contextWindow divergence; T18 read-side bypass count)
to confirm the current code is RED on those witnesses, then make
the fix to turn them GREEN. This is the standard RED → GREEN
pattern for Outcome B recon-to-production transitions.

## §19 Conservation matrix — N/A (no GREEN change in F3)

C1–C17 are not evaluated because no production change is proposed
in F3 recon. The matrix exists in the test corpus already (per
file-04 inventory with the relabeled honest-evidence convention:
SOURCE_MAPPING_VERIFIED = 16/18, INHERITED_EXECUTED_GREEN = 16/18 per
predecessor ACT closures, EXECUTED_IN_THIS_ACT = 0/18 because §17
says Outcome B recon does not require re-execution). Each C-item
has witness test(s) that have been INHERITED_EXECUTED_GREEN at HEAD
but were not re-run by this ACT.

## Review-algorithm answers

1. Is the seam already converged?
   **PARTIALLY.** Write-side authority is converged (store.write() is
   the single fan-out). Read-side authority is fragmented across 4
   sites with 3 different precedence orderings. The recon finding
   (D2 = YES) prevents Outcome D.

2. Are there dead bridges to delete?
   **YES — one.** `apps/vscode/src/sdk/provider-migration.ts:migrateProviders`
   is exported but never called outside the file itself and its
   test. Could be removed as part of F3B ACT (folded into Outcome B's
   scope).

3. Are there live bridges that must stay?
   **YES — three.** `state-migrations.ts:migrateWorkspaceToGlobalStorage`,
   `migrateLegacyProviderSettings`, and `sdk-task-history.ts` are all
   required for users with pre-SDK state on disk.

4. Does any host layer duplicate authority the SDK could own?
   **NO.** The SDK already owns the canonical store and exposes
   the read/write API. The host's `model-catalog/store.ts` is a
   thin wrapper that adds dual-write + event emission, which is
   appropriate host-layer concern. No C-justifying duplication
   found.

5. Is there a real behavioral invariant violated today?
   **YES — one (small).** Ollama contextWindow fallback divergence
   between picker and session when legacy `ollamaApiOptionsCtxNum`
   is set but `providers.json` ollama entry is absent. Not a
   generation bug; a UX consistency bug. Witnessed by T17.

6. Is there a structural invariant violated today?
   **YES — one (informational).** Read-side bypass ratio is 68%
   (22 direct reads vs 10 canonical reads). No enforced bound.
   Witnessed by T18.

7. Should recon become a production ACT now?
   **NO (per the ACT body stop conditions).** F3 recon produces an
   evidence dossier that the next ACT (F3B) will use to make the
   production change. F3 itself makes no production change.

8. Do conservation tests remain green?
   Yes per INHERITED_EXECUTED_GREEN (per file-04 inventory; not
   re-executed in this ACT because no production edit was made and
   §17 says Outcome B recon does not require re-execution).
   Source-mapping verified 16/18; prior GREEN history inherited from
   predecessor ACT closures. The 2 unwitnessed items (T17, T18) are
   new geometry surfaced by recon; they will become RED in F3B ACT
   when added as tests.

## Discrimination against the other outcomes

### Why not A?

A is "delete obsolete compatibility bridge(s)". There IS one DEAD
bridge (`migrateProviders()`) that could be deleted. But the more
important finding is D2 (multiple effective-config derivations),
which A does not address. Choosing A would leave the read-side
fragmentation unaddressed and the ollama contextWindow divergence
bug live.

### Why not C?

C is "migrate ownership toward @cline/core/@cline/llms seam". C
requires evidence that the host layer duplicates authority the SDK
could own. The recon established that the SDK already owns the
canonical store and exposes the read/write API; the host's
`model-catalog/store.ts` is an appropriate wrapper. No C-justifying
duplication found. Choosing C would require either inventing new
SDK facilities (out of F3 scope) or accepting that the host's UI/RPC
layer must be absorbed into the SDK (a much larger migration).

### Why not D?

D is "PASS_F3_NO_FACTORIZATION_NEEDED". D requires that no further
consolidation would reduce complexity without weakening the trust
boundary. But D2 surfaces a real read-side fragmentation that has
measurable consequences (T17: ollama contextWindow divergence).
This is a small but real bug, not just awkwardness. Choosing D
would leave the bug live and the bypass ratio unmonitored.

## Outcome B scope and cost estimate

The production change required to close F3 is bounded:

```text
Files affected:       3
  apps/vscode/src/sdk/cline-session-factory.ts        (4 call-site changes)
  apps/vscode/src/sdk/provider-migration.ts           (delete dead function)
  apps/vscode/src/sdk/__tests__/                      (new T17 + T18 tests)

LOC delta estimate:   +50 (tests) -30 (deleted migrateProviders) -10 (replaced
                      bypass sites with store.read() calls)
                      = net +10 LOC

Risk:                 LOW (store.read() is already the documented canonical
                      derivation; the change routes existing direct reads
                      through it)

Trust-boundary impact: NEUTRAL (does not weaken the SDK ownership of
                       providers.json; only changes how the host reads it)
```

## F3 closure summary

```text
F3_RECON_OUTCOME        = B
F3_RECON_VERDICT        = PASS_F3_RECON_OUTCOME_B
F3_PRODUCTION_NEEDED    = YES (hand off to F3B ACT)
F3_OWN_EOF_TARGET       = 0
RANGE_HYGIENE_DIFF      = 0 (F3 recon does not modify production)
F3_LIVE_BUG_FOUND       = 1 (T17 ollama contextWindow divergence; small UX bug)
F3_DEAD_BRIDGE_FOUND    = 1 (migrateProviders in provider-migration.ts)
F3_STRUCTURAL_INVARIANT = 1 (T18 read-side bypass ratio)
F3_HANDOFF              = ACT-CLINEMM-FACTORIZE-F3B-PROVIDER-SESSION-CONFIG-AUTHORITY-CONSOLIDATE01
                          (the next ACT, not part of this recon)
```
