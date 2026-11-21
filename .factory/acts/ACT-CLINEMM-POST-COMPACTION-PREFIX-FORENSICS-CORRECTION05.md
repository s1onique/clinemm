# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION05

**Type:** bounded correction of a single **capture-contract** defect.
**Scope:** the missing `sessionId` on the `runtime_projection` stage. No new
instrumentation, no stale-read-policy change, no new inference run, no push, no
VSIX replacement, no Strata restart.

---

## 0. The finding this correction acts on

> *In the ClineMM source I inspected, the runtime_projection capture call does
> not pass sessionId, even though the analyzer now requires it. If your smoke
> test confirms MISSING for that stage, it is a capture-contract defect — not a
> cache diagnosis. The smallest correction is to pass the already-existing
> `this.modelBehaviorTraceIdentity().sessionId` into that call. Don't start a
> costly live forensic run until the three-stage identity check succeeds.*

**CONFIRMED by execution, and corrected here.**

The report was accurate in every particular:

- the `runtime_projection` capture call did **not** pass `sessionId`;
- the analyzer does require it (mandatory on **both** sides);
- the fix is the already-existing `this.modelBehaviorTraceIdentity().sessionId`;
- it is a capture-contract defect, **not** a cache diagnosis.

---

## 1. The defect

The analyzer's lineage gate makes FIVE identities mandatory on **both** sides of
a comparison: cohort, session, iteration, preparation and attempt. Three of the
five are minted by the **runtime**, so the runtime must carry them on every
representation stage it captures.

| Stage | Call site | `sessionId` |
|---|---|---|
| B `ai_sdk_prompt` | `sdk/packages/llms/src/providers/ai-sdk.ts:2469` | `request.metadata?.sessionId` |
| C `wire_request` | `sdk/packages/llms/src/providers/provider-request-capture.ts:816` | `request.metadata?.sessionId` |
| **A `runtime_projection`** | **`sdk/packages/agents/src/agent-runtime.ts:3038`** | **ABSENT** |

Stage A passed only `preparationRequestId`, `providerAttemptId` and
`iteration`:

```ts
recordPrefixForensicsRuntimeProjection(request, {
    preparationRequestId: this.modelBehaviorTraceIdentity().preparationRequestId,
    providerAttemptId: this.modelBehaviorTraceIdentity().modelRequestId,
    iteration: this.state.iteration,
});
```

The bundle grouping key is
`(cohortId, sessionId, iteration, preparationRequestId, providerAttemptId)`, so
a stage A record without a session id lands in a **different bundle** from the
stages B and C of the **same request**. The three-stage request bundle could
never be assembled, and every authoritative comparison was refused.

The capture writer was **never** at fault: `recordPrefixForensics()` and
`recordPrefixForensicsRuntimeProjection()` already accepted `sessionId`. Only
the call site stopped passing it.

**Correction.** The call site now passes the already-existing
`this.modelBehaviorTraceIdentity().sessionId` — the same accessor the very same
call already used for the other two identities, and the same value the runtime
puts into the request metadata for stages B and C.

---

## 2. The reopen condition

> *Don't start a costly live forensic run until the three-stage identity check
> succeeds.*

| Witness | Seam | Control | Result |
|---|---|---|---|
| STAGE-01 | the REAL `AgentRuntime` | the runtime-projection capture carries a non-empty session identity | **PASS** |
| STAGE-02 | the REAL `AgentRuntime` | all four runtime-minted identities are PRESENT and non-empty | **PASS** |
| STAGE-03 | the REAL `AgentRuntime` | stage A's session identity EQUALS the value stages B and C read | **PASS** |
| THREE-STAGE-01 | the REAL capture writer + the REAL analyzer | three stages of ONE request form ONE bundle with ALL THREE stages | **PASS** |
| THREE-STAGE-02 | the REAL capture writer + the REAL analyzer | a MISSING session identity on one stage SPLITS the request | **SPLITS (control)** |

`STAGE-03` is the strongest of the three: it asserts that stage A carries the
**same** value stages B and C read, so the three stages of one request cannot
land in three different bundles.

### 2.1 RED — the witnesses fail against the CORRECTION04 implementation

The runtime was reverted to its `2b49d2ed0` content while keeping the new
witnesses:

```
× STAGE-01: the runtime-projection capture carries a NON-EMPTY session identity
× STAGE-02: the runtime-projection capture carries ALL FIVE mandatory identities
× STAGE-03: the runtime-projection session identity MATCHES the provider-bound stages

AssertionError: expected undefined to be 'session-1' // Object.is equality
AssertionError: expected undefined to be defined
AssertionError: expected undefined to be 'session-1' // Object.is equality

Tests  3 failed (3)
```

### 2.2 GREEN

```
Tests  3 passed (3)
```

The three-stage gate through the real writer and the real analyzer:

```
✓ src/providers/prefix-forensics-capture.test.ts (10 tests)
Tests  10 passed (10)
```


---

## 3. Conservation

| Gate | Result |
|---|---|
| Agents stage-identity suite (3 tests) | **PASS** — and **3 FAIL** against the CORRECTION04 implementation |
| LLMs capture suite (10 tests) | **PASS** |
| shared package sweep | **611 passed / 6 skipped**, 0 failed |
| llms package sweep | 17 failed / 1172 passed — **identical failure count** at pristine HEAD (+2 passes) |
| agents package sweep | 43 failed / 563 passed — **identical failure count** at pristine HEAD (+3 passes) |
| Typecheck (agents, llms, shared) | **EXIT 0** |
| Build (`bun run build:sdk`) | **EXIT 0** — bundle **and** declaration emit |
| Biome lint (the three touched files) | **EXIT 0** (3 infos, no errors) |
| Provider semantic delta | **NONE** |
| New inference run | **NONE** |

The llms and agents failures are **pre-existing** and were each measured at
pristine HEAD `2b49d2ed0` in the same session. The additional passes are
exactly the new witnesses: `STAGE-01`…`STAGE-03` (agents) and
`THREE-STAGE-01`…`THREE-STAGE-02` (llms).

---

## 4. What is NOT changed

- The CORRECTION03 lineage model and authority invariants are **RETAINED**.
- The CORRECTION04 permanent conflict exclusion is **RETAINED**.
- The capture writer's contract is **unchanged** — it already accepted
  `sessionId`. No capture instrumentation was added.
- The causal separation is **RETAINED**: `PREFIX_MUTATION_ISOLATED` stays
  **closed**; `STRATA_PLATEAU_CAUSE_UNPROVEN` stays **OPEN**.
- The stale-read policy is **not** touched.
- No push, no VSIX replacement, no inference-service restart, no provider request.

---

## 5. What the next step now is

The condition the reviewer set — *the three-stage identity check succeeds* — is
now met and proven by execution against the REAL capture writer and the REAL
analyzer. **The live installed-runtime Strata qualification may proceed.**

That qualification is a **measurement**, not a change: it must use the same
model and engine configuration, preserve the source/build identity,
independently verify the join key, and correlate ONE rewrite with the next two
or three Strata cache decisions — distinguishing the cost of the initial prefix
invalidation, how quickly the rewritten prefix becomes cacheable, and whether
checkpoint retention prevents recovery.

The stale-read policy and the engine's checkpoint placement are both left
untouched: this ACT makes the instrumentation able to carry the evidence, and
the evidence is what will tell us whether either of them should change.
