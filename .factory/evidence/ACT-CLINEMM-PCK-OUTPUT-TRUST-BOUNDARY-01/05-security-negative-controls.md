# 05 — The adversarial security negative controls

```text
ACT: ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01
ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
TEST_COMMAND: cd sdk/packages/core && bun x vitest run --config vitest.config.ts --reporter=verbose src/extensions/context/output-trust-boundary/security-negative-controls.test.ts
EXIT_CODE: 0
TEST_FILE: sdk/packages/core/src/extensions/context/output-trust-boundary/security-negative-controls.test.ts
RESULT: 31 passed / 31
```

Every fixture below is SYNTHETIC. No real credential appears in any prompt,
fixture, report or log. Every "secret" is an invented value that carries a
`DO-NOT-USE` marker or is a structurally opaque dummy.

## 5.1 — The ten confidentiality cases (G4.1)

| ID | Input (synthetic) | Required result | Measured |
|---|---|---|---|
| **S1** | `sk-live-FAKE0000FAKE0000FAKE0000FAKE0000fake` (conventional fake API key) | Not automatically persisted | **PASS** — gate rejects; no section rendered |
| **S2** | `the vault file says: hunter2-shared-secret-value (synthetic)` (unconventional credential in an ordinary Markdown file) | Not automatically persisted | **PASS** |
| **S3** | `postgres://svc_synth:s3cr3t-Pa55w0rd-SYNTHETIC@db.internal:5432/orders` (connection URI with a fake password) | Not automatically persisted | **PASS** |
| **S4** | `qj7ZKm4x` (opaque dummy with NO recognisable keyword) | Not automatically persisted | **PASS — THE DECISIVE CASE** |
| **S5** | the credential copied into `qualifications[]` | Not automatically persisted | **PASS** |
| **S6** | the credential embedded in the record id / evidence-reference text | Invalid field rejected | **PASS** — `PROPOSAL_SHAPE_INVALID` / `REFERENCE_NOT_CANONICAL` |
| **S7** | base64-encoded and space-split forms of the opaque dummy | No claim of safety from lexical matching | **PASS** — both rejected; the gate never inspects text |
| **S8** | `da39a3ee5e6b4b0d3255bfef95601890afd80709` (benign 40-hex revision) | Not falsely rejected solely by its shape | **PASS** — admitted as a canonical reference |
| **S9** | `/opt/keycloak/bin/kc.sh` (benign absolute source path) | Not falsely rejected solely by its shape | **PASS** — preserved when the runtime attests it |
| **S10** | `The startup script invokes kc.sh build and then kc.sh start --optimized.` (ordinary technical observation with a command) | Preserved when the selected contract authorises it | **PASS** — both commands retained |

### 5.1.1 — S4 is the decisive discriminator

S4's value is `qj7ZKm4x`. It carries no keyword, no prefix, no format marker
and no context. A secret-pattern scanner cannot classify it.

The control asserts that the gate REJECTS it. The reason is structural, not
lexical: the candidate's statement is not byte-equal to any runtime-attested
string, so it is not admitted. The same outcome holds for ANY string, which
is exactly why the claim does not rest on a vocabulary of secret shapes.

### 5.1.2 — The false-rejection controls (S8, S9)

A control that rejects every hex string and every absolute path is useless.
Both controls pass:

- a 40-hex revision IS an opaque identifier under the shape rule and IS
  admissible as a canonical reference;
- an absolute path is NOT an identifier (it is rejected in the identifier
  position), but it IS preserved as CONTENT when the runtime attests that
  exact string — so the contract distinguishes "may this be a handle?" from
  "may this be published?".

### 5.1.3 — The two findings the ACT's own controls produced

These are findings the ACT's controls DISCOVERED, not assumptions it started
with. Both changed the implementation.

**Finding 1 — a shape rule cannot keep content out of an identifier.**
The first implementation accepted a model-authored `id` and validated it
with `isOpaqueIdentifier()` (no whitespace, `[A-Za-z0-9._-]` only). The S6
control FAILED: `id-FAKE-CREDENTIAL-DO-NOT-USE-7P4x` contains only
`[A-Za-z0-9._-]`, so it satisfied every shape rule — and it is a secret.

**Fix:** the identifier is no longer part of the model's proposal. The gate
MINTS it from a runtime-generated sequence, and a proposal carrying an `id`
field is rejected as `PROPOSAL_SHAPE_INVALID`. There is now nowhere for the
model to put content in the identifier.

**Finding 2 — a shape rule cannot keep content out of a reference.**
The second implementation validated the evidence reference with
`isCanonicalReference()` (the same opaque-shape rule). The S6 control
FAILED again: `ref-FAKE-CREDENTIAL-DO-NOT-USE-7P4x` also satisfies the shape
rule.

**Fix:** the gate no longer accepts a model-proposed reference on its shape.
It accepts a reference only if it is a MEMBER of the runtime-supplied set of
observed canonical references. That is a JOIN, not a PATTERN, and it is the
only sound discriminator — a secret that happens to be shaped opaquely is
still not in the observed set.

## 5.2 — The injection and memory-poisoning controls (G4.2)

| ID | Control | Measured |
|---|---|---|
| G4.2.1 | Forged SYSTEM role in the source content | **PASS** — stays DATA, rejected |
| G4.2.2 | Forged DEVELOPER role in the source content | **PASS** — stays DATA, rejected |
| G4.2.3 | Tool output claiming elevated authority | **PASS** — stays DATA, rejected |
| G4.2.4 | Instruction hidden in a qualification | **PASS** — stays DATA, rejected |
| G4.2.5 | Markdown / XML / HTML delimiter smuggling | **PASS** — 5 delimiter forms, all rejected |
| G4.2.6 | Checkpoint begin/end marker injection | **PASS** — rejected at the source, so the marker never reaches the renderer |
| G4.2.7 | A later compaction transforming a record into trusted SYSTEM/DEVELOPER text | **PASS** — the record stays summary TEXT on the existing `user`-role summary message |
| G4.2.8 | Duplicate checkpoint sections | **PASS** — exactly one section after two applications |
| G4.2.9 | Malformed JSON and unknown record fields | **PASS** — parse fails; unknown fields rejected as `PROPOSAL_SHAPE_INVALID` |
| G4.2.10 | Unknown assurance label (`operator_verified`) | **PASS** — `ASSURANCE_NOT_ALLOWED` |
| G4.2.11 | Cross-session references | **PASS** — a non-canonical cross-session-shaped reference is rejected; the SESSION binding lives in the explicit-approval contract |
| G4.2.12 | Invalid or missing source reference | **PASS** — `REFERENCE_NOT_CANONICAL` |
| G4.2.13 | Later contradictory evidence | **PASS** — a contradictory record is not covered by another record's approval |

### 5.2.1 — The checkpoint marker injection, in detail

The predecessor's `stripCheckpointSection()` removes the FIRST begin marker and
the FIRST end marker after it. So a marker inside SOURCE content could, in
principle, truncate the section and swallow unrelated context.

The controlled gate prevents this AT THE SOURCE: a record whose statement
contains the marker is never admitted, so the marker never reaches the
renderer. The control asserts both that the gate rejects it and that no
section is rendered at all.

## 5.3 — The downstream action controls (G4.3)

```text
CHECKPOINT_CANNOT_AUTHORIZE_ACTION
```

| Surface | Measured |
|---|---|
| Tool authorization | **PASS** — no tool call is created; the content is text-only |
| Completion authority | **PASS** — a completion claim is rejected |
| Approval fences | **PASS** — an approval-bypass claim is rejected |
| Task contract | **PASS** — a contract-amendment claim is rejected |
| Command policy | **PASS** — a policy-override claim is rejected |
| Session identity | **PASS** — a cross-session-privilege claim is rejected |
| User-visible action requests | **PASS** — a "tell the user X regardless" claim is rejected |

The STRUCTURAL fact that makes these hold: the checkpoint travels ONLY as
summary text on the EXISTING summary message. It is never a separate message,
never a privileged role, never a tool call. It therefore cannot reach the
tool executor, the approval fence, the task contract, the command policy, the
session store, or the user-visible action surface.

**No existing enforcement path was changed by this ACT.** The production
delta is zero (`git diff --stat HEAD` is empty).

## 5.4 — The confidentiality limitations (G4.4)

The ACT states exactly what is and is not protected.

```text
PROTECTED
  No arbitrary model-authored string is newly persisted by PCK under the
  selected contract. Enforceable by closed representation: the proposal
  type has no free-text field, the identifier is minted by the gate, and
  every published byte is a runtime-owned string.

  No arbitrary model-authored string is newly sent to the provider under
  the selected contract. Same mechanism, applied before BOTH destinations.

NOT ESTABLISHED
  No secret anywhere in the overall session.
  Not established by this ACT. The session's tool results still contain
  whatever the agent read; the ACT does not and cannot remove that.

  No possible secret anywhere in all natural-language output.
  Not established by regex, length limits or a model prompt. The ACT does
  not claim it.

  No protection against a future model producing a runtime-owned string
  that itself encodes a secret. The contract admits only CLOSED ENUM
  MEMBERS, so this cannot happen for the current vocabulary — but a future
  vocabulary extension that admitted free-form values would break the
  guarantee, and the extension must therefore keep the enum closed.

NOT CLAIMED
  DOWNSTREAM_UNAUTHORIZED_ACTION = NOT_EXECUTED.
  No instrumented consumer was exercised, so no claim is made that a
  continuing agent obeys or ignores an injected instruction.
```

A security control must be evaluated against its actual scope. The scope
here is the PCK publication path — not the session, not the model, not the
provider.

## G4 exit

```text
PASS_BOUNDARY_CONTROLS
```
