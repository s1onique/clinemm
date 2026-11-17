# Source map — ACT-CLINEMM-CANONICAL-EVIDENCE-CONTINUITY-LIVE-01

**Repository:** `s1onique/clinemm` · **Branch:** `main` · **ENTRY_HEAD:** `8c3351e56d949b514f60bbfde0735e756ed082ca`

**Scope note.** This map describes the ClineMM repository as it exists at ENTRY_HEAD and
identifies the exact production code that owns canonical persistence, working-context
projection, compaction-state persistence, prefix-hash validation, resume/reconstitution and
evidence-reference identity. It is derived from the **implementation**, not from upstream
architecture documentation.

**ENTRY_HEAD note.** The ACT brief named `d68def3ae2ddcb635bfbb34955f2cd561205d9c0` as the
expected entry. The actual HEAD was **discovered** with `git rev-parse HEAD` and is
`8c3351e56d949b514f60bbfde0735e756ed082ca`. The named commit is the **parent** of the actual
HEAD; the one intervening commit (`8c3351e56`, ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01) adds
exactly one rule to the macOS Seatbelt profile and touches **no** compaction,
session-persistence or canonical-message code. The adjudicated session's artifacts are
unaffected by it. The working tree was clean (0 porcelain lines) at entry.

---

## 1. The production seam, in execution order

| # | Concern | File | What it owns |
|---|---|---|---|
| 1 | **Canonical message persistence** | `sdk/packages/core/src/session/stores/session-manifest-store.ts:231-266` (`persistSessionMessages`) | Writes the whole canonical message array to `<sessionId>.messages.json` via `buildMessagesFilePayload` + `writeFileSync`. |
| 2 | **Persisted-message normalization** | `sdk/packages/core/src/services/session-data.ts:114-139` (`normalizeStoredMessagesForPersistence`, `withLatestAssistantTurnMetadata`) | Per-message metadata normalization; a `map`, never a filter or a truncate. |
| 3 | **Working-context projection / compaction** | `sdk/packages/core/src/extensions/context/compaction.ts` (`createContextCompactionPrepareTurn`, `runAgenticCompaction` / `runBasicCompaction`) | Decides, executes and publishes the compaction; produces the compacted message list. |
| 4 | **Compaction-state persistence** | `sdk/packages/core/src/session/models/session-compaction.ts:140-166` (`createSessionCompactionState`) | Builds the persisted sidecar: count, boundary key, **prefix hash**, compacted messages. |
| 5 | **Canonical-prefix hash validation + projection** | `sdk/packages/core/src/session/models/session-compaction.ts:168-198` (`projectSessionCompactionState`) | Recomputes the prefix hash over the canonical prefix; **returns `undefined` (rejects)** on mismatch; otherwise returns `[...sidecar messages, ...canonical tail]`. |
| 6 | **Session resume / reconstitution** | `sdk/packages/core/src/runtime/host/local-runtime-host.ts:813-840` (resume loads manifest + messages + compaction state), `:1024-1055` (`initialCompactionState`, `createCompactionStateAwarePrepareTurn`), `:1331-1332` (`persistedMessages`, `compactionState`) | Rebuilds the working context from the persisted sidecar **plus the canonical tail**, without rewriting canonical history. |
| 7 | **Evidence-reference identity** | `sdk/packages/core/src/extensions/context/compaction.ts:1865-1936` (`collectToolCallReferenceIds`, `countRetainedReferenceIds`, `countReplacementReferenceIds`) | Defines an "evidence reference" as a tool RESULT's `tool_use_id`; retention is an **identity** question, not a cardinality question. |
| 8 | **Verified-evidence carry-forward** | `sdk/packages/core/src/extensions/context/evidence-continuity.ts` (`applyVerifiedEvidenceToCompactedMessages`, `EVIDENCE_SECTION_HEADING` at `:211-212`) | Derives the carried "## Verified tool outcomes (canonical record)" section from the **canonical** tool-call/tool-result pairs, by tool-call id. |

---

## 2. What "append-only" means in this implementation

**The canonical transcript is append-only in production, and compaction cannot replace,
remove or mutate a previously persisted canonical record.**

The evidence is structural, not merely observational:

1. **The compaction result is a per-request projection, never a history mutation.**
   `sdk/packages/agents/src/agent-runtime.ts:4875-4883` (`prepareTurnForModelRequest`):

   ```ts
   let next = request;
   if (result.messages) {
       const preparedMessages = cloneMessages(result.messages);
       next = { ...next, messages: cloneMessages(preparedMessages) };
   }
   ```

   A **new** request object is returned. `this.state.messages` — the agent's canonical
   history — is **not** assigned, spliced or truncated. The only write to
   `this.state.messages` anywhere in the runtime is the hook-context insertion at
   `agent-runtime.ts:2245` (`this.state.messages.splice(-1, 0, hookContextMessage)`),
   which is an **insertion**, not a removal.

2. **There is no truncation of the canonical list on any persistence path.**
   `messages.slice(...)`, `messages.splice(...)` and `messages.length = ...` do **not**
   occur on the canonical transcript in `agent-runtime.ts` or `local-runtime-host.ts`.
   `persistSessionMessages` receives the full agent message list and writes it whole.

3. **The compaction sidecar is a separate file.** The canonical transcript
   (`<sessionId>.messages.json`) and the compaction state
   (`<sessionId>.compaction.json`) are distinct artifacts with distinct schemas and
   distinct hashes. Writing the sidecar cannot rewrite the transcript.

4. **The sidecar binds to its prefix cryptographically, not by convention.**
   `source_prefix_hash` is a SHA-256 over the canonical prefix's role / content / agent /
   sessionId / metadata / modelInfo / metrics, with a `cline-session-compaction-source-v2`
   domain-separation prefix and the count in the hash input
   (`session-compaction.ts:123-138`). `projectSessionCompactionState` recomputes it and
   **rejects** (`undefined`) when it does not match.


---

## 3. The rejection contract (production behaviour, not a proposal)

`projectSessionCompactionState` (`session-compaction.ts:168-198`) returns `undefined` — and
the host therefore **refuses to project and refuses to persist** — when:

| Condition | Production behaviour |
|---|---|
| `state.source_message_count > sourceMessages.length` | `undefined` (rejected) |
| Stored `source_prefix_hash` present but the recomputed hash differs | `undefined` (rejected) |
| Stored `source_prefix_hash` present and matches | projected |
| No stored `source_prefix_hash`, but the legacy `source_last_message_key` matches the boundary message | projected (legacy path) |
| Neither hash nor boundary key resolves | `undefined` (rejected) |

The host applies the same rejection before persisting:
`LocalRuntimeHost.canPersistCompactionState` (`local-runtime-host.ts:2159-2186`) returns
`false` when `projectSessionCompactionState(...) === undefined`, so an unprojectable state is
**never written**. The stale-write guard (`local-runtime-host.ts:2204-2233`) additionally
prevents an older write from clobbering a newer one.

---

## 4. Existing tests and diagnostics inventory (before this ACT)

No new permanent production test was added by this ACT. The seam was already covered.

| Test file | What it already asserts |
|---|---|
| `sdk/packages/core/src/session/models/session-compaction.test.ts` (12 tests) | Boundary-key delimiter rejection; projection survives regenerated `id`/`ts`; **rejects when the canonical prefix was edited before the boundary**; projects on an exact prefix match; projects after a JSON reload; **rejects when canonical message metadata changed**; projects display-normalized resumed user input; rejects anchor-free sidecars; projects legacy sidecars; rejects malformed timestamps; display-only history exclusion from boundary and tail. |
| `sdk/packages/core/src/extensions/context/evidence-continuity.test.ts` (62 tests) | The verified-outcome carry-forward: authority, the strict success rule, conflicting-status fail-closed, ambiguous-call-id fail-closed, credential safety (structured allowlisted evidence, not raw output). |
| `sdk/packages/core/src/extensions/context/task-contract-conservation.test.ts` (29 tests) | The parallel task-contract carry-forward, applied over the same canonical authority. |
| `sdk/packages/core/src/extensions/context/compaction.test.ts` (112) | General compaction behaviour. |
| `sdk/packages/core/src/extensions/context/compaction.roundc-fidelity-recon02.test.ts` (20, 1 skipped) | Round C compaction fidelity against the real seam, including the sidecar shape (`source_prefix_hash`, `source_last_message_key`). |
| `sdk/packages/core/src/extensions/context/compaction.decision-capture.conservation.test.ts` (2) | Tracing OFF vs ON produces identical canonical input, prepared messages and provider dispatch. |
| `sdk/packages/core/src/extensions/context/compaction.tool-result-shape-red.test.ts` (15) | Tool-result shape preservation. |
| `sdk/packages/core/src/extensions/context/compaction.working-context-authority-publish.test.ts` (3) | Working-context estimate authority publication. |
| `sdk/packages/core/src/extensions/context/task-contract-conservation.historical.test.ts` (3) | Historical-session contract conservation. |
| `sdk/packages/core/src/extensions/context/task-contract-budget-authority.test.ts` (9) | Contract budget authority. |
| `sdk/packages/core/src/observability/latency/latency-boundaries.integration.test.ts` (15) | The exported-trace privacy boundary, including `compactionEvidenceRefsAfter`. |
| `sdk/packages/core/src/observability/latency/latency-sink.compaction-token-evidence-capture01.test.ts` (5) | The latency sink's compaction token-evidence capture. |

**Diagnostics inventory.** `LATENCY_METADATA_ALLOWLIST`
(`sdk/packages/core/src/observability/latency/latency-trace.ts:191+`) is a strict allowlist: a

---

## 5. Live session execution order (abridged, from the preserved trace)

```
decision #12  req_B3-Yjnop  mono 518461.8  31 messages  proj 103,436 < 103,680  → NOT TRIGGERED
              provider reported  83,984 tokens
              ────────────────────────────────────────────────────────────
decision #13  req_wdW3TYdm  mono 550327.2  34 messages  proj 108,280 ≥ 103,680  → TRIGGERED
              compaction START   mono 550327.2
              compaction END     mono 614891.7   duration 64,564.481 ms
                                 34 → 6 messages, 20 → 3 evidence refs (17 dropped, 0 replaced)
              request_preparation  mono 615004.3  6 messages   ← AFTER the compaction ended
              provider submitted   mono 615004.7
              provider reported    15,607 tokens   ← the SUBMITTED post-compaction request
```

The persisted sidecar `updated_at` is `2026-11-17T05:26:46.573Z` (the compaction completion);
the canonical transcript's `updated_at` is `2026-11-17T05:31:52.789Z`, i.e. the canonical
history **kept growing after** the compaction was persisted. The canonical tail (12 messages,
`ts` 1794893234982 → 1794893512781) is strictly later than the boundary prefix
(`ts` 1794892591844 → 1794893141999).

---

## 6. The "evidence reference" definition, and why the 17 are not a canonical loss

An **evidence reference** is a tool RESULT, identified by its `tool_use_id`
(`compaction.ts:1865-1901`). The trace's `20 → 3` therefore counts **tool-result identities
present in the model-facing working context before and after** the compaction.

The compaction replaces the model-facing working context with a summary. It does **not**
delete the underlying canonical tool results. The production carry-forward
(`evidence-continuity.ts`) names, in the summary's
`## Verified tool outcomes (canonical record)` section, the subset whose outcome the
canonical record establishes as a verified success — by tool-call id.

So the 17 "dropped" references split into two disjoint classes, and this ACT measures both
at the **identity** level against the live canonical transcript:

1. **carried** — the identity is named in the summary's verified-outcome section;
2. **not carried** — the identity is absent from the summary, and its canonical record is
   nevertheless still present and intact in canonical storage.

Class 2 is a **working-context omission**, not a canonical loss. Its conservation is
established here by correlating each identity against the canonical transcript — never by
aggregate counts alone.

field not on the list is **dropped, not recorded**. The compaction boundary publishes
**counts only** — `compactionEvidenceRefsBefore/After/Retained/Dropped/Replaced` — and the
module comment at `compaction.ts:1191-1192` states: *"Only COUNTS are reported. No reference,
no content and no summary text is recorded."*
