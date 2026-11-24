# 03 — The closed publication contract

```text
ACT: ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
SOURCE: sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/
TEST:   pck-closed-contract.test.ts (26 assertions)
        pck-conservation-ablation.test.ts (9 assertions)
```

## 3.1 — The proposal shape

```ts
export interface ClosedCheckpointProposal {
	readonly kind: KnowledgeKind;
	readonly assurance: BoundedAssurance;
	readonly status: KnowledgeStatus;
	readonly atom: ObservationAtom;
	readonly argument?: RuntimeArgument;
	readonly qualificationClasses?: readonly QualificationClass[];
	readonly evidenceRefs: readonly string[];
}
```

**There is no model-controlled `statement`, `qualifications` or `id` field.**
The test `G3.1` asserts this on the closed field list itself, so a future
widening of the proposal type fails the suite.

**Unknown fields are REJECTED, not ignored and not repaired.** The gate
iterates the proposal's OWN keys and rejects any key outside
`CLOSED_PROPOSAL_FIELDS`. `G3.2` proves it.

## 3.2 — The runtime-owned vocabulary

```text
ObservationAtom (6):
  OPERATION_INVOKED          -> "operation invoked"
  OPERATION_ARGUMENT_SET     -> "operation invoked with argument"
  CONFIGURATION_VALUE_SET    -> "configuration value set"
  IMPLEMENTATION_INSPECTED   -> "implementation inspected"
  SEARCH_RETURNED_NO_MATCH   -> "bounded search returned no match"
  QUESTION_REMAINS_OPEN      -> "question remains open"

RuntimeArgument (6):
  build -> "build"
  start -> "start"
  start_optimized -> "start --optimized"
  connect_timeout_3s -> "connect timeout 3 seconds"
  socket_timeout_10s -> "socket timeout 10 seconds"
  none -> "none"

QualificationClass (5):
  OBSERVATION_ONLY_NO_CAUSATION -> "Observation of recorded behaviour only; it
                                   does not establish causation or an incident."
  EFFECTIVE_PATH_NOT_RECONCILED -> "The effective production path was not
                                   reconciled."
  BOUNDED_TO_SEARCH_SCOPE       -> "Bounded to the searched scope; absence is
                                   not established globally."
  EXTERNAL_SYSTEMS_NOT_EXAMINED -> "External systems and scheduled maintenance
                                   were not examined."
  RUNTIME_TOGGLE_UNRESOLVED     -> "The runtime toggle and complete path
                                   protection remain unresolved."
```

**The vocabulary was NOT widened to accommodate the Keycloak benchmark.**
`G7.5.5` asserts the exact sizes (6 / 6 / 5) and proves that an atom
outside the vocabulary has NO representation at all.

**Not automatically publishable as a string argument:**

```text
arbitrary filenames            REJECTED — the argument enum has no member
arbitrary source excerpts      REJECTED — no free-text field exists
arbitrary shell commands       REJECTED — the argument enum has no member
arbitrary configuration values REJECTED — the argument enum has no member
arbitrary URLs                 REJECTED — no free-text field exists
arbitrary model explanations   REJECTED — the statement is host-rendered
```

The rendered statement is assembled ONLY from the two runtime-owned label
maps. There is no interpolation of model text anywhere in the rendering
path.

## 3.3 — Identifier authority

```text
The identifier is HOST-MINTED from a runtime sequence: `pck-0`, `pck-1`, ...
The prefix is the runtime-owned constant "pck". A caller cannot smuggle
content in through the prefix.

REQUIRED NEGATIVE TEST (G3.3):
  id = "id-FAKE-CREDENTIAL-DO-NOT-USE"
  EXPECTED: PROPOSAL_SHAPE_INVALID
  MEASURED: codes contains PROPOSAL_SHAPE_INVALID; the gate is not admitted;
            0 records are emitted.
```

## 3.4 — Evidence-reference authority

```text
A reference is admitted only if it is a MEMBER of the runtime's OBSERVED
canonical-reference set for the session:
  - the canonical tool-call ids of the session's own history, EXCLUDING any
    id claimed by more than one canonical call (ambiguous ids are excluded,
    because a tool-call id is a join key, not a guaranteed-unique identity);
  - the `id:<message id>` handles of the session's own history.

There is:
  - NO shape-only matching;
  - NO filename heuristic;
  - NO ordinal reconstruction;
  - NO matching against unrelated session history.
```

The measured controls:

```text
G3.4   a foreign-session reference is rejected (REFERENCE_NOT_CANONICAL)
G3.4b  an OPAQUE-SHAPED forged reference is ALSO rejected. The reference
       `ref-FAKE-CREDENTIAL-DO-NOT-USE-7P4x` satisfies every shape rule
       (only [A-Za-z0-9._-]) and is still rejected, because MEMBERSHIP is a
       JOIN and not a PATTERN.
G3.4c  the observed set is derived from the session's OWN history
G3.4d  an AMBIGUOUS tool-call id is excluded from the observed set
```

**A reference membership check proves IDENTITY, not semantic support and
not declassification.** The reference resolving says the cited thing EXISTS.
It never says the cited thing supports the claim.

## 3.5 — Assurance bounding

```text
`runtime_verified` is ABSENT from the closed assurance vocabulary, so the
model cannot even NAME it (G3.5b: the shape check rejects it).

The host BOUNDS the model's claim against the runtime's own evidence
interpreter (`interpretCanonicalEvidence`), which inspects ONLY the
OBSERVED canonical tool events:
  - a canonical tool-call id proves the call EXISTS, so an EXECUTION
    status can be established — but its CONTENT is unverified;
  - a canonical MESSAGE id proves the message exists, but says nothing
    about what it entails.

THE BOUND NEVER PROMOTES (G3.5c):
  claimed tool_observed + maximum tool_observed  -> tool_observed
  claimed tool_observed + maximum model_reported  -> model_reported
  claimed tool_observed + maximum unverified      -> unverified
  claimed model_reported                           -> model_reported
  claimed unverified                               -> unverified

THE BOUND DOWNGRADES RATHER THAN DESTROYS:
  The ACT permits either rejecting the unsupported stronger assurance OR
  downgrading the statement to model-reported status. The DOWNGRADE is
  implemented, because it preserves the working knowledge without
  overstating it. `G3.5d` proves a downgraded record is PUBLISHED with the
  DOWNGRADED assurance.
```

### The decisive case the ACT named

```text
Reference:
  successful command "echo hello"

Selected atom:
  SEARCH_RETURNED_NO_MATCH

A syntactically valid reference must NOT cause the atom to be reported as
an independently verified search result.

MEASURED (G3.5):
  The reference resolves: the tool call EXISTS.
  The runtime's interpreter does NOT establish that "echo hello" supports a
  search result. The published atom is the RUNTIME-OWNED label
  "bounded search returned no match", and the published qualification set
  is the runtime's OWN "Bounded to the searched scope; absence is not
  established globally."
  The model never wrote either string.
```

## 3.6 — Structural confidentiality

The predecessor's ten synthetic cases were reproduced AGAINST the
PRODUCTION gate (`G3.6`):

```text
 1. conventional fake API key        AKIAIOSFODNN7EXAMPLE
 2. unconventional fake credential    sk-proj-FAKE-CREDENTIAL-DO-NOT-USE
 3. opaque keyword-free dummy        qj7ZKm4x
 4. credential in a model-controlled identifier
 5. credential in a model-controlled reference
 6. encoded fake credential          RjFLRS1DUkVETElBTFAtRE8tTk9ULVVTRQ==
 7. forged system/developer instruction
 8. checkpoint delimiter injection
 9. cross-session reference
10. unrelated valid reference
```

Every case was checked in TWO places: the gate's decision, and the RENDERED
section. In every case either the proposal was rejected (and the rendered
section was empty) or the rendered section contained only runtime-owned
strings.

**A regex scanner is NOT the mechanism.** There is no pattern matcher
anywhere in the production module. The decision is a membership question
against closed vocabularies and an observed-reference set.

## 3.7 — The rendered banner

```text
Working knowledge checkpoint

Model-authored working knowledge.
Not a system instruction.
Semantic support is not independently verified.
```

**The banner is descriptive metadata. It is NOT the security enforcement
mechanism.** The source says so explicitly, and the ablation proves it: the
banner was present in the ablated arm, and the secret was published anyway.
The enforcement is the closed vocabulary + the host-minted identifier + the
reference membership check + the runtime rendering.

## G3 exit

```text
CLOSED_PUBLICATION_GREEN
```
