# EPIC-CLOSED-FOUNDATION

> Historical record of substrate-level closures that pre-date the current frontier. See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: CLOSED (historical)
- Priority: P3 / reference-only
- Current frontier: n/a
- Blocked by: n/a

## Contract / durable conclusions

The substrate foundations listed here are still relied on by the active frontier. Any change to them must come with a fresh ACT and a regression test.

## ACT ledger

| ACT / Source ID | Verdict | Head | Purpose |
|---|---|---|---|
| `ELM-02F` + `C2.4-*` + `C25-*` | CLOSED | — | Elm/state architecture groundwork |
| `E7-LOCAL-BACKEND-ACTIVATION01` + `E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01` | CLOSED | — | E7 local advisory activation |
| `E7.1` + `TRACE01` | CLOSED | — | Thinking canonical-state authority; static-presentation residue now also CLOSED_NOT_REPRODUCED under `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01` (see `docs/architecture/elm/task-state-e71-static-thinking-presentation-persistence01-reclosure.md`) |
| `REACT-UPDATER-PURITY-REPAIR01` | CLOSED | — | React updater purity repair; invariant: no diagnostic/external side effects inside functional state updaters |
| `RED-FIX01` / `W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01` / `LIVE-SHAPE-REPRODUCTION01` | CLOSED_LIVE | `5637d965dcaf95bd82708b21ecf233d9672cde59` | W1/W2 epoch-domain repair; live verdict PASS_LIVE_EPOCH_REPAIR |
| `ACT-CLINEMM-PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE01` (LCD01 + C2-CORRECTION02-FIXUP01..04) | CLOSED | `51f2f6a9c48bd880186928b18a2a9e3817613d43` | Incident-diagnostic retirement |
| `ACT-CLINEMM-PTAD-ENV-OPTIN01` | CLOSED | impl: `02a35fabf5f38b963ded7dfddf607789fecbacd3` (tree `1086bc48efe67003539771b4c9c19e426ab93b86`); verdict: `PASS_PTAD_ENV_OPTIN_V1` | PTAD `CLINEMM_PTAD` env opt-in (additive with persisted workspace toggle; default off; no schema/wire change; no forced-disable). Eliminates the "rare evidence lost because I forgot the knob" failure mode. 24 new tests (R9-A 9, R9-B 8, R9-C 2, W14 5); 111/111 PTAD suite green; production semantic delta = 0 when env is unset. See `.factory/acts/ACT-CLINEMM-PTAD-ENV-OPTIN01.md` §9 for gate summary. |
| `DOGFOOD-VSIX-QUALIFICATION01` | CLOSED | — | Dogfood VSIX qualification |
| `ACT-CLINEMM-FACTORY-GLOBAL-EPIC-BOARD-WAVE01` | CLOSED | `1e6430bc15f00d08f66dc905c41edbd3f74045db` | Factory global epic board substrate |

## Open work

None. (See `task-presentation.md` and `webview-seam-aop.md` for in-flight work that builds on this substrate.)

## Deferred work

None.

## Historical detail

The text below is migrated verbatim from the prior single-file `.factory/epic-board.md` (L319-381 of the pre-sharding board) so the durable conclusions remain anchored to their source lines. **Do not rewrite history here unless the underlying ACT itself is being amended.**

```text
SOURCE: .factory/epic-board.md L319-381 (pre-sharding).

### 1. Elm/state architecture groundwork

- status: CLOSED
- note: canonical state-machine / runtime groundwork exists (e.g. `ELM-02F`, `C2.4-*`, `C25-*`)
- evidence: see Canonical task index alias rows

### 2. E7 Local advisory activation

- status: CLOSED
- source IDs: `E7-LOCAL-BACKEND-ACTIVATION01` + `E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01`
- note: Local path has canonical advisory activation foundation

### 3. Thinking canonical-state authority

- status: CLOSED
- note: canonical authority exists; static presentation residue also CLOSED_NOT_REPRODUCED under `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01` (see `docs/architecture/elm/task-state-e71-static-thinking-presentation-persistence01-reclosure.md` for the durable closure claim and `docs/architecture/elm/task-state-e71-static-thinking-presentation-persistence01-evidence.md` for the original evidence)
- source IDs: `E7.1`, `TRACE01`, `STATIC-THINKING-PRESENTATION-PERSISTENCE01`

### 4. React updater purity repair

- status: CLOSED
- source ID: `REACT-UPDATER-PURITY-REPAIR01`
- invariant: no diagnostic/external side effects inside functional state updaters

### 5. W1/W2 epoch-domain repair

- status: CLOSED_LIVE
- source IDs: `RED-FIX01` / `W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01` / `LIVE-SHAPE-REPRODUCTION01`
- qualified source: `5637d965dcaf95bd82708b21ecf233d9672cde59`
- live verdict: PASS_LIVE_EPOCH_REPAIR
- proven:
  - W1 `stateVersion > 0`
  - W1 `epoch` present
  - shared W1/W2 sequence authority
  - streaming raw == committed
  - awaiting-followup raw == committed

### 6. Incident-diagnostic retirement

- ACT: `ACT-CLINEMM-PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE01`
- source ID: `LIVE-CONTEXT-DIMENSIONS01` (LCD01) + `C2-CORRECTION02-FIXUP01..04`
- status: CLOSED
- final commit: `51f2f6a9c48bd880186928b18a2a9e3817613d43`
- result:
  - LCD01 retired
  - PTAD retained (default-off, opt-in via workspace toggle)
  - production correctness invariants preserved

### 7. Dogfood VSIX qualification

- source ID: `DOGFOOD-VSIX-QUALIFICATION01`
- status: CLOSED

### 8. Factory global epic board substrate

- ACT: `ACT-CLINEMM-FACTORY-GLOBAL-EPIC-BOARD-WAVE01`
- status: CLOSED
- final commit: `1e6430bc15f00d08f66dc905c41edbd3f74045db`
```
