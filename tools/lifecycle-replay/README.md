# lifecycle-replay

Offline trace-to-Mermaid projection over the EXISTING JSONL evidence.

Reads a continuation-cardinality-authority JSONL capture (the CCARD
diagnostic produced by `apps/vscode/src/sdk/continuation-cardinality-authority.ts`)
and projects it into:

- `incident-timeline.json` — the correlated, per-stage timeline with
  explicit provenance for every joined fact.
- `incident-path.mmd` — a Mermaid state diagram of the projected path.

## Strict correlation rules

The tool NEVER guesses a join. Every projected fact carries a
`correlation` field:

| Value | Meaning |
|---|---|
| `exact` | The join key matched on every available identity field. |
| `partial` | The join key matched on the fields that were PRESENT; at least one identity field was absent from the source record. |
| `unknown` | The join could not be established. The fact is recorded as UNKNOWN, not inferred. |

The session is the primary correlation key. `taskId` and `epoch` are
used when present. A record with a DIFFERENT `sessionId` is never
merged into the projection.

## Usage

```bash
bun tools/lifecycle-replay/replay.ts \
  --trace <path-to-ccard.jsonl> \
  --session <sessionId> \
  --out <evidence-dir>
```

`--session` is optional: without it, every session in the trace is
projected separately.

## What it does NOT do

- It does NOT read live state.
- It does NOT add instrumentation.
- It does NOT infer a transition that the trace does not contain.
