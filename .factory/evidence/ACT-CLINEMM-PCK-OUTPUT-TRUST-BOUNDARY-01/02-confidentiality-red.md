# 02 — The confidentiality RED

```text
ACT: ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01
ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
TEST_COMMAND: cd sdk/packages/core && bun x vitest run --config vitest.config.ts --reporter=verbose src/extensions/context/output-trust-boundary/confidentiality-red.test.ts
EXIT_CODE: 0
TEST_FILE: sdk/packages/core/src/extensions/context/output-trust-boundary/confidentiality-red.test.ts
RESULT: 9 passed / 9
```

## 2.1 — The fixture is FULLY SYNTHETIC

No real credential, no real session and no real repository content is
involved. The canonical history, the tool-call id, the tool-result body and
the "secret" are all invented.

```ts
export const SYNTHETIC_DUMMY_SECRET = "FAKE-CREDENTIAL-DO-NOT-USE-7P4x";
export const SYNTHETIC_OPAQUE_DUMMY = "qj7ZKm4x";
export const SYNTHETIC_VALID_TOOL_CALL_ID = "call_VALID";
```

The synthetic canonical fixture:

```text
assistant msg_synthetic_call
  tool_use id=call_VALID name=run_commands input={command:"cat deployment.env"}

user msg_synthetic_result
  tool_result tool_use_id=call_VALID
    content=[{query:"cat deployment.env",
              result:"# deployment configuration (synthetic)\nDB_PASSWORD=FAKE-CREDENTIAL-DO-NOT-USE-7P4x\nservice=payments-api",
              success:true}]
```

`call_VALID` genuinely EXISTS in the fixture, and it is UNIQUE, so the
predecessor's `collectCanonicalToolCallIds()` includes it and the reference
resolver resolves it. The execution status is successful.

## 2.2 — The candidate

```ts
const candidate = {
	id: "checkpoint-001",
	kind: "observation",
	assurance: "tool_observed",
	status: "active",
	statement: "The deployment configuration contains FAKE-CREDENTIAL-DO-NOT-USE-7P4x",
	qualifications: ["Copied from a tool result; not independently verified"],
	evidenceRefs: ["call_VALID"],
};
```

## 2.3 — The measured results

| Boundary | Result | Evidence label |
|---|---|---|
| Credential in the tool result | **PRESENT** | SYNTHETIC |
| Credential in the model-authored statement | **PRESENT** | SYNTHETIC |
| Schema-valid candidate | **YES** — the existing schema accepts the text; it bounds length (240 chars) and count, not content | SYNTHETIC_REAL |
| Reference resolution | `identityResolved: true` | REAL (predecessor's `resolveEvidenceReference`) |
| Semantic support | `semanticSupportVerified: false` | REAL |
| Assurance bounded | **YES** — `boundAssurance({claimed:"runtime_verified"})` → `"tool_observed"` | REAL |
| Credential in the rendered checkpoint section | **PRESENT — DEFECT** | REAL (the REAL exported `renderCheckpointSection()`) |
| Credential in the persisted summary projection | **PRESENT — DEFECT** | REAL (`applyCheckpointSectionToSummary()`) |
| Credential in the provider-visible continuation | **PRESENT — DEFECT** | REAL_PRODUCTION_SEAM (`createSessionCompactionState()` + `MessageBuilder.buildForApi()`) |

The actual function exercised is the predecessor's **REAL exported**
`renderCheckpointSection()` from
`sdk/packages/core/src/extensions/context/source-visibility-discriminator/projection.ts:84`.
The defect was NOT reproduced through a handwritten imitation.

The provider-visible and persisted rows are measured in
`production-seam.test.ts` and reported in
`08-persistence-and-provider-projection.md`.

## 2.4 — The non-vacuity argument (G2.4)

A leak assertion that also fires when the content is simply ABSENT would
prove nothing. The suite therefore varies ONLY the secret's presence while
the record count, the record length and the field structure stay constant.

```text
G2.1.5  removing the secret from `statement`
          -> the leak assertion STOPS firing
          -> the record is STILL rendered:
             "statement=The deployment configuration was inspected."
             "assurance=tool_observed"
        So the earlier assertion did not fire because the record was omitted
        by a token budget or a size limit.

G2.1.6  the same content moved into `qualifications[]`
          -> the leak assertion STILL FIRES
        So the remaining publication path is detected.

G2.1.7  the OPAQUE dummy (no recognisable keyword)
          -> the leak assertion STILL FIRES
        This is the decisive case against a secret-pattern scanner.

G2.1.8  the secret embedded in the record id AND in the evidence-reference
          -> the leak assertion STILL FIRES
        So the leak is not an artefact of one particular field.

G2.1.9  the section is APPENDED to the ordinary summary
          -> the ordinary content is NOT lost
        So the leak is an ADDITION, not a substitution.
```

### 2.4.1 — The vocabulary is not a seed

The ACT does NOT use only `DB_PASSWORD=` as the discriminator. The cases are
listed in `05-security-negative-controls.md` and cover a conventional fake
API key, an unconventional Markdown credential, a connection URI with a fake
password, an opaque keyword-free dummy, a copy in `qualifications[]`, a copy
in the identifier/reference, an encoded form, a split form, a benign 40-hex
revision, a benign absolute path, and an ordinary technical observation.

## 2.5 — Why the existing protections do not prevent this

```text
MAX_CARRIED_CHECKPOINT_RECORDS = 12      -> a size limit
MAX_CARRIED_CHECKPOINT_LINE_CHARS = 320  -> a size limit
CHECKPOINT_LIMITS.MAX_STATEMENT_CHARS = 240 -> a size limit
```

A 28-character dummy secret fits in every one of them. A size limit bounds
the CARRIER; it says nothing about whether the CARRIED content may be
published. The ACT measured this: the secret is short, and it is published
in full.

## G2 exit

```text
RED_OUTPUT_TRUST_BOUNDARY_REPRODUCED
```
