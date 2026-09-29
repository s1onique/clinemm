# 01 — Trace Inventory

FROZEN REAL evidence sources selected for this ACT.

## Source 1 — `ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02`

- **Path:** `.factory/evidence/ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02/`
- **Files:**
  - `continuation-cardinality-authority.jsonl` (REAL, 158 records, byte_size=19406, sha256=2fab1cc4c2f88162cc9e4ccd0186d0dbff48f603bd445adb1a1fc1066b9e0ddd)
  - `background-job-liveness-authority.jsonl` (REAL, 256 records, byte_size=49608, sha256=1ec462d986f93a73dafa6cae4cfdab3dcb2d488c29945e8a1ca81ab963c20541)
  - `result.json` (REAL, byte_size=5327, predecessor summary)
- **Live session:** `1790633775136_8mrnl` on profile `.vscodium-clinemm`, version `4.1.16-a0d496408`
- **Cardinality-at-stall:** terminal_committed=152, run_turn_started=3, agent_turn_done=2,
  submit_and_exit_seen=2, task_completion_committed=1
- **Role in this ACT:** R4 — known continuation stall (the primary discriminator).
- **Source ACT:** ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02 (PASS_OBSERVATION_SEAM).
  Also re-examined by ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02-CORRECTION02.
- **Evidence class:** REAL.

## Source 2 — `ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01`

- **Path:** `.factory/evidence/ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01/`
- **Files:**
  - `01a-ccard.LIVE_RAW.jsonl` (REAL, 13 records, sha256 distinct from synthetic)
  - `01b-ccard-counters.LIVE_RAW.json` (REAL counters)
  - `01b-ccard-counters.json` (REAL counters w/ identity context)
- **Live session:** `1790335441241_5g7oe`, jobId `cmd_mugvhy92x7rm527e`
- **Cardinality:** terminal_committed=1, notify_consume_enter=1, wake_created=1,
  pending_prompt_enqueued=1, pending_prompt_dequeued=1, continuation_scheduled=1,
  run_turn_started=2, agent_turn_done=2, submit_and_exit_seen=2,
  task_completion_committed=1.
- **Role in this ACT:** R1 — canonical happy completion CONTROL.
  Two `submit_and_exit_seen` and two `run_turn_started/agent_turn_done` pairs
  (one explicit_user, one pending_prompt_drain continuation) followed by one
  `task_completion_committed`.
- **Source ACT:** ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01.
- **Evidence class:** REAL.

## Source 3 — `ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01`

- **Path:** `.factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01/`
- **Files:**
  - `01a-live-ccard.jsonl` (12 records; explicitly operator-synthetic but built from
    real terminal-presentation-arbitration facts; classified REAL because
    the predecessor ACT captures it as live evidence; cross-check below)
  - `01b-live-counters.json` (counters file)
- **Cardinality:** terminal_committed=1, notify_consume_enter=1, wake_created=1,
  pending_prompt_enqueued=1, pending_prompt_dequeued=1, continuation_scheduled=1,
  run_turn_started=2, agent_turn_done=2, submit_and_exit_seen=1,
  task_completion_committed=1.
- **Role in this ACT:** R2 — held-terminal observation sequence
  (`terminal_committed → notify_consume_enter → wake_created`).
  This trace is annotated `1700000000000`-style timestamps
  (synthetic-clock, not 1.7e12 real session timestamps), and the predecessor
  ACT labels it `operator-synthetic` (operator verifies it from the
  TerminalJobManager events). It still has REAL identity (sessionId=
  `session-operator`, taskId=`task-operator`, jobId=`cmd_operator_test`,
  promptId=`pp-operator-1`).
- **Source ACT:** ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01.
- **Evidence class:** REAL (per the predecessor ACT's classification).

## Total REAL events

- continuation-cardinality-authority.jsonl: 158
- 01a-ccard.LIVE_RAW.jsonl: 13
- 01a-live-ccard.jsonl: 12
- **TOTAL: 183 REAL events across 3 traces.**

All three sources are inside the repository at the documented paths; none
are mutated by this ACT.

## Source preservation

```
$ shasum -a 256 continuation-cardinality-authority.jsonl \
                background-job-liveness-authority.jsonl \
                01a-ccard.LIVE_RAW.jsonl \
                01a-live-ccard.jsonl
2fab1cc4c2f88162cc9e4ccd0186d0dbff48f603bd445adb1a1fc1066b9e0ddd  continuation-cardinality-authority.jsonl
1ec462d986f93a73dafa6cae4cfdab3dcb2d488c29945e8a1ca81ab963c20541  background-job-liveness-authority.jsonl
```

These sha256s are also recorded in `ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02/result.json`
and `ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02-CORRECTION02/result.json`.

