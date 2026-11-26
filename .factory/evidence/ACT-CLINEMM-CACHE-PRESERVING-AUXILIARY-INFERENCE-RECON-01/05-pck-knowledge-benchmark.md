# ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01 — 05 PCK knowledge benchmark (Round C′)

Frozen sources (operator-local, NOT committed):

* Session transcript: `…/.vscodium-roz/cline-data/sessions/1795665267287_u5y52/1795665267287_u5y52.messages.json`
* Installed compaction state: `…/1795665267287_u5y52.compaction.json` (90 source messages, `source_prefix_hash sha256:b1bba2c0…`)

The benchmark uses the EXISTING PCK representation (the closed record shape: kind / assurance / status /
atom / argument / qualificationClasses / evidenceRefs). It does not invent a replacement schema.

## Benchmark matrix

| # | Historical fact (must be RETAINED) | Counterfact (was LOST at Round C′) | Unresolved question (must stay unresolved) | Source |
|---|---|---|---|---|
| K1 | OTP dispatch has a **synchronous carrier API** path with hardcoded connection/socket timeouts | The same audit history contains a `NotificationServiceMessageSenderServiceProvider` with a **configurable** `connectTimeoutMillis` / `socketTimeoutMillis`, a `CircuitBreaker` field, **asynchronous Kafka-inbox dispatch** and a **REST fallback** ("notification-service Kafka send failed (…), REST fallback"), with a documented breaker that opens after N consecutive failures | Which path is the EFFECTIVE production path, and whether a sender-level breaker is genuinely absent on the carrier path, was never established | `1795665267287_u5y52.messages.json` (provider sources) vs the installed compaction summary's R2 line ("hardcoded timeouts and lack circuit breakers/fallbacks … CONFIRMED") |
| K2 | Documented PostgreSQL connection budget = **400**; pool maximum = **80 per pod** | The Helm values carry **`replicas: 1`**, so the configured replica count is 1 and the current demand is ≈80, not 880. The "11 pods → 880" figure is a **hypothetical** scaling scenario, not the current configuration | The actual production replica count and the enforced pool budget were never verified | the compaction summary states "11 pods = 880 connections, exceeding documented 400 budget … CONDITIONAL"; the transcript records `replicas: 1` |
| K3 | A **historical** PostgreSQL diff identifies **six** production indexes absent from the Liquibase changelogs; Liquibase uses `MARK_RAN` (e.g. `token-code-6.5`, `onFail="MARK_RAN"`, because the index was created by hand in production) | The compaction summary stated "Diff file confirms 6 missing indexes" — dropping that the evidence is a HISTORICAL diff, that some indexes were created manually, and that Round B retracted an earlier assertion about `KC_LIQUIBASE_DATABASE_ON_STATE_CONFLICT` | Whether the current production database actually lacks those indexes (missing migration coverage) versus historical drift is unresolved | the Round B retraction text and the `MARK_RAN` changeset are present in the transcript and absent from the installed summary |
| K4 | Every accepted record must cite an observed canonical reference (`id:<message-id>`) | The installed summary cites "R1…R10" without canonical references — an unattributed rendering | Whether the PCK's own closed-vocabulary atoms can express these findings at all is NOT_EXECUTED | `publication-gate.ts` (`REFERENCE_NOT_CANONICAL`) |
| K5 | The original user task, the runtime completion obligation, the runtime-owned recovery instructions, the authorized recent transcript tail and the canonical history are conserved by the compaction | The installed compaction summary does carry the goal and the accepted-frames, and the session survived — but the engineering counterevidence above did not | The compaction/task-contract mechanics are already qualified and are not reopened here | `1795665267287_u5y52.compaction.json` |

## W1 request identity — what the frozen transcript does and does not show

* The ordinary request is confirmed exactly: `msg_JtyLl-0m` — **79 725 input tokens, 78 300 cache-read tokens**, model
  `qwen3.8-flash-next-q2_0`.
* **No message in the transcript carries 74 446 input tokens with zero cache-read tokens.** The nearest large zero-reuse request is
  `msg_gsaXCS3r` with **22 714 input tokens / 0 cache-read tokens**, and it occurs AFTER the compaction timestamp — consistent with a
  post-compaction cold prefill of the compacted history, not with a 74 446-token auxiliary request.
* Therefore the **suspected PCK auxiliary request is not identifiable in the frozen transcript**: `W1_PCK_REQUEST_CORRELATION = CAPTURE_INSUFFICIENT`,
  and the 180.8 s duration **cannot** be attributed to PCK on this evidence. The 180 s deadline is nevertheless confirmed in production source
  (`DEFAULT_PCK_DEADLINE_MS = 180_000`).

## Quality status

`PCK_KNOWLEDGE_QUALITY = NOT_EXECUTED` — the actual extraction quality remains the successor's live inference experiment. The matrix above is the
minimum evidence a successful implementation must preserve, and it is derived from the frozen historical artifacts, not from a new inference.
