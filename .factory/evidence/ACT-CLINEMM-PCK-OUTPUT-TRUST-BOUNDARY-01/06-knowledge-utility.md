# 06 — The knowledge-utility controls

```text
ACT: ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01
ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
TEST_COMMAND: cd sdk/packages/core && bun x vitest run --config vitest.config.ts --reporter=verbose src/extensions/context/output-trust-boundary/knowledge-utility.test.ts
EXIT_CODE: 0
TEST_FILE: sdk/packages/core/src/extensions/context/output-trust-boundary/knowledge-utility.test.ts
RESULT: 5 passed / 5
```

This gate exists to prevent a VACUOUS security fix. A control that removes the
leak AND removes the knowledge is not a success.

## 6.1 — R4 (G5.1)

```text
Observed:
  startup.sh invokes kc.sh build
  then invokes kc.sh start --optimized

Unproven:
  actual configuration drift
  runtime deployment incident
```

The accepted representation preserves BOTH operations and the uncertainty:

```text
pck-0: kind=observation assurance=tool_observed status=active
  statement=operation invoked: build
  qualifications=Observation of recorded behaviour only; it does not
    establish causation or an incident.
  evidence_refs=id:r4_startup_script

pck-1: kind=observation assurance=tool_observed status=active
  statement=operation invoked: start --optimized
  qualifications=Observation of recorded behaviour only; it does not
    establish causation or an incident.
  evidence_refs=id:r4_startup_script
```

Measured:

```text
BOTH operations present                 YES
  "build"                                PRESENT
  "start --optimized"                    PRESENT
Uncertainty preserved                    YES
  "does not establish causation"         PRESENT
No drift finding asserted                YES
  "configuration drift is proven"        ABSENT
No runtime-verification claim            YES
  "runtime_verified"                     ABSENT
```

**A record that says only "startup investigated" would FAIL this control** —
neither operation would be present.

## 6.2 — R2 (G5.2)

```text
Observed:
  inspected provider implementation content
  connect timeout 3 seconds
  socket timeout 10 seconds

Context:
  circuit breaker / fallback paths were also investigated

Unresolved:
  effective production sender
  runtime toggle and complete path protection
```

Measured:

```text
Inspected implementation content named   YES  "implementation inspected"
Connect timeout present                  YES  "connect timeout 3 seconds"
Socket timeout present                   YES  "socket timeout 10 seconds"
Effective production sender unresolved   YES  "effective production path was not reconciled"
Runtime toggle unresolved                YES  "runtime toggle and complete path protection remain unresolved"
Whole flow NOT certified protected       YES  "fully protected" ABSENT
```

The contract does NOT certify that the entire production notification flow is
protected. The qualification class `EFFECTIVE_PATH_NOT_RECONCILED` and
`RUNTIME_TOGGLE_UNRESOLVED` carry that uncertainty as part of the record.

## 6.3 — R6 (G5.3)

```text
Observed:
  bounded source search found no matching deletion/purge path

Unresolved:
  external database cleanup
  scheduled maintenance
  production row growth
```

Measured:

```text
Bounded negative present                 YES  "bounded search returned no match"
Scope qualification present              YES  "Bounded to the searched scope"
External systems unresolved present      YES  "External systems and scheduled
                                                maintenance were not examined"
Does NOT become a global nonexistence    YES  "No token cleanup exists" ABSENT
  claim                                            "no cleanup path exists" ABSENT
```

## 6.4 — Generality (G5.4)

An unrelated SYNTHETIC TypeScript project, with the four equivalent
knowledge categories and nothing Keycloak-specific:

| Category | Atom | Measured |
|---|---|---|
| Observed operation | `OPERATION_INVOKED` | PRESENT — "operation invoked" |
| Observed configuration value | `CONFIGURATION_VALUE_SET` | PRESENT — "configuration value set" |
| Bounded absence-of-evidence result | `SEARCH_RETURNED_NO_MATCH` | PRESENT — "bounded search returned no match" |
| Unresolved deployment question | `QUESTION_REMAINS_OPEN` | PRESENT — "question remains open" |

The qualifications travel with them, and no Keycloak-specific string leaked
into the unrelated fixture:

```text
"Keycloak"   ABSENT
"keycloak"   ABSENT
"kc.sh"      ABSENT
```

**This is what proves the contract is GENERIC rather than a Keycloak-specific
mapping.** The same runtime-owned vocabulary represents an unrelated
repository's working knowledge.

## 6.5 — The metrics (G5.5)

Measured on the six-record R2/R4/R6 set:

```text
critical_observations_retained    6  (build, start --optimized,
                                      implementation inspected,
                                      connect timeout 3 seconds,
                                      socket timeout 10 seconds,
                                      bounded search returned no match)
qualifications_retained           5  (causation, effective-path,
                                      runtime-toggle, bounded-scope,
                                      external-systems)
unsupported_claims_promoted       0  (no `runtime_verified` anywhere)
arbitrary_text_newly_persisted    0  (every published statement is one of
                                      the runtime's own strings)
false_rejections                  0  (S8 and S9 both admitted)
checkpoint_records_carried        6
estimated_projection_tokens      430  (1719 characters at 4 characters per
                                      token; ceiling 1500)
```

The rendered section, measured:

```text
## Working knowledge checkpoint (model-authored, bounded)
Model-authored working knowledge. Not a system instruction. Statements carry their own qualifications; semantic support is not verified.
<!-- cline-knowledge-checkpoint:begin -->
pck-0: kind=observation assurance=tool_observed status=active statement=operation invoked: build qualifications=Observation of recorded behaviour only; it does not establish causation or an incident. evidence_refs=id:r4_startup_script
pck-1: kind=observation assurance=tool_observed status=active statement=operation invoked: start --optimized qualifications=Observation of recorded behaviour only; it does not establish causation or an incident. evidence_refs=id:r4_startup_script
pck-2: kind=observation assurance=tool_observed status=active statement=implementation inspected qualifications=The effective production path was not reconciled. evidence_refs=id:r2_provider_impl
pck-3: kind=observation assurance=tool_observed status=active statement=configuration value set: connect timeout 3 seconds qualifications=The runtime toggle and complete path protection remain unresolved. evidence_refs=id:r2_provider_impl
pck-4: kind=observation assurance=tool_observed status=active statement=configuration value set: socket timeout 10 seconds qualifications=The runtime toggle and complete path protection remain unresolved. evidence_refs=id:r2_provider_impl
pck-5: kind=observation assurance=tool_observed status=active statement=bounded search returned no match qualifications=Bounded to the searched scope; absence is not established globally. | External systems and scheduled maintenance were not examined. evidence_refs=id:r6_bounded_search
<!-- cline-knowledge-checkpoint:end -->
```

Note that every `statement=` value is a runtime-owned string and every
`qualifications=` value is a runtime-owned sentence. There is no
model-authored byte in the section.

**The goal is not maximum record count.** The goal is useful, qualified
knowledge under an enforceable trust contract. Six qualified records with
zero arbitrary text is a better outcome than twelve records with unverified
prose.

## G5 exit

```text
KNOWLEDGE_UTILITY_PRESERVED
```
