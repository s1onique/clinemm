# 01 — Trace Inventory

CORRECTION01: R2 (`01a-live-ccard.jsonl`) reclassified from REAL to
SYNTHETIC_REAL. The artifact carries operator-synthetic clock
timestamps (`1700000000000`-style) and explicit synthetic labels,
which a predecessor ACT promoted to "live evidence" based on the
identity fields being real (sessionId=`session-operator`,
taskId=`task-operator`, jobId=`cmd_operator_test`,
promptId=`pp-operator-1`). Per the evidence-rule, synthetic
timestamps cannot promote a fixture to REAL.

| Source | Identity class | Files | Evidence class |
|--------|---------------|-------|-----------------|
| **R1** — LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01 | REAL | `01a-ccard.LIVE_RAW.jsonl` (sha=d7302ae9…096a21d48ff491661e5f2652e831b62928fc50db2fb4837dbd24f1) | REAL |
| **R2** — BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01 | SYNTHETIC_REAL | `01a-live-ccard.jsonl` (sha=a61d35bc…0711cc4a02ab0c4976321ab038974e7aeed3859090500cf6f534) | SYNTHETIC_REAL (CORRECTION01) |
| **R3** — continuation subsequence of R1 | REAL | (reuse R1) | REAL |
| **R4** — POST-CONTINUATION-RUN-STALL02 | REAL | `continuation-cardinality-authority.jsonl` (sha=2fab1cc4…0186d0dbff48f603bd445adb1a1fc1066b9e0ddd), `background-job-liveness-authority.jsonl` (sha=1ec462d9…393c20541) | REAL |

## REAL events (CORRECTION01)

| Source | Event count |
|--------|-------------|
| R1 LIVE_RAW | 13 |
| R4 STALL02 continuation-cardinality-authority | 158 |
| **REAL_EVENTS_TOTAL** | **171** |

## SYNTHETIC_REAL events (R2 only, retained for shape coverage)

| Source | Event count |
|--------|-------------|
| R2 live-ccard | 12 |

## Per-source role

- **R1 (REAL, control):** canonical happy completion. Two `run_turn_started` /
  `agent_turn_done` pairs (one explicit_user, one pending_prompt_drain
  continuation) followed by `submit_and_exit_seen` and
  `task_completion_committed`. Tests kernel happy-path.
- **R2 (SYNTHETIC_REAL, held-terminal):** `terminal_committed →
  notify_consume_enter → wake_created → … → task_completion_committed`.
  Identity is real; timestamps are synthetic. Provides shape coverage
  for the terminal observation lifecycle. Downstream analyses
  surface this as `SYNTHETIC_REAL` everywhere.
- **R3 (REAL, continuation):** the second `run_turn_started` /
  `agent_turn_done` pair inside R1 is the continuation subsequence.
- **R4 (REAL, decisive stall):** the 158-event live stall trace from
  session `1790633775136_8mrnl` on profile `.vscodium-clinemm`,
  version `4.1.16-a0d496408`. Cardinality matches the predecessor
  ACT's published stall signature (terminal_committed=147,
  run_turn_started=3, agent_turn_done=2, submit_and_exit_seen=2,
  task_completion_committed=1, pending_prompt_enqueued=1,
  pending_prompt_dequeued=1, continuation_scheduled=1).

## Source preservation

```text
$ shasum -a 256 continuation-cardinality-authority.jsonl \
                background-job-liveness-authority.jsonl \
                01a-ccard.LIVE_RAW.jsonl \
                01a-live-ccard.jsonl
2fab1cc4c2f88162cc9e4ccd0186d0dbff48f603bd445adb1a1fc1066b9e0ddd  continuation-cardinality-authority.jsonl
1ec462d986f93a73dafa6cae4cfdab3dcb2d488c29945e8a1ca81ab963c20541  background-job-liveness-authority.jsonl
d7302ae909596a21d48ff491661e5f2652e831b62928fc50db2fb4837dbd24f1  01a-ccard.LIVE_RAW.jsonl
a61d35bc47be0711cc4a02ab0c4976321ab038974e7aeed3859090500cf6f534  01a-live-ccard.jsonl
```

The two REAL-source sha256s (continuation-cardinality-authority and
01a-ccard.LIVE_RAW) match the predecessor evidence. The R2
synthetic_real sha is documented here for traceability but is not
promoted to REAL.
