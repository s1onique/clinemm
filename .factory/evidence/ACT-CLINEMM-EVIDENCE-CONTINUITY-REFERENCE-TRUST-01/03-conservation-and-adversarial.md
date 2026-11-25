# 03 — Reference and assurance conservation, and the adversarial controls

The suite is:

```text
sdk/packages/core/src/extensions/context/evidence-continuity.reference-trust01.test.ts
```

17 cases, all driving the REAL production seam.

## 3.1 — Conservation controls

### C1 — the INTERNAL canonical identity is unchanged

The ledger's `VerifiedToolOutcome.toolUseId` still holds the canonical
tool-call id, and the rejection ledger still reports canonical ids. The
call/result join is still made on the canonical id. Only the PUBLISHED
representation changed.

### C2 — distinct canonical identities remain DISTINGUISHABLE, cardinality preserved

Three distinct canonical identities produce three DISTINCT aliases
(`ev-0`, `ev-1`, `ev-2`). No two different identities collapse onto one
published reference.

### C3 — the SAME identity keeps the SAME alias

The same canonical identity yields the same alias ACROSS BOTH destinations
(the persisted summary and the provider-visible continuation) and ACROSS
re-derivation. Correlation is preserved.

### C4 — references with SIMILAR PREFIXES remain distinguishable

Two canonical ids that share a long prefix still get distinct aliases. A
prefix-based discriminator cannot merge them.

### C5 — the ASSURANCE is neither promoted nor weakened

The carried line still says `succeeded` exactly when the canonical record
established success. The repair changes the reference text only.

### C6 — publication cannot MANUFACTURE a reference to an unobserved event

An outcome with no canonical matching call is not carried at all, so no
reference to it can be published. The absence of a carried entry remains the
truthful representation of "not established".

### C7 / C8 — byte stability

The section is byte-stable across re-derivation, and the summary is
byte-stable across a re-compaction. This is the prompt-cache invariant:
the alias is a per-render sequence, and re-rendering the SAME canonical
prefix produces the SAME aliases, so the published bytes do not churn.

### A note on DUPLICATE canonical ids

A duplicate canonical id is AMBIGUOUS and already FAILS CLOSED in the
existing admission rules (`ambiguous_call_id`). Correlation is therefore
tested across the two destinations and across repeated derivation, rather
than by duplicating an id within one history — a duplicate would never
reach the renderer at all.

## 3.2 — Adversarial controls

Every adversarial case asserts the ABSENCE of the synthetic confidential
sentinel in BOTH publication destinations, and the corpus covers:

| Family | Fixture |
|---|---|
| Ordinary canonical identifiers | `call_legit_1`, `call_ordinary_001` |
| Credential-shaped identifiers | `toolu_01FAKE-CREDENTIAL-DO-NOT-USE-7P4xQz` |

### A3 — the tool NAME forgery control

This is the control that found the second defect. It asserts, over the
RENDERED section:

1. exactly ONE UNESCAPED end marker (counted with the shared
   `findUnescapedMarker()` primitive, because the escaped occurrence still
   CONTAINS the literal marker text — only the escape prefix distinguishes
   them, so a raw substring count would report two and would not be testing
   the property);
2. exactly ONE carried outcome line;
3. the forged text present only INLINE, never as a line of its own;
4. the published artifact carrying the name only in its ESCAPED, single-line
   form.

The assertion is over the RENDERED section, not over the EXTRACTED one: the
extractor stops at the FIRST end marker, so an unescaped forgery would be
truncated out of view and the control would be VACUOUS. An earlier draft of
this control asserted on the extracted section and was corrected for exactly
this reason.

## 3.3 — The positive controls

The confidentiality assertions are not satisfied vacuously. The suite
positively asserts that:

- the legitimate observation REMAINS present and attributable (P3);
- the published reference is a runtime-controlled alias, not a derivative of
  the canonical id (P4);
- the legitimate observations carry their own distinct aliases alongside a
  malicious one, in the MIXED case (A4);
- the credential-shaped id IS a real canonical reference of the session
  (P1) — so the pass is a property of the RENDERING, not of a feature that
  silently did nothing.

## 3.4 — Persistence / reload and repeated projection

The contract requires testing persistence/reload or repeated projection if
the existing production consumers require it. They do: the summary is
persisted and re-read, and the provider projection runs on every turn.
Accordingly:

- C3 asserts the SAME alias across BOTH destinations and across
  re-derivation;
- C8 asserts byte-stability of the summary across a RE-COMPACTION, which is
  the persistence-and-reload path.

The suite therefore exercises the real persistence builder
(`createSessionCompactionState()`) and the real provider projection
(`MessageBuilder.buildForApi()`) rather than a helper.

## 3.5 — The claim this ACT does NOT make

An opaque reference establishes that a reference EXISTS and that two
references may be told apart. It does NOT establish the truth of the
proposition the reference points at. The truth of a carried outcome still
rests on the canonical record and its fail-closed admission rules, and this
ACT does not weaken or strengthen them.
| Arbitrary high-entropy identifiers | random 40-char hex-ish token |
| Multiline identifiers | an id containing `\n` |
| Delimiter / section-marker injection | an id and a NAME containing the section's BEGIN/END markers |
| Instruction-shaped identifiers | an id shaped like an imperative to the model |
| Unicode and control characters | an id with zero-width, bidi and control characters |
| Repeated references | the same canonical id observed across two destinations and two derivations |
| Distinct references with similar prefixes | two ids sharing a long prefix |
| Multiple tool results in one message | a batch of N commands in one result |
| Unknown / unresolved references | a result with no matching canonical call |
| Mixed legitimate and malicious inputs | a legitimate observation, a credential-shaped one, and another legitimate one |