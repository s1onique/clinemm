# 04 — The candidate-contract comparison

```text
ACT: ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01
ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
```

Three narrow contracts were implemented as TEST-LOCAL modules and measured.
**No generic content scanner was built.** The ACT's own controls prove why:
a scanner cannot decide whether an arbitrary string is a secret (case S4).

| Implementation | File |
|---|---|
| Candidate A — closed structure | `output-trust-boundary/candidate-contracts.ts` (`renderClosedStructureRecord`, `validateClosedStructureProposal`) + `controlled-publication-gate.ts` (`gateClosedStructure`) |
| Candidate B — runtime attestation | `candidate-contracts.ts` (`attestToolObservation`) + `controlled-publication-gate.ts` (`gateRuntimeAttestation`) |
| Candidate C — explicit approval | `candidate-contracts.ts` (`evaluateApproval`, `digestRecordContent`, `consumeApproval`) + `controlled-publication-gate.ts` (`gateExplicitApproval`) |

## 4.1 — The decision matrix

| Gate | Closed structure | Runtime attestation | Explicit approval |
|---|---|---|---|
| Prevents automatic arbitrary free-text carry | **YES** — the proposal type has NO free-text field; the host assembles every published byte | **YES** — a candidate's text must be byte-equal to a runtime-attested string; an unattested string is rejected | **PARTIAL by design** — free text IS admitted, but only under an explicit, content-bound, session-bound, destination-bound, one-shot authorisation. It is not automatic |
| Preserves R4 | **YES** — both operations + the drift qualification are retained (`G5.1`) | **YES if the runtime attests the strings** — the same strings are admissible | YES — the operator authorises the exact text |
| Preserves R2 | **YES** — the implementation content, both timeouts and the unresolved production sender are retained (`G5.2`) | YES if attested | YES |
| Preserves R6 qualification | **YES** — the bounded scope and the unresolved external cleanup are retained; the record does NOT become "No token cleanup exists." (`G5.3`) | YES if attested | YES |
| Supports generic repositories | **YES** — proved by the unrelated synthetic TypeScript fixture (`G5.4`) | YES — the runtime attests whatever it observed | YES |
| Requires new trusted authority | **NO** — the runtime already owns the vocabulary and the canonical references | **YES, PARTIAL** — the runtime must be able to attest a string; for `run_commands` output it CANNOT, because the body is untrusted source content | **YES — a trusted operator/host authority that does not exist yet** |
| Runtime cost | **LOW** — one vocabulary lookup + one reference membership check per record; no second model call | **MEDIUM** — the runtime must classify each observed result and build the attested set | **HIGH** — a human/operator decision per checkpoint |
| Production complexity | **MEDIUM** — a new closed vocabulary in the checkpoint schema, plus the gate | **HIGH** — a new runtime classification concept and a per-result attestation pipeline | **HIGH** — a new approval store, approval UI, session binding and one-shot lifecycle |

## 4.2 — The key discriminator for each candidate

### Candidate A — closed structured knowledge

The model selects from runtime-owned vocabularies. The readable provider text
is assembled by the HOST from those vocabularies.

The DECISIVE property: **the proposal type has no field in which the model
can write.** There is nowhere to put a copied secret or a copied instruction.

```ts
export interface ClosedStructureProposal {
	readonly kind: "observation" | "hypothesis" | "decision" | "constraint" | "open_question";
	readonly assurance: "tool_observed" | "model_reported" | "unverified";
	readonly status: "active" | "superseded" | "unresolved";
	readonly atom: ObservationAtom;              // closed enum
	readonly argument?: RuntimeArgument;          // closed enum
	readonly qualificationClasses?: readonly QualificationClass[]; // closed enum
	readonly evidenceRefs: readonly string[];     // canonical references
}
```

Note what is NOT there: `statement`, `qualifications`, `id`. The identifier is
**minted by the gate**, so the model never names the record.

**The key discriminator the ACT was required to run:** "Can this represent
useful, generic working knowledge without hardcoding R1–R10?"

**YES**, and it is proved rather than asserted. `G5.1`–`G5.3` show R4, R2 and
R6 are retained in full; `G5.4` shows an unrelated synthetic TypeScript
project with the SAME four knowledge categories passes the SAME contract.

But the ACT also measured the LIMIT of Candidate A, and the limit is real:
the vocabulary must contain an atom for every category of observation the
system wants to carry. `ObservationAtom` has six members; a repository whose
working knowledge falls outside those six categories would lose it. That is
an ACCEPTED, DOCUMENTED cost of the contract, not a defect in it — and it is
a growth path (adding a runtime-owned atom), not a widening of the model's
authority.

### Candidate B — runtime-attested publication

The model proposes; the host decides.

The critical distinction the ACT enforces:

```text
Tool output was observed  !=  Tool output is safe to reproduce
```

`attestToolObservation()` returns a `RUNTIME_OBSERVED_STATUS` item for an
`UNTRUSTED_SOURCE_CONTENT` body — it attests that the command ran and how it
ended, and NOTHING about the body. Only a body the runtime has explicitly
classified as `RUNTIME_ATTESTED_CONTENT` contributes text, and even then only
as `EXPLICITLY_AUTHORISED_LITERAL`.

**`run_commands` output is NOT automatically blessed.** The ACT's own
implementation refuses it, and the `S1`–`S5` controls demonstrate why a
blessing would be a leak.

**The finding that decides Candidate B:** in the current ClineMM, the runtime
has NO existing mechanism that can attest that a tool result's body is
publishable. `resolveEvidenceReference()` is content-blind. The adjudicated
evidence-continuity machinery carries OPAQUE handles, not bodies. So
Candidate B, as an automatic contract, has NO admissible content source
beyond closed statuses — which collapses it into Candidate A with extra
machinery.

Candidate B therefore survives only as the **mechanism for an explicitly
authorised literal** — which is Candidate C's territory.

### Candidate C — explicitly approved free-text publication

The model proposes text; a trusted actor authorises EXACT content for EXACT
destinations in EXACT sessions.

```text
Exact record identity           -> approval.recordId
Exact accepted content identity -> approval.contentDigest (SHA-256)
Session binding                 -> approval.sessionId
Destination binding             -> approval.destination
One-shot scope                  -> approval.reusable === false, approval.consumed
No silent approval reuse        -> contentDigest is re-checked on every use
```

The ACT proved all five bindings independently in `ABLATION E`:

```text
content replaced after approval -> APPROVAL_CONTENT_IDENTITY_MISMATCH
one-shot approval consumed      -> APPROVAL_ALREADY_CONSUMED
different session               -> APPROVAL_SESSION_MISMATCH
different destination           -> APPROVAL_DESTINATION_MISMATCH
different record id             -> APPROVAL_RECORD_ID_MISMATCH
```

**This is NOT equivalent to default-on autonomous checkpointing.** It is a
restricted capability. And it requires a trusted authority that does not
exist in ClineMM today — a host or operator able to authorise content for
publication.

## 4.3 — The selection

```text
selected_contract: CANDIDATE A — CLOSED STRUCTURED KNOWLEDGE
```

**Decision basis, in the order the ACT establishes it:**

1. **It is the only candidate that is SAFE BY CONSTRUCTION.** The other two
   are safe only because a specific trusted authority exists and says yes.
   Candidate A needs no such authority for the automatic path.

2. **It is NOT VACUOUS.** `G5.1`–`G5.5` prove that R4's two operations, R2's
   implementation content and both timeouts, and R6's bounded negative with
   its qualifications are ALL retained, with
   `arbitrary_text_newly_persisted = 0` and
   `unsupported_claims_promoted = 0`. A contract that stores nothing useful
   would have failed G5; this one does not.

3. **It is GENERIC.** `G5.4` passes an unrelated synthetic TypeScript project
   through the same four knowledge categories.

4. **It is ENFORCEABLE WITHOUT A CONTENT SCANNER.** Every published byte is
   a runtime-owned string, so the decision "may this be published?" is a
   membership question, not a classification question. This is what makes S4
   (the opaque dummy) fail closed rather than pass.

5. **It needs the LEAST new authority.** Candidate B and Candidate C both
   require a trusted authority that ClineMM does not currently have.

### 4.3.1 — Candidate C is retained as a documented restricted capability

Candidate C's contract is proved and sound. The ACT does NOT discard it. It
is recorded as a **separately-considered restricted capability** whose
operational value is a question for a later, explicit decision:

```text
Candidate C is NOT part of the recommended automatic production contract.
Candidate C's authorization contract is PROVED (ABLATION E).
Whether to implement it as a user-facing capability is a SEPARATE decision
that requires an operator-authority design and a UI workflow, neither of
which this ACT is authorized to build.
```

This is why the ACT's recommended contract is A, while the exit verdict
records that the free-text capability is available **under explicit
authorisation only**.

### 4.3.2 — Candidate A's residual limits, stated honestly

```text
The closed vocabulary must grow to cover new knowledge categories.
A repository whose working knowledge falls outside the current six atoms
loses that knowledge.

This is a DOCUMENTED, BOUNDED loss. It is NOT a confidentiality failure:
the lost knowledge is not published unsafely, it is not published at all.

Mitigation in a future implementation ACT: the vocabulary is a runtime-owned
enum, so adding an atom is a schema addition, not a widening of the model's
authority.
```

## G3 exit

```text
GO_PCK_BOUNDED_PUBLICATION_CANDIDATE_SELECTED: CANDIDATE_A_CLOSED_STRUCTURE
```
