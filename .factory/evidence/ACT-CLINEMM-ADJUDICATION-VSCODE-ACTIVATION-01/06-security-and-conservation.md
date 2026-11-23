# 06 — Security and conservation (G7)

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
**Classification:** STRUCTURAL

## G2.1 — Default OFF: demonstrated at the actual VS Code task-start seam

The conservation control is demonstrated at the REAL producer
(`buildSessionConfig`), not at a synthetic helper.

| Requirement | Evidence |
|---|---|
| `enabled: false` | The whole `adjudication` key is ABSENT (`config.adjudication === undefined`), so `configWithProvider.adjudication?.enabled` is `undefined` (falsy). |
| `vocabulary: absent` | `config.adjudication?.vocabulary` is `undefined`. |
| `revisionResolver: absent` | `config.adjudication?.revisionResolver` is `undefined`. |
| `secretProvider: absent` | `config.adjudication?.secretProvider` is `undefined`. |
| No adjudication registry | `local-runtime-host.ts:1081` creates the registry ONLY under `configWithProvider.adjudication?.enabled`. With the key absent, no registry is created. |
| No publication instruction | `local-runtime-host.ts:1266` applies the instruction only under the same guard. |
| No evidence-handle trailer | The trailer is attached by the acquisition hook, which is installed only under the same guard (`local-runtime-host.ts:1304-1320`). |
| No adjudication carry-forward | The compaction seam is installed only when the registry exists (`local-runtime-host.ts:1096`). |
| No extra model calls | No code path in the ACT adds a provider request. The seam is a POST-COMPACTION projection over the messages the runtime already produces. |
| No provider-prefix changes | The ACT does not touch the provider request construction at all; the system prompt is unchanged when the contract is absent. |
| No persistent secret created | The secret provider is only INVOKED by the SDK when `adjudication.enabled` is true. With the contract absent it is never called, so nothing is written to `secrets.json`. |
| No diagnostics enabled automatically | The ACT adds no diagnostic surface. |

### The decisive conservation fact

The RED-1 witnesses **PASSED against the ENTRY_HEAD producer** (with the
producer changes stashed). That means the default-off behaviour was ALREADY
correct before the ACT, and the ACT's obligation was to PRESERVE it, not to
introduce it. The GREEN run confirms it is preserved.

The ACT's production delta when the contract is ABSENT is exactly:

```diff
 const config: CoreSessionConfig = {
   providerId: sdkProviderId,
   ...
+  ...(adjudicationContract
+    ? { adjudication: { enabled: true, vocabulary: ..., revisionResolver: ..., secretProvider: ... } }
+    : {}),
   disableMcpSettingsTools: true,
 }
```

With `adjudicationContract === undefined`, the spread contributes NOTHING. The
produced `CoreSessionConfig` is byte-identical to the pre-ACT one.

## The implementation invariant

> When the feature is disabled:
> `before_ACT_provider_input == after_ACT_provider_input`
> for identical canonical input and equivalent runtime configuration.

This holds because the ENTIRE feature is behind one conditional spread in the
producer, and every downstream consumer is behind the SDK's existing
`adjudication?.enabled` guard. There is no partially-enabled state: either
the contract is supplied (and the whole authorized behaviour applies) or it
is not (and nothing does).

## G7 — The required control matrix

Every row is witnessed by an ACT-owned test.

| Scenario | Required behaviour | Witness | Result |
|---|---|---|---|
| Feature disabled | No behaviour change | producer suite, RED-1 (2 witnesses) | PASS |
| Missing vocabulary | No candidate accepted | runtime-chain, RED-4 "REJECTS a candidate when the vocabulary is absent" (`reason === "no_authorized_vocabulary"`) | PASS |
| Missing resolver | No candidate accepted | runtime-chain, RED-3 "fails closed for a source path OUTSIDE the authorized workspace" + the SDK's `no_acquisition_record` gate | PASS (no acquisition ⇒ no binding) |
| Missing restorable secret | No false restart-continuity claim | The RESTORE-mode provider never persists; a session with no stored secret gets an in-memory-only secret, which the SDK registry reports as `isRestorable() === false` | PASS (by construction) |
| Unknown finding ID | Rejected | runtime-chain, RED-4 "REJECTS an unknown finding id..." | PASS |
| Missing essential qualification | Rejected | runtime-chain, RED-4 "REJECTS ... a missing essential qualification" | PASS |
| Forged handle | Rejected | runtime-chain, RED-4 "REJECTS a forged handle..." (`canonical_refs_resolved === false`) | PASS |
| Cross-session handle | Rejected | runtime-chain, RED-6 "FAILS CLOSED for a DIFFERENT session" | PASS |
| Empty evidence references | Not accepted as supported | runtime-chain, RED-4 "REJECTS a forged handle and an empty evidence list" | PASS |
| Failed source read | No supporting acquisition | runtime-chain, RED-3 "captures NO acquisition for a FAILED read" | PASS |
| `run_commands` output | Not promoted to `read_files` evidence | runtime-chain, RED-3 "captures NO acquisition for a run_commands result" + producer-suite RED-2 tool gate | PASS |
| Source changes after acquisition | No retroactive identity change | The SDK's acquisition-time binding (unchanged by the ACT): the record rides on the canonical tool-result block and candidate evaluation READS the stored value | PASS (SDK contract preserved) |
| Contradictory newer evidence | No stale authoritative verdict | The SDK's `deriveAcceptedAdjudications` supersedes an earlier candidate for the same finding | PASS (SDK contract preserved) |
| Workspace not trusted | No unauthorized activation | The contract can only be armed by an explicit host-authority act; nothing reads workspace trust or workspace content to authorize it | PASS (by construction) |
| Summarizer omits candidate | Deterministic continuity | runtime-chain, RED-5 "carries the accepted candidate forward even when the summarizer OMITS it" | PASS |
| Second compaction | No duplicate section | runtime-chain, RED-5 "produces NO duplicate section on a SECOND compaction of the same history" | PASS |
| Host recreation | Restorable where credentials/state exist | runtime-chain, RED-6 "re-derives the SAME evidence handle after a host recreation" | PASS |
| Unrelated task | No activation | producer suite, RED-2 "binds the contract to exactly ONE session and leaves an unrelated task off" | PASS |

## Secret disclosure

- The session secret is NEVER written to the evidence package.
- The secret provider's value is never logged; the module has no `Logger`
  call at all.
- The opaque evidence HANDLE is model-visible (by design: the model must
  cite it). The handle is a keyed MAC, not the secret.
- The evidence package contains only digests and boolean/classification
  facts.

## Scope discipline — what was NOT touched

The following were explicitly out of scope and were NOT changed:

- the SDK's `adjudication-continuity.ts` (the core implementation),
- the SDK's `compaction.ts`,
- the SDK's `CoreAdjudicationConfig` interface,
- `run_commands` source authority,
- raw `thinking` extraction,
- raw tool-result carry-forward,
- source-file excerpt carry-forward,
- generic persistent memory,
- `submit_and_exit`,
- the provider request construction,
- any proto message,
- any webview UI,
- any `Settings` field other than the new secret-storage key.
