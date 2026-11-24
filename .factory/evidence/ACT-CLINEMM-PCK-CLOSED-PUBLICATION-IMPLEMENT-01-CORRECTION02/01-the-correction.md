# 01 — The correction

## The required invariant

```text
Evidence actually supports the COMPLETE RENDERED CLAIM
  -> tool_observed
otherwise
  -> model_reported
```

The COMPLETE RENDERED CLAIM is the ATOM's label joined with the
ARGUMENT's label: "operation invoked with argument: build". A runtime
that verifies only the atom, or only the tool class, has not verified the
proposition.

## What the correction changed, and what it REMOVED

### REMOVED — the atom/class table as a SUPPORT RULE

`OBSERVATION_ATOM_REQUIRED_CLASS` is no longer consulted to decide
support. It survives only as a DECLARED, CLOSED vocabulary so the
classification of an event stays inspectable and total.

### ADDED — one closed table of runtime-owned evidence

```ts
export const RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS: Readonly<
	Record<RuntimeArgument, readonly string[]>
> = Object.freeze({
	build: Object.freeze(["make build"]),
	start: Object.freeze([]),
	start_optimized: Object.freeze([]),
	connect_timeout_3s: Object.freeze([]),
	socket_timeout_10s: Object.freeze([]),
	none: Object.freeze([]),
});
```

### ADDED — the atoms the runtime can establish at all

```ts
export const DETERMINISTICALLY_ESTABLISHABLE_ATOMS: readonly ObservationAtom[] =
	Object.freeze(["OPERATION_INVOKED", "OPERATION_ARGUMENT_SET"] as const);
```

### ADDED — the command classifications of a canonical tool event

`CanonicalToolEvent` now carries `commandClassifications`, derived from
the call's OWN declared input through the production `classifyCommand()`.
The tool OUTPUT is never read: a classification is a property of what the
runtime was ASKED to run.

### CHANGED — the interpreter RECEIVES the argument

```ts
export function interpretCanonicalEvidence(input: {
	readonly canonicalMessages: readonly MessageWithMetadata[];
	readonly references: readonly string[];
	readonly atom: ObservationAtom;
	readonly argument?: RuntimeArgument;   // <-- NEW
}): BoundedAssurance | undefined
```

### CHANGED — the interpreter's decision

```ts
// (1) The atom must be establishable by deterministic runtime-owned
//     evidence at all.
if (!DETERMINISTICALLY_ESTABLISHABLE_ATOMS.includes(input.atom)) {
	return "model_reported";
}
// (2) The rendered ARGUMENT must be deterministically establishable.
if (input.atom === "OPERATION_ARGUMENT_SET" && argument === undefined) {
	return "model_reported";
}
const requiredClassifications =
	argument === undefined
		? []
		: (RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS[argument] ?? []);
// (3) A cited event must be a command execution whose own runtime-owned
//     classification is one the selected argument requires.
const supporting = events.some(
	(event) =>
		observed.includes(event.toolCallId) &&
		event.succeeded &&
		event.evidenceClass === "command_execution" &&
		event.commandClassifications.some((classification) =>
			requiredClassifications.includes(classification),
		),
);
```

### CHANGED — the publication gate threads the argument

`GateEvidence.maximumAssuranceFor` now takes the argument, and
`gateClosedProposals` passes `typed.argument` to it.

### CHANGED — the production attempt threads the argument

`runPckAttempt` passes the selected argument into the interpreter.

## WHY EACH ATOM IS OR IS NOT ESTABLISHABLE

```text
OPERATION_INVOKED       ESTABLISHABLE. The call's own production command
                        classification is deterministic runtime-owned
                        evidence for what was invoked.
OPERATION_ARGUMENT_SET  ESTABLISHABLE. Same, plus the argument: the
                        classification must be one the selected argument
                        requires.
CONFIGURATION_VALUE_SET  NOT ESTABLISHABLE. A configuration holding a
                        30-second timeout does not establish "connect
                        timeout 3 seconds". Deciding that needs a
                        semantic interpreter, which is out of scope.
IMPLEMENTATION_INSPECTED
                        NOT ESTABLISHABLE. A directory listing does not
                        establish that the implementation was inspected.
SEARCH_RETURNED_NO_MATCH
                        NOT ESTABLISHABLE. A search that returned 42
                        matches and a search that returned no matches are
                        indistinguishable to a class check.
QUESTION_REMAINS_OPEN   NOT ESTABLISHABLE. An absence of support is never
                        established by a tool.
```

## WHAT IS PRESERVED

```text
admitted working knowledge      every record is still published, with its
                                runtime-owned statement and qualifications
closed vocabulary               unchanged; no vocabulary expansion
opaque aliases                  unchanged; the gate still mints `ref-N`
default-off equivalence         unchanged; the disabled path is still
                                byte-identical
ordinary compaction behaviour   unchanged; the gate still runs before
                                either destination receives a candidate
content confidentiality         unchanged; every published byte is still a
                                runtime-owned constant
```

## WHAT WAS NOT DONE

```text
no new architecture
no vocabulary expansion
no general-purpose semantic verification engine
no evidence-continuity repair
no new diagnostic infrastructure
no build, no package, no install
```
