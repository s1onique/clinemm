# 01 — P0-1: the false observation assurance

```text
FINDING:      HALT_PCK_FALSE_OBSERVATION_ASSURANCE
STATUS:       CORRECTED
RED:          REPRODUCED  (receipt: verification/red-false-observation-assurance.txt)
GREEN:        CONFIRMED  (receipt: verification/act-owned-tests.txt)
```

## 1.1 — The counterexample

The predecessor derived the `tool_observed` assurance from REFERENCE
MEMBERSHIP alone:

```ts
if (observed.some((reference) => toolCallIds.has(reference))) {
    return "tool_observed";
}
```

That established only that a canonical tool CALL EXISTED. It did NOT
establish that the call's RESULT SUPPORTS the selected observation atom.

The review's concrete counterexample, reproduced verbatim in the
discriminator:

```text
the canonical history contains  run_commands -> echo hello
the model selects              SEARCH_RETURNED_NO_MATCH
the predecessor published      assurance=tool_observed
                               statement="bounded search returned no match"
```

"bounded search returned no match" is NOT entailed by "echo hello". The
runtime-owned wording did not imply runtime-established truth.

## 1.2 — The RED

The predecessor implementation was restored and the discriminator executed
against it. The RED suite is isolated in its own vitest config, so it never
enters the default suite:

```bash
bun run test:red:pck-observation-assurance
```

```text
× P0-1.1: `echo hello` does NOT support a SEARCH_RETURNED_NO_MATCH claim
  AssertionError: expected 'tool_observed' to be 'model_reported'
× P0-1.2: the PUBLISHED record carries the downgraded assurance
  AssertionError: expected 'tool_observed' to be 'model_reported'
✓ P0-1.3: the tool event ledger records the CLASS, not just the id
✓ P0-1.4: EVERY atom's required class is a RUNTIME-OWNED member
✓ P0-1.5: a MATCHING successful event DOES reach tool_observed
× P0-1.6: a FAILED search does NOT reach tool_observed
  AssertionError: expected 'tool_observed' to be 'model_reported'
× P0-1.7: an UNANSWERED call establishes nothing
  AssertionError: expected 'tool_observed' to be 'model_reported'

Test Files  1 failed (1)
     Tests  4 failed | 3 passed (7)
```

**FALSE_OBSERVATION_ASSURANCE_RED_REPRODUCED**

## 1.3 — The correction

The review prescribed the bound precisely:

> *"absent atom-specific semantic support, downgrade the claim to
> model_reported. Do not implement a general-purpose semantic verification
> engine."*

The correction is therefore a CLOSED, TOTAL, RUNTIME-OWNED table of six
observation atoms against three tool classes. It is NOT a semantic engine.

### The tool classes

```text
command_execution   run_commands
source_read         read_files, read_file, list_files
search              search_files, grep_search, codebase_search
```

A tool name outside these tables is UNCLASSIFIED and supports NOTHING.

### The atom table

```text
OPERATION_INVOKED         -> command_execution
OPERATION_ARGUMENT_SET    -> command_execution
CONFIGURATION_VALUE_SET    -> source_read
IMPLEMENTATION_INSPECTED   -> source_read
SEARCH_RETURNED_NO_MATCH   -> search
QUESTION_REMAINS_OPEN      -> (none) — permanently model_reported
```

### The three conditions a cited event must satisfy

```text
(a) the join is UNAMBIGUOUS  — one call, one result, matching tool name
(b) the result AFFIRMATIVELY SUCCEEDED — an explicit `success: true`
(c) the event's CLASS is the class the ATOM requires
```

Condition (b) reuses the rule the production evidence-continuity module
already applies: `isError: false` is NOT a success signal, and a payload
with no affirmative success leaves the result UNVERIFIED.

### The effect

```text
references RESOLVE but do not SUPPORT  -> ceiling model_reported
no references at all                    -> ceiling unverified
an atom with no supportable class       -> ceiling model_reported
a cited event SUPPORTS the atom         -> ceiling tool_observed
```

The record is still PUBLISHED, with the truthful assurance. The working
knowledge is preserved; only the false claim is removed.

## 1.4 — The GREEN

```text
bun run test:red:pck-observation-assurance
  Test Files  1 passed (1)
       Tests  7 passed (7)
```

**FALSE_OBSERVATION_ASSURANCE_GREEN**

The correction did not simply disable the feature. P0-1.5 proves a
MATCHING successful search still reaches `tool_observed`, and the real-model
gate receipts (section 03) show live `tool_observed` records alongside
downgraded ones.

## 1.5 — The production module contains no repository-specific string

The correction is generic. The tool-class tables name the RUNTIME'S OWN
tools, not any evaluator's fixture, and no Keycloak / `kc.sh` / R2 / R4 /
R6 string appears in the production module. The existing G7.5.6 assertion
continues to hold.
