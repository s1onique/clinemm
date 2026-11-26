# ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01 (AMENDMENT-01) — 03 candidate disposition

This document SUPERSEDES the recon's first candidate disposition. The earlier comparison compared
UNEQUAL contracts and ranked candidates by JSON character-prefix ratios; both are corrected here.

## The decisive structural fact (unchanged, still established)

On the OpenAI-compatible route the system prompt is rendered as `messages[0]` (role `system`); on the
Anthropic-shaped route it is a separate `system` field rendered BEFORE the messages. In both cases a
system-prompt modification sits upstream of the whole conversation. The frozen MiniMax Arm A evidence
(`02-prefix-discriminators.json`) shows the consequence: the R2 objective appends +1426 chars to the
END of the system prompt, the first divergent system char is 4612, the tools and the leading messages
are byte-identical, and the cache read collapses from 151 552 to 128 tokens at exactly that transition
(79 -> 80), recovering to 157 568 at 81.

## The corrected candidates (executable, `02b-pck-contract-equivalence.json`)

| | A (legacy) | B' | C' |
|---|---|---|---|
| Construction | the existing independent PCK request: `CHECKPOINT_SYSTEM_PROMPT` + ONE user message with the whole rendered controlled transcript, no tools | the COMPLETE existing extraction contract appended at the TAIL of an UNCHANGED parent projection | the COMPLETE equivalent contract PARTITIONED between a session-initialized persistent protocol (ordinary system prompt) and a dynamic activation suffix (message tail) |
| System representation (route-specific) | `messages[0].role=system` | `messages[0].role=system` | `messages[0].role=system` |
| System equal to its parent reference | false | true | true (against its OWN protocol-bearing parent) |
| Tool schema equal to its parent reference | false | true | true |
| Leading identical messages / first divergent message | 0 / 0 | 5 / 5 | 5 / 5 |
| Contract elements present (of 33 required) | 31 | 33 | 33 |
| B' equals C' (element sets) | — | yes | yes |
| Conversation duplicated in the suffix | yes (by design: the legacy request carries the transcript) | no | no |
| Suffix bytes / protocol overhead bytes | 476 / 0 | 2 458 / 0 | 472 / 2 717 |
| Parent return (parent before == parent after; candidate minus suffix == parent) | n/a | true / true | true / true (against its own parent) |
| Generation + tool settings equal to the parent | n/a | true | true |
| Rendered-token prefix | UNKNOWN | UNKNOWN | UNKNOWN |
| Actual cache residency | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |

The two candidates are **contract-equivalent**: the same 33 required extraction elements (every closed
vocabulary value, the output shape, the prohibitions, the attribution rule, the canonical references,
the authorized source interval and the objective) are model-visible in both.

The legacy A request is missing two of them — it carries no explicit **authorized source interval** and
no explicit **objective** — which is itself a finding about the current contract.

## The candidate trade-off that the character ratios obscured

* **B'** re-sends the whole extraction contract on every activation (2 458 bytes here) and requires NO
  change to the ordinary request: it is the smaller implementation and the smaller behavioural risk.
* **C'** sends only 472 bytes on activation but adds 2 717 bytes of protocol to EVERY ordinary request
  of every session, and requires a fresh session to establish the prefix (a live session's prefix must
  never be migrated opportunistically).

Both preserve the parent prefix. Nothing measured offline makes C' necessary: the offline evidence does
NOT discriminate between them on correctness. **B' is therefore selected as the smaller implementation**
for the first isolated behavioural experiment; C' is retained as a hypothesis, not as a second permanent
architecture. A (the legacy independent request) remains the fallback.

## Candidate D — provider-supported privileged suffix

Not established. The resolved transport is the AI SDK's OpenAI-compatible adapter and the Anthropic-shaped
wire; no production path places a late-position privileged instruction in a provider-recognized privileged
role. A user-message marker is not an equivalent of a system/operator role, and undocumented fields must
not be used to fake one.

## Candidate E — existing dedicated inference cache branch

Reconnaissance only. No serving-engine configuration was inspected or modified; prefix-cache branching
and slot-state preservation remain LIVE_UNOBSERVABLE from this repository.

## Source-visibility cost of the candidates (`02c-source-visibility-and-execution.json`)

The parent-derived candidates EXPOSE material the legacy controlled view excluded. The deltas are
measured, not asserted:

1. **Private reasoning.** The legacy view excludes thinking blocks; the parent projection carries them to
   the wire as `reasoning_content`, so the candidate's auxiliary request contains the parent's private
   reasoning (signed and unsigned).
2. **Observation status.** The legacy view NORMALIZES `status=succeeded` / `status=failed`; the candidate
   carries the raw tool payload only.
3. **Evidence-reference binding.** The legacy view binds each reference to its content inline
   (`[id:msg-3] <rendered text>`); the candidate lists the reference LABELS in the suffix without their
   content, and the canonical ids are dropped by the projection, so the model cannot resolve which content a
   reference denotes. **This is the precise missing seam**: the canonical-id <-> provider-visible-position
   binding is not carried on the wire.
4. **Bounded source material.** The two surfaces truncate differently (the parent projection truncates,
   the legacy controlled view does not).

The available enforcement is bounded but real: the publication gate rejects an UNOBSERVED reference
(`REFERENCE_NOT_CANONICAL`) and DOWNGRADES the claimed assurance to the interpreter's bound
(`model_reported` for a user-text-only or reasoning-only citation) — it does not reject such a citation.
Source-visibility conservation is therefore NOT claimed for the candidates as they stand; it is an
explicit successor gate with the three deltas above as acceptance criteria.
