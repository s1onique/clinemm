# 07 — Necessity / ablation

**Test:** `ABLATION A/B/C` in
`src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts`
— **PASSING**.

**Label:** `SYNTHETIC_REAL` for the projection; **`NOT_LIVE`**. This establishes
**structural necessity** of preserving the specific state. It does **not** prove
behavioural model convergence.

---

## 1. The test-local alternate projection

The ACT requires a **test-local** alternate projection that "restores only the
missing qualified adjudication", and forbids "any generalized state store or
production adapter".

The implementation satisfies that constraint exactly:

```ts
function testLocalRestoreAdjudication(
    messages: readonly MessageWithMetadata[],
    adjudication: string,
): MessageWithMetadata[] {
    return messages.map((message) => {
        if (message.role !== "assistant" || !Array.isArray(message.content)) {
            return message;
        }
        const hasAdjudication = message.content.some(
            (block) =>
                block.type === "text" &&
                typeof (block as { text?: unknown }).text === "string" &&
                (block as { text: string }).text.includes(adjudication),
        );
        if (hasAdjudication) {
            return message;
        }
        return {
            ...message,
            content: [
                { type: "text" as const, text: adjudication },
                ...message.content,
            ],
        };
    });
}
```

| Constraint | Satisfied? |
|---|---|
| test-local only | ✔ lives inside the test file |
| restores ONLY the missing adjudication | ✔ one bounded string, one block |
| no generalized state store | ✔ no module, no registry, no persistence |
| no production adapter | ✔ no production file is touched |
| no persisted state | ✔ the result is a local array |
| no new provider/wire field | ✔ a normal assistant `text` block |

The restoration is applied to the **output of the unchanged production
projection** — so the projection's own behaviour is identical in A and B, and the
**only** difference is the re-attached adjudication block.

---

## 2. The A / B / C comparison

| Variant | Projection | Verdict token | Qualification token |
|---|---|---|---|
| **A** | original production projection | **absent** | **absent** |
| **B** | identical projection + bounded adjudication | **present** | **present** |
| **C** | B with the restoration removed | **absent** | **absent** |

**Required outcome — met:**

```
A: RED                    ✔  (adjudication absent)
B: required adjudication visible   ✔  (verdict AND qualification present)
C: RED restored            ✔  (adjudication absent again)
```

### 2.1 The restoration changes nothing else

The ablation additionally asserts that **A and B are byte-identical once the
restored block is removed from B**. The comparison is performed on the
**structured message list** (not on a regex over serialized JSON), so it is
exact:

```ts
expect(JSON.stringify(aMessages)).toBe(JSON.stringify(bMessages));
```

This rules out the objection that the restoration "fixed" the RED by changing
something else about the compaction.

---

## 3. What the ablation establishes — and what it does not

| Claim | Status |
|---|---|
| The missing qualified adjudication is **structurally necessary** for the contract | **ESTABLISHED** |
| Removing it restores the RED **exactly** | **ESTABLISHED** |
| The rest of the production projection is unaffected | **ESTABLISHED** |
| The offline projection is a *live* demonstration | **REFUTED — it is not** |
| A live model, given the adjudication, would converge on it | **NOT_EXECUTED** — no live model was run |

The ACT's wording is respected exactly: "It does not prove behavioral model
convergence. Do not label an offline projection `LIVE`." The ablation is
labelled **`SYNTHETIC_REAL`** / **`NOT_LIVE`** throughout this evidence package.

---

## 4. The minimal safe contract implied by the ablation

The ablation shows that restoring **one bounded, qualified adjudication string**
is sufficient to make the state available again. That is the whole repair
surface. It does **not** require:

- a generalized persistent fact/verdict ledger (**explicitly not authorized**);
- restoring raw `run_commands` stdout to the summarizer (**explicit non-goal**);
- re-enabling the automatic source-file excerpt carry-forward
  (`SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false` stays **false**);
- changing the `beforeModel` completion checkpoint (**non-goal**);
- any change to `submit_and_exit` or terminal-tool behaviour (**non-goal**);
- any change to the compaction-sidecar schema (**conservation control**);
- any change to `MAX_CARRIED_OUTCOMES = 12` (**conservation control**).

---

## 5. Ablation scope — one boundary, one mechanism

The ablation is executed for the **M1 source-selection** boundary only. It does
not explore alternatives at M2, M3, M4, M5 or M6, because Discriminators B, C
and D each **excluded** those boundaries:

| Boundary | Excluded by | Ablation performed? |
|---|---|---|
| M1 source selection | — | **YES — this is the ablation** |
| M2 serialization | Discriminator B | no |
| M3 summarizer | Discriminator C | no |
| M4/M5 projection | Discriminator D | no |
| M6 provider request | Discriminator D | no |

A repair that fixes M2/M3/M4/M5/M6 while leaving M1 intact would **not** change
the outcome, because the adjudication never reaches those stages.
