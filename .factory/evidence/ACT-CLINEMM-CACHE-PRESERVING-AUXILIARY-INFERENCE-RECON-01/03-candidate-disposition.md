# ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01 — 03 candidate disposition

## The decisive structural fact

On the OpenAI-compatible route the **system prompt is rendered as `messages[0]` (role `system`)**, and on the Anthropic-style route it is a
**separate `system` field rendered BEFORE the messages**. In BOTH cases a system-prompt modification therefore sits **upstream of the entire
conversation**.

This is exactly what the frozen MiniMax Arm A evidence shows (`02-prefix-discriminators.json`):

| Transition | System chars | System equal | First divergent system char | Tools | Leading identical messages | Cache read (frozen usage) |
|---|---:|---|---:|---|---:|---:|
| 78 → 79 | 4612 → 4612 | yes | none | identical (9) | 155 / 157 | 150016 → 151552 (preserved) |
| 79 → 80 | 4612 → 6038 | no | **4612** (the +1426 R2 objective is appended to the END of the system prompt) | identical (9) | 157 / 159 | 151552 → **128** (discontinuity) |
| 80 → 81 | 6038 → 6038 | yes | none | identical (9) | 159 / 161 | 128 → 157568 (restored) |

So the R2 objective projection is **append-only and stable while it is active**, yet it still destroyed the cache at activation, because the
append happened in the **system** channel, which is rendered before the conversation. The divergence was at system char 4612 — i.e. **before every
message**.

The selector request itself (`sel_jxe8l1tr`) is a wholly independent request: 1722-char system, 1 message, 0 tools, and only **9** system characters
shared with the parent. It therefore has no reusable prefix at all.

## Candidate comparison (executable, `02b-pck-prefix-equivalence.json`)

| | A — existing | B — full contract as suffix | C — persistent protocol + activation suffix | D — provider privileged suffix | E — engine cache branch |
|---|---|---|---|---|---|
| Production feasibility | yes (today) | yes | yes | **NOT established** | recon only |
| Shared-prefix potential | **0%** (divergence at message 0) | parent messages preserved, divergence at the appended message | parent messages preserved, divergence at the appended message | unknown | unknown |
| Instruction authority | full (independent system prompt) | full | full (protocol in the system channel, activation in the tail) | depends on the provider | n/a |
| Source-visibility conservation | preserved (whole canonical history) | preserved | preserved | unknown | n/a |
| Ordinary execution overhead | none | none | **the persistent protocol's text on every ordinary request** | unknown | unknown |
| Tool/schema compatibility | auxiliary carries NO tools (isolation by absence) | parent's visible tools retained, execution isolated by the runtime | same as B | unknown | n/a |
| Parent-return compatibility | n/a (independent) | branch-local: removing the suffix reproduces the parent body byte-for-byte | branch-local | unknown | unknown |
| Provider portability | high | high | high | depends | n/a |
| Behavioural qualification required | none (today's behaviour) | auxiliary-mode behaviour only | ordinary-mode behaviour (dormant protocol) | full | full |

**Candidate D is rejected for now.** The resolved transport is the AI SDK's OpenAI-compatible adapter and the Anthropic-shaped wire; there is no
production path that places a late-position privileged instruction in a provider-recognized privileged role. A user-message marker is **not** an
equivalent of a system/operator role, and undocumented fields must not be used to fake one.

**Candidate E is reconnaissance only.** No serving-engine configuration was inspected or modified; the local engine's prefix-cache branching and
slot-state preservation remain **LIVE_UNOBSERVABLE** from this repository.

## Selection

* **Primary (PCK): Candidate C**, with the persistent protocol established **once at session initialization** and the dynamic activation appended
  at the message tail.
* **Fallback (PCK): Candidate B** — the same tail placement without a persistent protocol, for operators who cannot accept the ordinary-prompt
  overhead; it preserves the parent prefix but re-sends the whole auxiliary contract on every activation.
* Candidate A stays the **legacy fallback** for a fresh session that has not yet established the protocol: the protocol must never be inserted for
  the first time immediately before an activation, because that would invalidate the prefix it exists to preserve.

### Measured facts behind the selection

* Candidate A: `identicalLeadingMessageCount = 0`, `firstDivergentMessageIndex = 0`, `eligiblePrefixReuseRatio = 0`.
* Candidate B: `identicalLeadingMessageCount = 5` (all parent messages), `firstDivergentMessageIndex = 5`, serialized-prefix ratio 0.719 on a small
  fixture.
* Candidate C: `identicalLeadingMessageCount = 5`, `firstDivergentMessageIndex = 5`, serialized-prefix ratio 0.758 on the same fixture.
* Token-level quantities are **UNKNOWN**: no tokenizer is reachable offline and no estimate was substituted.

### Evidence classes

* W2 comparisons: **REAL_PRODUCTION_SEAM** (frozen wire captures).
* C3 candidate comparison: **SYNTHETIC_REAL_PRODUCTION_SEAM** (real request builder + real serializer, representative frozen-shaped fixture).
* Engine cache residency: **NOT_EXECUTED** (`CACHE_RESIDENCY_NOT_EXECUTED`).
* Server-side cache causality: **LIVE_UNOBSERVABLE**.
