# 02 — The RED and the GREEN

## The discriminator

```text
sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/pck-same-class-assurance.red02.test.ts
sdk/packages/core/vitest.red.pck-same-class-assurance.config.ts
bun run test:red:pck-same-class-assurance
```

The witness is ISOLATED: it has its own vitest config, so it never enters
the default suite. It is ALSO in the ACT-owned focused suite, so the
GREEN is continuously evidenced.

## The cheapest RED — exactly as the review specified

The review said: *"Take test P0-1.5 and change only its synthetic tool
result."*

```diff
- result: "no matches in the searched scope",
+ result: "42 matches found in the searched scope",
  success: true,
```

and *"Change it to require `model_reported`."*

That is P0-2.1 of the witness.

## The RED result against the CORRECTION01 implementation

```text
Test Files  1 failed (1)
     Tests  11 failed | 3 passed (14)

AssertionError: expected 'tool_observed' to be 'model_reported'
// Object.is equality
```

Full receipt: `verification/same-class-red.txt`.

## The GREEN against the corrected implementation

```text
Test Files  1 passed (1)
     Tests  14 passed (14)
```

Full receipt: `verification/same-class-green.txt`.

## EVERY counterexample the review listed is reproduced

| Review's counterexample | Witness | RED against CORRECTION01 |
| --- | --- | --- |
| successful search returning 42 matches -> SEARCH_RETURNED_NO_MATCH | P0-2.1 | `tool_observed` (FALSE) |
| successful search returning no matches -> SEARCH_RETURNED_NO_MATCH | P0-2.2 | `tool_observed` (FALSE) |
| successful `echo hello` -> OPERATION_INVOKED: build | P0-2.3 | `tool_observed` (FALSE) |
| successful `echo hello` -> OPERATION_ARGUMENT_SET: start --optimized | P0-2.4 | `tool_observed` (FALSE) |
| read config holding a 30s timeout -> CONFIGURATION_VALUE_SET: connect timeout 3 seconds | P0-2.5 | `tool_observed` (FALSE) |
| successful directory listing -> IMPLEMENTATION_INSPECTED | P0-2.6 | `tool_observed` (FALSE) |

## The witness also proves the feature is NOT disabled

| Witness | Assertion |
| --- | --- |
| P0-2.10 | a successful `make build` DOES reach `tool_observed` |
| P0-2.11 | a FAILED `make build` does NOT reach `tool_observed` |
| P0-2.12 | an AMBIGUOUS chain (`make build; echo done`) does NOT reach `tool_observed` |
| P0-2.13 | `make build` does NOT establish `start --optimized` |
| P0-2.14 | OPERATION_ARGUMENT_SET without an argument establishes nothing |
| P0-2.8 | ONLY the operation atoms are deterministically establishable |
| P0-2.9 | the runtime-argument evidence table is CLOSED and TOTAL |

## The published record survives with a truthful assurance

P0-2.7 runs the ACTUAL publication gate over the ACTUAL same-class
counterexample and asserts:

```text
gate.records.length          == 1      (the working knowledge SURVIVES)
gate.records[0].assurance     == "model_reported"
gate.records[0].statement     == "bounded search returned no match"
```

## The end-to-end production proof

The correction is proven through the REAL production seam, not only at
the unit level.

```text
sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/pck-production-seam.test.ts
  G7.2b  the PUBLISHED assurance is the TRUTHFUL one through the REAL
         production path
  G7.2c  a DETERMINISTICALLY ESTABLISHED operation keeps the stronger
         assurance through the REAL production path
```

G7.2b inspects BOTH the persisted summary AND the provider-visible
continuation, and asserts that neither carries `assurance=tool_observed`
while both carry `assurance=model_reported` AND the runtime-owned
statement.

## The predecessor's P0-1 witness was INVERTED, not weakened

`pck-observation-assurance.red01.test.ts` P0-1.5 originally asserted
*"a MATCHING successful event DOES reach tool_observed"*. That assertion
was itself a false assurance, so it is now inverted to require
`model_reported`, with the reason recorded in the test.

The cross-class witness P0-1.1, P0-1.2, P0-1.3, P0-1.4, P0-1.6 and
P0-1.7 are UNCHANGED and still pass: the cross-class correction is
preserved.
