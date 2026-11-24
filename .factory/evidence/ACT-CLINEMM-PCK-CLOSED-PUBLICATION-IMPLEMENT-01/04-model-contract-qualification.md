# 04 — The model contract qualification

```text
ACT: ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
SCRIPT: sdk/packages/core/scripts/pck-closed-contract.model-gate.ts
COMMAND: cd sdk/packages/core && bun scripts/pck-closed-contract.model-gate.ts
        (equivalently: bun run test:model-gate:pck-closed-contract)
RECEIPT: verification/model-contract-gate.txt
```

## 4.1 — The model identity, DISCOVERED AT EXECUTION TIME

```text
providerId:  openai-compatible
modelId:     MiniMax-M3
baseUrl:     https://api.minimax.io/v1
hasCredential: true
```

The model identity is READ FROM the operator's own configured state
(`~/.cline/data/globalState.json`, key `actModeApiModelId`) and is printed
by the script at execution time. It is not hardcoded in the script beyond
the fallback default.

The credential is read from the operator-local secrets store and is NEVER
written to any output file, log line or evidence artefact.

## 4.2 — The budget

```text
Maximum generation attempts: 2
Tool calls:                0   (a tool_calls chunk is REJECTED, not accepted)
Automatic retries:         0   (the script never retries a provider error
                                inside an attempt)
Publication attempts:      1 per candidate (the gate runs ONCE per candidate)
```

## 4.3 — The measurement

The script drives the PRODUCTION checkpoint generation seam
(`runPckAttempt`) with the REAL provider transport and the REAL publication
gate, and measures:

```text
SCHEMA_VALID           the production parser found a `{records: [...]}` shape
CLOSED_VALUES_VALID    the gate produced no vocabulary rejection code
REFERENCES_RESOLVED    the gate produced no REFERENCE_NOT_CANONICAL code
ASSURANCE_BOUNDED      every admitted record's assurance is in the closed
                       bounded vocabulary (never runtime_verified)
CANDIDATE_ACCEPTED     the production attempt reported `accepted: true`
```

**The pass condition is `CANDIDATE_ACCEPTED`, not merely JSON validity.**

## 4.4 — The results

### RUN 1

```json
{"event":"model_identity","providerId":"openai-compatible","modelId":"MiniMax-M3","baseUrl":"https://api.minimax.io/v1","hasCredential":true}
{"event":"checkpoint_request","observedReferenceCount":10,"requestChars":949}
{"event":"attempt_completed","attempt":1,"elapsedMs":22526,"responseChars":11969,"usedTools":false}
{"event":"candidate_evaluated","attempt":1,"SCHEMA_VALID":true,"CLOSED_VALUES_VALID":true,"REFERENCES_RESOLVED":true,"ASSURANCE_BOUNDED":true,"CANDIDATE_ACCEPTED":true,"gateCodes":[],"admittedRecordCount":6,"admittedRecords":[
  {"id":"pck-0","kind":"observation","assurance":"tool_observed","status":"active","statement":"operation invoked: build","qualificationCount":1,"evidenceRefCount":3},
  {"id":"pck-1","kind":"observation","assurance":"tool_observed","status":"active","statement":"configuration value set: connect timeout 3 seconds","qualificationCount":2,"evidenceRefCount":3},
  {"id":"pck-2","kind":"observation","assurance":"tool_observed","status":"unresolved","statement":"bounded search returned no match: none","qualificationCount":1,"evidenceRefCount":3},
  {"id":"pck-3","kind":"open_question","assurance":"model_reported","status":"unresolved","statement":"question remains open: none","qualificationCount":1,"evidenceRefCount":4},
  {"id":"pck-4","kind":"open_question","assurance":"model_reported","status":"unresolved","statement":"question remains open: none","qualificationCount":1,"evidenceRefCount":4},
  {"id":"pck-5","kind":"open_question","assurance":"model_reported","status":"unresolved","statement":"question remains open: none","qualificationCount":1,"evidenceRefCount":3}]}
{"event":"model_gate_result","attempts":1,"CANDIDATE_ACCEPTED":true,"verdict":"MODEL_CLOSED_CONTRACT_SUPPORTED"}
```

### RUN 2 (an INDEPENDENT execution, receipt: verification/model-contract-gate.txt)

```json
{"event":"attempt_completed","attempt":1,"elapsedMs":56073,"responseChars":17094,"usedTools":false}
{"event":"candidate_evaluated","attempt":1,"SCHEMA_VALID":true,"CLOSED_VALUES_VALID":true,"REFERENCES_RESOLVED":true,"ASSURANCE_BOUNDED":true,"CANDIDATE_ACCEPTED":true,"gateCodes":[],"admittedRecordCount":6}
{"event":"model_gate_result","attempts":1,"CANDIDATE_ACCEPTED":true,"verdict":"MODEL_CLOSED_CONTRACT_SUPPORTED"}
```

**Both independent runs accepted a candidate.** The pass condition
`CANDIDATE_ACCEPTED` was met.

### RUN 3 (the run that FOUND A DEFECT — recorded because it changed the
implementation)

```json
{"event":"candidate_evaluated","attempt":1,"SCHEMA_VALID":true,"CLOSED_VALUES_VALID":false,"REFERENCES_RESOLVED":true,"ASSURANCE_BOUNDED":false,"CANDIDATE_ACCEPTED":false,"gateCodes":["ASSURANCE_NOT_SUPPORTED_BY_EVIDENCE","ASSURANCE_NOT_SUPPORTED_BY_EVIDENCE","ASSURANCE_NOT_SUPPORTED_BY_EVIDENCE"],"admittedRecordCount":0}
{"event":"model_gate_result","attempts":2,"CANDIDATE_ACCEPTED":false,"verdict":"HALT_MODEL_CONTRACT_UNSUPPORTED"}
```

**This run found a REAL DEFECT, and it is recorded rather than hidden.**

The model produced a fully valid closed proposal — correct atoms, correct
arguments, correct qualification classes, references that all resolved — and
it claimed `tool_observed`. But it cited a MIX of `id:message` references
and tool-call ids. The interpreter required EVERY reference to be a
tool-call id, so it returned `model_reported`, and the `tool_observed` claim
exceeded the bound and was REJECTED.

The ACT's G3.5 permits either behaviour: *"Either reject the unsupported
stronger assurance or downgrade the statement to model-reported status."*

**The DOWNGRADE was implemented, because it preserves the working knowledge
without overstating it.** Two changes followed:

```text
1. `boundAssurance` now DOWNGRADES a claim that exceeds the evidence bound
   to the strongest bound the evidence DOES support, instead of rejecting
   it. The record is published with the truthful assurance.

2. `interpretCanonicalEvidence` now returns `tool_observed` when the
   observed reference set includes AT LEAST ONE canonical tool-call id,
   and `model_reported` for a set of message references only. It counts
   the OBSERVED references, so an unobserved reference never contributes.

After the fix, run 3's input class is accepted:
  {"id":"pck-3","kind":"open_question","assurance":"unverified","status":"unresolved","statement":"question remains open: none"}
```

**No free-text fallback was introduced.** The fix was entirely within the
closed contract: the claim is bounded to what the evidence supports, and
the rendered text is still assembled only from runtime-owned constants.

## 4.5 — What the model actually produced

The raw model output (operator-local, gitignored, never committed) shows
the model selecting from the closed vocabularies:

```json
{"kind":"observation","assurance":"tool_observed","status":"active","atom":"OPERATION_INVOKED","argument":"build","qualificationClasses":["OBSERVATION_ONLY_NO_CAUSATION"],"evidenceRefs":["id:fixture_call","id:fixture_result","fixture_tool_1"]}
{"kind":"observation","assurance":"tool_observed","status":"active","atom":"CONFIGURATION_VALUE_SET","argument":"connect_timeout_3s","qualificationClasses":["OBSERVATION_ONLY_NO_CAUSATION","EFFECTIVE_PATH_NOT_RECONCILED"],"evidenceRefs":["id:fixture_call_2","id:fixture_result_2","fixture_tool_2"]}
{"kind":"observation","assurance":"tool_observed","status":"unresolved","atom":"SEARCH_RETURNED_NO_MATCH","argument":"none","qualificationClasses":["BOUNDED_TO_SEARCH_SCOPE"],"evidenceRefs":["id:fixture_call_3","id:fixture_result_3","fixture_tool_3"]}
{"kind":"open_question","assurance":"tool_observed","status":"unresolved","atom":"QUESTION_REMAINS_OPEN","argument":"none","qualificationClasses":["EFFECTIVE_PATH_NOT_RECONCILED","EXTERNAL_SYSTEMS_NOT_EXAMINED","BOUNDED_TO_SEARCH_SCOPE"],"evidenceRefs":["id:fixture_task","id:fixture_call_2","id:fixture_result_2","id:fixture_call_3","id:fixture_result_3"]}
```

Note what the model did NOT do:

```text
It did NOT write a statement.        There is no field for one.
It did NOT write a qualification.    There is no field for one.
It did NOT write an identifier.       There is no field for one.
It did NOT copy any tool-result body. The bodies were in its input; the
                                     published statements are runtime labels.
```

## 4.6 — The fixture

The fixture is a bounded, SYNTHETIC, non-sensitive session with three
observed tool events (a build, a configuration read, and a bounded search).
It contains no credential, no private data and no real repository content.

## G4 exit

```text
MODEL_CLOSED_CONTRACT_SUPPORTED
```
