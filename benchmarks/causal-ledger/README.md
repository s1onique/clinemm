# BENCHMARK-M3-M31-CAUSAL-LEDGER-01

A deterministic TypeScript library that reconstructs whether background-command
terminal results have been **safely observed** before a completion is authorized.

## API

```ts
import { analyzeTerminalLedger } from "./src/terminal-ledger.ts"

const report = analyzeTerminalLedger(events) // events: readonly unknown[]
```

`report` is JSON-serializable and deterministic.

## The invariant

A completion request is `ALLOW`-ed **only** when, for the COMPLETE owner
identity `(sessionId, taskId, epoch)` of the request, every job registered to
that owner **before** the request satisfies BOTH conjuncts:

1. terminal containment was confirmed as `gone` (not `failed`), and
2. a terminal observation for that job was consumed **after** the terminal
   confirmation (strictly greater `seq`).

The analysis is a replay over the globally ordered `seq` axis. Each verdict is
emitted at the point the request is reached in that replay, so later events can
never retroactively authorize an earlier request. Correlation uses the complete
owner triple **and** the job ID, so a foreign session, a foreign task, a stale
epoch, or a different epoch of the same task can never discharge another
owner's obligations.

## Fail-closed posture

The input is untrusted. Any malformed record, conflicting duplicate `eventId`,
or conflicting duplicate `seq` invalidates the whole input: the report is
marked `valid: false`, every decision is downgraded to `HOLD`, and
deterministic diagnostics describe each problem. **An invalid input can never
produce an `ALLOW`.** Identical duplicate events are idempotent and collapsed.

The supplied input array is never mutated.

## CLI

```bash
bun src/cli.ts fixtures/mandatory-scenario.json --pretty
```

## Tests

```bash
bun test tests/          # 53 tests
bun x tsc --noEmit -p tsconfig.json
bun run test:mutation    # RED -> GREEN mutation harness
```

### Mutation harness (RED / GREEN evidence)

`scripts/mutation-check.ts` applies each of three targeted mutations to
`src/terminal-ledger.ts`, requires the suite to FAIL (RED) with the specific
adversarial test that targets the mutation, then restores the pristine source
and requires the suite to PASS (GREEN). The pristine source is always restored,
including on failure.

| Mutation | Broken invariant | Test that must fail |
| --- | --- | --- |
| `drop-the-after-terminal-conjunct` | observation must be consumed *after* terminal confirmation | "an observation BEFORE the terminal confirmation does not discharge the obligation" |
| `ignore-the-containment-classification` | `failed` containment blocks completion | "a `failed` containment blocks completion even when an observation exists" |
| `correlate-on-job-id-only` | correlation requires the complete owner triple | "a foreign session registering the same job ID cannot discharge the owner's obligation" |

## Known limitations

- `seq` is assumed to be a single global order across all sessions. The
  library does not attempt to reconcile per-session clocks; it trusts the
  supplied global order.
- A `completion_requested` event for an owner with no registered jobs is
  `ALLOW`ed (there are no outstanding obligations).
- Events whose `type`/`kind` field is missing are rejected as malformed
  rather than being inferred.
