# Factory — Cline-- fork baseline tooling

This directory holds the **ACT-CLINEMM-FORK-BASELINE01** factory: a measurement
layer that establishes a reproducible, evidence-backed baseline for the
Cline-- fork. It does **not** modify application behavior.

## Layout

```
factory/
├── README.md                 (this file)
├── schemas/                  JSON Schema definitions for the inventories
│   ├── environment.schema.json
│   ├── evidence.schema.json
│   ├── repository.schema.json
│   └── verification.schema.json
├── scripts/                  Collectors and runners (run with `bun <script>.ts`)
│   ├── collect-environment.ts        (B — environment proof)
│   ├── collect-exact-duplicates.ts   (H — exact whole-file duplicates)
│   ├── collect-file-sizes.ts         (G — file-size baseline)
│   ├── collect-network-listeners.ts  (I — listener candidates)
│   ├── collect-privileged-sinks.ts   (J — privileged-sink candidates)
│   ├── collect-repository.ts         (A — repository identity)
│   ├── collect-verification.ts       (E — verification matrix)
│   ├── collect-workspaces.ts         (D — workspace inventory)
│   ├── run-verification.ts           (F — verification runner)
│   └── verify-baseline.ts            (K — determinism verifier)
├── inventories/              Output JSON / CSV inventories (git-tracked)
└── baselines/                Output baselines (git-tracked)
```

## Quick start

```bash
# 1. Collect all inventories (deterministic; safe to re-run).
bun factory/scripts/collect-repository.ts
bun factory/scripts/collect-environment.ts
bun factory/scripts/collect-workspaces.ts
bun factory/scripts/collect-verification.ts
bun factory/scripts/collect-file-sizes.ts
bun factory/scripts/collect-exact-duplicates.ts
bun factory/scripts/collect-network-listeners.ts
bun factory/scripts/collect-privileged-sinks.ts

# 2. Verify determinism (every collector is rerun; outputs are diffed).
bun factory/scripts/verify-baseline.ts

# 3. Execute mandatory and affected-scope commands; capture evidence.
bun factory/scripts/run-verification.ts --timeout-ms 900000
```

## Detached evidence

`run-verification.ts` writes the raw command outputs to `.factory/evidence/...`,
which is **git-ignored**. The bundle is regenerated after the closing commit so
its hashes bind to the literal final HEAD/tree.

## Ground rules (carried from ACT-CLINEMM-FORK-BASELINE01 §I3 / §I5 / §I7)

1. **No runtime behavior change.** Production source code remains
   tree-identical to the selected upstream commit. The only permitted
   additions under this ACT are `factory/**`, `docs/factory/**`, and
   the `.gitignore` entry for `.factory/`.
2. **Source-derived.** Every command cites its `source.path` and
   `source.locator`. No invented commands.
3. **Truthful classification.** Every command has exactly one class and
   one result. `skip` / `unavailable` / `not-run` carry reasons.
4. **No baseline enforcement.** Historical debt is recorded, not
   remediated.
5. **Native macOS arm64 first.** All collectors and runners operate on
   the primary development host without Rosetta translation.

## Status of this ACT

- All collectors implemented and run successfully on the primary host.
- 33 verification commands discovered and classified.
- Tree-identity proof: the working tree matches
  `upstream/main` byte-for-byte after excluding the permitted
  Factory paths (see `factory/scripts/verify-baseline.ts`).