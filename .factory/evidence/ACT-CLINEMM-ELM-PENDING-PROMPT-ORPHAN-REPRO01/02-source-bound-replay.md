# 02 — Source-Bound Incident Replay

ACT: `ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01`
Labels: `REAL` (exported records), `REAL_PRODUCTION_SEAM` (real adapter + real kernel), `SOURCE_BOUND_PARTIAL`

---

## C2.1 Evidence source

The operator-exported BCB causal flight recorder bundle of 2026-11-16:

```
/Volumes/UserData/Users/chistyakov/Downloads/completion-incident-2026-11-16T15-52-00-750Z/
```

Original bundle SHA-256 (preserved, unmodified, NOT committed):

| File | SHA-256 | Manifest recordCount |
|---|---|---|
| `continuation-events.jsonl` | `becbfacb9da4f084dcc15c297d30c3178a617157bb172108b8af1d12b906fbb1` | 332 |
| `completion-authority.jsonl` | `06c09ad6b705e71f0d4b9919a10bbd0974fcc52875fa057ec08d37dfe46e02bb` | 31 |
| `barrier-timeline.jsonl` | `c683e8494a0edbfded7af8df3c259bdb5c29a6a1928082a90fc07ac67e3e3bb1` | 1482 |
| `manifest.json` | `b11a53b259a7ce0a9a6d1d4c0afed9af0db4e6c5a78e9f535c90373590e11bcc` | — |

The original bundle is **preserved outside the committed repository**. Only the
sanitized, source-bound minimum is committed.

## C2.2 Input reduction

Filter: `sessionId == "1794840293250_5ugld"`. Order preserved by the recorded
`seq`. **No field was created, no identity inferred, no run ID fabricated.**

Committed fixtures (independent hash of the reduced input):

| Fixture | Records | SHA-256 | Bytes |
|---|---|---|---|
| `fixtures/continuation-events.session.jsonl` | 64 | `32a33731f3e7539b086617c8e48729e8114fa898d06343028c2bc40bed9d03eb` | 11239 |
| `fixtures/completion-authority.session.jsonl` | 8 | `a4762d4d775c38b5f6c68254ae81cfb60c572a8d53c9965c55adc76ba3fa4d0d` | 4184 |
| `fixtures/barrier-timeline.session.jsonl` | 29 | `a433a979fa100aec0c5bcf9a37925246affb7c53c00c92fcebe5158975270e71` | 18191 |

Sanitization: one non-CCARD row (the BCB `observation-unavailable` capture,
which carries a `liveToolsValue` array) was excluded from the CCARD fixture
because it is not an Elm-authority input. All records retain `seq`, `at`,
`sessionId`, `stage`, `origin`, and every identity field the original carried
(`taskId`, `jobId`, `ownerId`, `promptId`, `runId`, `submitId`).

**Preserved identities**

| Identity | Value | Provenance |
|---|---|---|
| Session / task | `1794840293250_5ugld` | `REAL` |
| Prompt P1 | `pending_1794841243556_-tSbr` | `REAL` (seq 46/47/48) |
| Prompt P2 | `pending_1794841410962_5gjid` | `REAL` (seq 54/56/57) |
| Run | `run_rCw8nsup` | `REAL` (seq 3 `run_turn_started`; all five `agent_turn_done`) |
| Epoch | 3 (seq 6252..6266), 4 (seq 6270, 6272) | `REAL` |

## C2.3 The replay path (production seams, no substitutes)

```
record
  -> AUTHORITY_STAGES filter          completion-authority-elm-authority-runtime.ts:285
  -> adaptRecord()                    completion-authority-elm-replay.ts:93   (REAL adapter)
  -> enqueueElmAuthorityRecord()      completion-authority-elm-authority-runtime.ts:276
  -> flushElmAuthorityForSession()    completion-authority-elm-authority-runtime.ts:306
  -> REAL compiled Elm kernel         elm/completion-authority/vendor/completion-authority.js
  -> decodeElmDecision()              completion-authority-elm-authority-runtime.ts:503
```

* The **real** `adaptRecord` is imported and called — **not** mocked, **not** replaced.
* The **real** `loadKernel()` is used — the SAME artifact the extension ships.
* The **real** `enqueueElmAuthorityRecord` / `flushElmAuthorityForSession` are used,
  including the real `AUTHORITY_STAGES` membership test.
* **No synthetic Elm `Model` is constructed anywhere.** Every Elm state in this
  ACT is produced by feeding real Msg values into the real kernel.
* `resetElmAuthorityForTests()` is used to isolate the global authority state
  between arms — it is the production module's own test-only reset, and it
  mutates nothing outside the isolated test instance.

Witness: `apps/vscode/src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts`

## C2.4 Evidence completeness — the decisive truncation analysis

The manifest reports `evidenceLoss: true`,
`capsuleDroppedRecords: 4937`, `checkpointTruncatedCapsules: 43`,
`checkpointTruncatedRecords: 6565`. **Absence from the exported record is
normally not proof that the event never occurred.**

**But for the incident session, the CCARD sequence is CONTIGUOUS:**

```
incident session CCARD seqs: 1,2,3,4,...,64   (no gaps)
```

A cross-session scan of the same file over the same `seq` window shows that
the recorder retained every seq from 40 to 64 — all belonging to the incident
session. There is **no dropped record inside the incident session's CCARD
sequence**.

Therefore, for this session:

| Possibility | Status |
|---|---|
| 1. Event never emitted | **SUPPORTED** (contiguous sequence + producer reachability proof in C4) |
| 2. Event emitted but not retained | **RULED OUT for the incident session's CCARD window** (contiguous seq 1..64) |
| 3. Event emitted without required identity | **RULED OUT** — the producer supplies both identities atomically (`canonical-event-subscription.ts:114-120`); it cannot emit `continuation_started` with only one |
| 4. Event accepted by recorder but rejected by adapter | **N/A** — no such record exists to reject |
| 5. Event delivered to Elm but not consumed as expected | **RULED OUT** — no `continuation_started` reached Elm at all |

### Evidence-completeness verdict

**`SOURCE_BOUND_PARTIAL`** — with the following precise scope:

* The bundle is globally truncated (evidence loss), so this replay is **not**
  an exact reconstruction of the historical Elm state.
* **However**, for the transitions that the causal claim depends on —
  the enqueue/dequeue/schedule of P1 and P2, the `run_turn_started`, the five
  `agent_turn_done`, and the absence of any `continuation_started` — the
  retained sequence is **contiguous and sufficient**.
* The replay therefore **demonstrates** the behaviour, and the causal claim is
  additionally grounded in an *independent* production-seam reachability proof
  (C4) that does not depend on the truncated export at all.

This ACT does **not** promote the source-bound replay to an exact historical
state reconstruction.

## C2.5 The other adapter gap observed (NOT causal for this incident)

The 44 `terminal_committed` records are rejected by the REAL adapter with
`INSUFFICIENT_IDENTITY` because the production capture does not carry
`terminalKind` (`command-job-manager.ts:2711`), which
`adaptRecord` (`completion-authority-elm-replay.ts:139-145`) requires.

This is a **real, separate** adapter/capture gap, already documented in the
production source. It is **not** the cause of this incident: the recorded
production decision was `elmReason: "pending_prompt"`, not a terminal hold,
and the recorded C10 conservation result was `unconsumedTerminalCount = 0`.

The replay reproduces this gap faithfully (44 `INSUFFICIENT_IDENTITY`), and the
A4 adversarial guards supply a fully-identified terminal **through the real
adapter** to prove the terminal hold path still works.
