# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01 — Source & Capture-Seam Map

**Repository:** `s1onique/clinemm`
**Branch:** `main`
**Subject HEAD (entry):** `b0c5a0b232d4fb13291a754e1ac337e4e99b87fb`
**Date:** 2026-11-20

---

## 1. The real request pipeline, and where each boundary is observed

The ACT's pipeline (Section 2) mapped onto the real production code:

| # | Pipeline stage | Production seam | File | Forensic stage |
|---|---|---|---|---|
| 1 | Runtime constructs `AgentModelRequest` | `prepareModelRequest` | `sdk/packages/agents/src/agent-runtime.ts` | — |
| 2 | `prepareTurnForModelRequest()` may compact / transform | compaction extension | `sdk/packages/core/src/extensions/context/compaction.ts` | — |
| 3 | `beforeModel` hooks may replace messages or tools | `beforeModel` | `apps/vscode/src/sdk/hooks-adapter.ts:245` | — |
| 4 | Final request-budget check | `buildForApi` / budget enforcement | `sdk/packages/core/src/session/services/message-builder.ts:216` | — |
| 5 | Runtime produces the FINAL provider-visible projection | `observeRequestPrepared(request)` | `sdk/packages/agents/src/agent-runtime.ts:3898` (called at `:3032`) | **A — `runtime_projection`** |
| 6 | AI SDK converts messages / system / tools | `buildAiSdkRequestMessages()` + `toAiSdkMessages()` + `toAiSdkTools()` | `sdk/packages/llms/src/providers/ai-sdk.ts:402`, `:750`, `:872` | — |
| 7 | AI SDK / provider adapter serializes the HTTP request | `recordProviderRequestCapture({stage:"ai_sdk_prompt"})` | `sdk/packages/llms/src/providers/ai-sdk.ts:2439` | **B — `ai_sdk_prompt`** |
| 8 | Wire boundary submits the request | `wrapFetchForProviderRequestCapture` | `sdk/packages/llms/src/providers/provider-request-capture.ts:646` | **C — `wire_request`** |

### 1.1 The three forensic capture points, exactly

**A — final runtime projection.** `agent-runtime.ts:3032` calls
`observeRequestPrepared(request)` AFTER compaction, AFTER every `beforeModel`
transform and AFTER the final request-budget enforcement. The forensic
capture is invoked at that same seam, so it observes exactly what the runtime
INTENDED to submit.

**B — AI SDK prompt.** `ai-sdk.ts` builds `messages` via
`buildAiSdkRequestMessages()` (which calls `toAiSdkMessages()` for the
role/parts and `toAiSdkTools()` for the tool set), then serializes them into
`streamText(...)`. The forensic capture sits immediately before that call, so
it observes the adapter's OWN view — after the adapter's transformations.

**C — serialized provider request.** `provider-request-capture.ts` already
wraps the provider fetch. The forensic capture is invoked in the SAME
wrapper, immediately around the HTTP invocation, and reads the ACTUAL
serialized body.

### 1.2 Why stage C had no live evidence until now

**The preserved capture corpus contains ZERO `wire_request` records.**

| Host (`.vscodium-*`) | `ai_sdk_prompt` records | `wire_request` records |
|---|---:|---:|
| polyc | 4,529 | 0 |
| kurchatov | 3,376 | 0 |
| grai | 3,215 | 0 |
| indeepfe | 2,661 | 0 |
| course | 2,004 | 0 |
| ulybka | 1,781 | 0 |
| mts | 1,725 | 0 |
| indeep | 1,688 | 0 |
| granelle | 1,648 | 0 |
| run / runargo / clinemm / roz2 / myc / roz | 2,559 | 0 |
| **TOTAL** | **24,862** | **0** |

The existing `CLINE_CAPTURE_PROVIDER_REQUEST=summary` capture writes the
`wire_request` stage only when `CLINE_CAPTURE_WIRE=true` is ALSO set — and
no preserved run had it set. Consequently:

* the existing capture CAN answer the D1 / D2 / D3 discriminators at the
  `ai_sdk_prompt` boundary, and it DID (see the difference matrix);
* it CANNOT answer D4 (adapter vs runtime) or the wire-payload half of D6,
  because no wire record survives.

This is why the forensic extension adds stage C explicitly, and why the
**wire stage is reported as `UNAVAILABLE_FROM_TRACE`** for every preserved
record rather than being inferred from the AI SDK stage.

---

## 2. The INSTRUMENTED capture (added by this ACT)

### 2.1 Files

| File | Role |
|---|---|
| `sdk/packages/shared/src/runtime/prefix-forensics.ts` | The opt-in switch, the KEYED fingerprint primitive (HMAC-SHA-256), the structural request inventory, the capture record schema and its SHA-256 identity. |
| `sdk/packages/shared/src/runtime/prefix-forensics-analyzer.ts` | The OFFLINE request-difference analyzer (message / tool / system / stage comparison). |
| `sdk/packages/shared/src/runtime/prefix-forensics-analyzer-cli.ts` | The offline CLI that turns a capture directory into the request-difference matrix. |
| `sdk/packages/llms/src/providers/prefix-forensics-capture.ts` | The capture WRITER: directory resolution, atomic write, restrictive modes, attempt correlation. |
| `sdk/packages/shared/src/runtime/prefix-forensics-analyzer.test.ts` | The analyzer witnesses (V2–V10). |
| `sdk/packages/llms/src/providers/prefix-forensics-capture.test.ts` | The capture-writer witnesses (V1, V7, V8, V9, V10) at the real seam. |

### 2.2 The switch

```
CLINEMM_PREFIX_FORENSICS=1        # arms the capture (the ONLY value that arms it)
CLINEMM_PREFIX_FORENSICS_DIR=...   # where the records go (outside Git, 0o700)
CLINEMM_PREFIX_FORENSICS_KEY=...   # the cohort key (never persisted)
```

### 2.3 The DEFAULT-OFF contract

* `isPrefixForensicsEnabled()` reads the switch AT OBSERVATION TIME and
  returns `true` ONLY for the exact string `"1"`. `0`, `true`, `yes`, `on`,
  `01` and the empty string all leave it OFF.
* When OFF, `recordPrefixForensics` returns BEFORE any key is generated,
  BEFORE any fingerprint is computed, BEFORE any directory is resolved and
  BEFORE any file is written.
* No observer, sink, allocation, serialization, hashing or filesystem
  access occurs on the disabled path. Proven by
  `V1: the DISABLED path writes nothing and touches no filesystem`.

### 2.4 The failure contract

Every capture body is wrapped so that no throw can escape into the provider
path. Proven by `V8: a MALFORMED input produces no record and never throws
into the caller` (a cyclic value is passed in).

### 2.5 The non-interference contract

The capture does not modify the request, the tool definitions, the options,
the retry behaviour or the compaction behaviour. It does not issue an
additional provider request. It adds no public API and no protocol field.

---

## 3. The producer of the observed mutation (the causal seam)

The earliest model-facing difference is produced by the **stale-read
rewrite** in the message builder, NOT by the runtime, NOT by the adapter and
NOT by the engine.

`sdk/packages/core/src/session/services/message-builder.ts`:

| Line | Code | Meaning |
|---|---|---|
| `:51` | `const OUTDATED_FILE_CONTENT = "[outdated - see the latest file content]";` | The replacement text. |
| `:356-368` | `transformBlock()` → `replaceOutdatedReadContent(nextContent, outdated)` | **The in-place rewrite**: a `read`/`read_files` tool result whose locator is COMMITTED as outdated has its content replaced. |
| `:782-864` | `commitOutdatedRewrites(messages)` | The commit gate: pending rewrites are committed only once `pendingBytes >= minOutdatedRewriteBytes` (default **65,536** bytes). |
| `:39-41` | `DEFAULT_MIN_OUTDATED_REWRITE_BYTES = 65_536` | The threshold, with the comment *"Batch stale-read rewrites to avoid breaking provider prefix caches on every re-read."* |
| `:33-36` | `DEFAULT_MAX_TOTAL_TEXT_BYTES = 6_000_000` | The aggregate budget, whose comment already names the mechanism: *"budget truncation rewrites bytes mid-transcript, which invalidates provider prefix caches from the first rewritten block onward."* |

The rewrite is applied to the message's OWN position — same index, same role,
same `toolCallId` — so the message COUNT and the message ORDER are
unchanged. Only the bytes inside the block change. That is precisely the
signature of a provider prefix-cache invalidation that no message-count
analysis would detect.

### 3.1 The existing shielding, and why it does not cover this case

`buildForApi()` shields the duplicate-read ANCHOR and its compact
REFERENCES from the stale-read policy (`message-builder.ts:216-241`), so a
byte-identical re-read does not rewrite the anchor. But the code explicitly
declines to shield **SUPERSEDED** content:

> *"Superseded content is never shielded: once a later, different read
> established newer content at the same locator, the old bytes are obsolete
> and the existing stale-read policy must reclaim them. Freshness wins over
> prefix-cache preservation."* (`message-builder.ts:225-231`)

So the observed rewrite is the DOCUMENTED, INTENTIONAL trade-off of the
stale-read policy: **freshness wins over prefix-cache preservation**. The
`read_files` results observed here were superseded by a later read of the
same locator, and the policy reclaimed the old bytes.
