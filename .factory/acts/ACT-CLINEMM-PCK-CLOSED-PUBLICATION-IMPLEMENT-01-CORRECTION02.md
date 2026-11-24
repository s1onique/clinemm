# ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION02

```text
STATUS:   COMPLETE
VERDICT:  GO_PACKAGING
ENTRY:    5d6ff6e539c5bdc9f7ee461baa1ff15f0b417fa3
SCOPE:    One bounded correction cycle. Eliminate same-class false
          observation assurance; reproduce the RED the review specified;
          apply the smallest conservative correction; preserve admitted
          working knowledge, closed vocabulary, opaque aliases,
          default-off equivalence and ordinary compaction behaviour.
NOT DONE: Build, package, or install anything.
          No new architecture. No vocabulary expansion. No
          general-purpose semantic verification engine. No
          evidence-continuity repair. No new diagnostic infrastructure.
```

## Why this correction existed

The CORRECTION01 review accepted the closed publication architecture but
found a NEW, concrete P0: the correction still permitted FALSE
ATTRIBUTION WITHIN THE SAME TOOL CLASS.

CORRECTION01 had replaced reference MEMBERSHIP with ATOM-SCOPED SUPPORT.
A cited event supported a claim when it was unambiguously joined,
AFFIRMATIVELY SUCCESSFUL, and of the TOOL CLASS the atom required. Those
are three NECESSARY conditions — and they are not SUFFICIENT.

The interpreter never examined the actual result's meaning, and it never
even received the selected `argument`. So it could not, in principle,
compare the rendered argument with the observed operation.

The review's counterexamples, all SAME-CLASS:

```text
successful search returning 42 matches   -> SEARCH_RETURNED_NO_MATCH
successful `echo hello`                   -> OPERATION_INVOKED: build
successful `echo hello`                   -> OPERATION_ARGUMENT_SET:
                                             start --optimized
read configuration holding a 30s timeout -> CONFIGURATION_VALUE_SET:
                                             connect timeout 3 seconds
successful directory listing             -> IMPLEMENTATION_INSPECTED
```

The review's REQUIRED INVARIANT:

```text
Evidence actually supports the COMPLETE RENDERED CLAIM
  -> tool_observed
otherwise
  -> model_reported
```

The review's recommended repair was explicitly a SIMPLIFICATION:

```text
- Default to `model_reported` for model-selected semantic claims.
- Retain `tool_observed` only for propositions directly established by
  deterministic runtime evidence, including any rendered arguments.
- If none can be established economically, publish exclusively at
  `model_reported` or `unverified`.
```

## What the correction changed

### P0-2 — same-class false observation assurance (RED_REPRODUCED_AND_GREEN)

The RED was reproduced against the CORRECTION01 implementation exactly as
the review specified: the successor to the predecessor's P0-1.5 with
ONLY the synthetic tool result changed.

```text
- result: "no matches in the searched scope",
+ result: "42 matches found in the searched scope",
  success: true,
```

The assertion required `model_reported`. Against CORRECTION01 it
returned `tool_observed`.

```text
RED:    11 failed | 3 passed (14 tests)
        AssertionError: expected 'tool_observed' to be 'model_reported'
GREEN:  14 passed
```

Every counterexample the review listed is reproduced by that witness, and
each one is now bounded at `model_reported`.

### The correction REMOVES complexity rather than adding a layer

The atom/class table is GONE as a support rule. It survives only as a
DECLARED, CLOSED vocabulary so the classification of an event stays
inspectable and total.

The runtime now establishes a claim through evidence it ALREADY owns and
ALREADY computes deterministically: the PRODUCTION command classifier
`classifyCommand()`, owned by `evidence-continuity.ts`. That classifier
is already

- deterministic,
- fail-closed (an ambiguous shell chain yields NO classification),
- drawn from a FINITE allowlist (`helm template`, `make build`,
  `git status`, ...),
- free of any user-controlled text, and
- already the mechanism the rest of the system uses to decide that an
  operation was verified.

So the checkpoint needs ONE CLOSED table — which classifications establish
which RUNTIME ARGUMENT — and nothing else.

```text
build                 -> ["make build"]
start                 -> []
start_optimized       -> []
connect_timeout_3s   -> []
socket_timeout_10s    -> []
none                  -> []
```

The EMPTY SET is the norm, and it is the correct, conservative outcome:
an argument with no deterministic establishing classification is bounded
at `model_reported`. The working knowledge is PRESERVED — the record is
still published, still carries the runtime-owned statement and
qualifications — but it no longer MISREPRESENTS ITS AUTHORITY.



The interpreter now REQUIRES, for `tool_observed`:

1. the ATOM is one the runtime can establish at all. Only the OPERATION
   atoms can: for every other atom there is NO deterministic runtime-owned
   rule that establishes the rendered proposition (a bounded search that
   returned 42 matches does not establish "no match"; a directory listing
   does not establish "the implementation was inspected"; a configuration
   holding a 30-second timeout does not establish "connect timeout 3
   seconds"; an absence of support is never established by a tool);
2. the rendered ARGUMENT is present and deterministically establishable —
   the interpreter now RECEIVES it, which the predecessor never did; and
3. a cited event is a COMMAND EXECUTION that is unambiguously joined,
   AFFIRMATIVELY SUCCESSFUL, and whose own runtime-owned command
   CLASSIFICATION is one the selected argument requires.

The feature is NOT disabled: a `make build` execution that succeeded
still reaches `tool_observed`, and the end-to-end production seam proves
it (G7.2c).

### The end-to-end proof

The correction is proven through the REAL production path, not only at the
unit level:

```text
G7.2b  the PUBLISHED assurance is the TRUTHFUL one through the REAL
       production path
       - `kc.sh build` is not in the production classification
         allowlist, so no deterministic evidence establishes a BUILD;
       - BOTH the persisted summary AND the provider-visible continuation
         carry `assurance=model_reported`;
       - NEITHER carries `assurance=tool_observed`;
       - the working knowledge still SURVIVES: the runtime-owned
         statement "operation invoked: build" reaches both destinations.

G7.2c  a DETERMINISTICALLY ESTABLISHED operation keeps the stronger
       assurance through the REAL production path
       - `make build` -> `assurance=tool_observed` in both destinations.
```

## The measurements

```text
ACT-OWNED FOCUSED SUITE (9 files)         81 passed
SAME-CLASS RED WITNESS (isolated)         14 passed (GREEN)
                                           11 failed | 3 passed (RED
                                           against CORRECTION01)
CONTEXT SUITE                              913 passed, 2 skipped
RUNTIME/ORCHESTRATION SUITE                250 passed
TYPECHECK                                  44 diagnostics (the baseline)
                                           ACT_OWNED_DIAGNOSTICS=0
                                           the diagnostic set is BYTE-IDENTICAL
                                           to the entry baseline
FULL @cline/core REGRESSION                ZERO new regressions
                                           the failing FILE set is IDENTICAL
                                           (28 files)
                                           the failing TEST IDENTITY set is
                                           IDENTICAL (140 identities)
PATCH HYGIENE                              git diff --check exit 0,

### The P1-1 qualification from the review is ADDRESSED

The review noted that the predecessor compared "identical sets of 17
failing FILES, not necessarily identical failing tests". This ACT
compares the failing TEST IDENTITIES — the full `file > describe > test`
paths — and they are identical. The comparison is recorded in
`verification/regression-identity-comparison.txt`.

## The exit conditions

```text
SAME_CLASS_FALSE_ASSURANCE_RED_REPRODUCED     ESTABLISHED
SAME_CLASS_FALSE_ASSURANCE_GREEN               ESTABLISHED
PCK_PUBLICATION_CONFIDENTIALITY_PASS           ESTABLISHED
DEFAULT_OFF_EQUIVALENCE_PASS                   ESTABLISHED
ACT_OWNED_DIAGNOSTICS=0                        ESTABLISHED
NEW_REGRESSIONS=0                              ESTABLISHED

VERDICT=GO_PACKAGING
```

## What is NOT claimed

```text
ACTUAL CONVERGENCE IMPROVEMENT:   not established. The checkpoint's
                                  usefulness for arbitrary software
                                  engineering tasks remains unproven.
INSTALLED-LIVE QUALIFICATION:     not performed.
EXACT-HEAD VSIX:                  not built. Out of scope by instruction.
LIVE PROVIDER CANCELLATION:        not exercised against a real provider.
                                  The provider script checks
                                  `signal.aborted` AFTER receiving a
                                  stream chunk; that does NOT establish
                                  that an outstanding network operation
                                  is cancelled while waiting for a
                                  chunk. This discriminator is INCLUDED
                                  in the installed-live qualification.
DURABLE PROVENANCE ALIASES:       the alias map is LOCAL to the gate
                                  invocation. `ref-0` is a
                                  checkpoint-local correlation label, not
                                  a durable, independently resolvable
                                  provenance reference.
THE EVIDENCE-CONTINUITY EXPOSURE: unchanged and tracked separately as
                                  ACT-CLINEMM-EVIDENCE-CONTINUITY-
                                  REFERENCE-TRUST-01. A confidentiality
                                  defect is not documentary residue
                                  merely because it predates this ACT.
```

## The scope

One bounded correction cycle, exactly as the review authorised: *"No need
for another enormous ACT document."*

Nothing was built, packaged or installed. The predecessor evidence trees
were preserved unmodified. The architecture was not reopened: the
correction REMOVED a table rather than adding a layer, and it reused a
production mechanism rather than writing a new engine.

                                           0 consecutive blank lines
LINT/FORMAT                                biome check clean
```
