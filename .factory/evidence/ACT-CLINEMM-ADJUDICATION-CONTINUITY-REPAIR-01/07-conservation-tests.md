# 07 — Conservation tests

**ACT:** `ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01`
**Status:** All invariants hold. **No production file was touched**, so every
shipped-code invariant holds by construction — and the invariants that ARE
observable are also **asserted executably**.

---

## 1. The conservation matrix

| Invariant | Requirement | Observed | How verified |
|---|---|---|---|
| `SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED` | remains `false` | `false` | **EXECUTED** — discriminator `CONSERVATION: the deployed production constants are unchanged` asserts `evidence.SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED === false` and `isSourceFileFactCarryForwardEnabled() === false` against the **production** module |
| `MAX_CARRIED_OUTCOMES` | remains `12` | `12` | **EXECUTED** — same test asserts `evidence.MAX_CARRIED_OUTCOMES === 12` |
| Canonical history | byte-identical | unchanged | **EXECUTED** — discriminator `CONSERVATION: canonical history is unchanged by the projection` compares `JSON.stringify(canonical)` before and after |
| Tool-use/result pairing | preserved | preserved | **EXECUTED** — discriminator `CONSERVATION: the tool call/result PAIRING is preserved by the projection` checks every `tool_use` id has a matching `tool_result` |
| Sidecar schema | unchanged unless authorized | **unchanged** | **VERIFIED BY DIFF** — no production file modified (§4 of `00-entry-and-red-identity.md`) |
| Task contract | unchanged | **unchanged** | **VERIFIED BY DIFF** — `sdk/packages/core/src/extensions/context/task-contract.ts` untouched |
| Provider tool schemas | unchanged | **unchanged** | **VERIFIED BY DIFF** — `sdk/packages/core/src/extensions/tools/` untouched |
| No-op preparation | zero additional model calls | zero | **VERIFIED BY DIFF** — no production change; `compaction.ts` untouched |
| Stable prefix | no unnecessary earlier-message changes | unchanged | **EXECUTED** — discriminator `CONSERVATION: the stable prefix is unchanged when no compaction occurs` |
| Provider input budget | enforced | enforced | **EXECUTED** — the whole `src/extensions/context/` suite (496 passed / 2 skipped) includes the budget-projection tests |
| Session isolation | preserved | preserved | **VERIFIED BY DIFF** — no session/persistence code modified; `evidence-continuity.ts` untouched |
| Source revisions | stale adjudications cannot override current evidence | no carried adjudication exists | **EXECUTED** — discriminator CONTROL 5 (`stale_source_revision`); the probe measures freshness as UNRESOLVED rather than assumed |
| Disabled diagnostics | no runtime-semantic delta | no delta | **VERIFIED BY DIFF** — no diagnostic code modified |
| React functional updaters | no diagnostic side effects | no change | **VERIFIED BY DIFF** — no React code touched |

---

## 2. First and subsequent compaction

The ACT requires that both a first and a subsequent compaction be tested.

**First compaction:** the RED suite exercises exactly this — a single
compaction over a canonical history that contains the adjudication-bearing
turn. It is RED, correctly.

**Subsequent compaction:** the requirement is that a previously carried
qualified adjudication does not accumulate duplicate entries, change
authority, or survive a contradictory source revision as if still current.

**There is no carried adjudication**, so the property holds trivially and
verifiably: no mechanism can duplicate, escalate, or resurrect an
adjudication that was never carried. The **contract** that a successor must
satisfy is recorded in `04-minimum-implementation-contract.md`
(`PERSISTENCE_SEMANTICS`, `REVISION_FRESHNESS_RULE`, `TOKEN_BUDGET`).

**This is stated as a limitation, not as a passing behavioural claim.**

---

## 3. Prompt-cache / stable-prefix inference

The ACT warns:

> "Do not infer prompt-cache hits from stable message hashes alone."

**No such inference is made.** This ACT changed no message construction, so
it cannot have changed prompt-cache behaviour in either direction. The
statement "the stable prefix is unchanged" below means only that the
production projection emits no `dropped_message` action for a
within-budget request — which is what the discriminator asserts.

**Label:** `REAL_PRODUCTION_SEAM` (projection behaviour) /
`NOT_EXECUTED` (prompt-cache hit rate).

---

## 4. The production-diff conservation proof

```bash
git diff --stat a493eff078ec5c8f2b6c874ad8f4a85009d1b64f..HEAD -- \
  ':(exclude).factory/**' ':(exclude)sdk/packages/core/src/**/*.test.ts'
# -> (empty)
```

Every file this ACT touched under `sdk/packages/core/src/` matches
`*.test.ts`. There is **no shipped production change**, therefore no
dependency change, no schema change, no new public API, and no test-only
override reachable in production.

---

## 5. Session isolation

No cross-session state was introduced. The probe is entirely in-memory and
lives inside a single test file; it reads a fixture, not a session store. The
historical snapshot used for the measurements lives **outside** the
repository at `/tmp/cline-recon-rX/` and is **not committed**.

**Label:** `STRUCTURAL` (verified by diff) / `REAL` (snapshot is outside Git
and was read-only).
