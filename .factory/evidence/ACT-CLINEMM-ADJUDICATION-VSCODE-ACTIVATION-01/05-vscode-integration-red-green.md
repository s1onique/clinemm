# 05 — VS Code integration RED → GREEN (G5, G7)

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
**Classification:** STRUCTURAL

## The two suites

| Suite | File | Config | Witnesses |
|---|---|---|---|
| Producer | `apps/vscode/src/sdk/__tests__/adjudication-vscode-activation01.test.ts` | `vitest.config.ts` (base) | 5 |
| Runtime chain | `apps/vscode/src/sdk/__tests__/adjudication-vscode-activation01.runtime-chain.c24-c-bridge.test.ts` | `vitest.config.c2-4-c-bridge.ts` | 13 |
| | | **TOTAL** | **18** |

The runtime-chain suite lives under the EXISTING C2-4-C bridge domain rather
than a new config, so there is ONE bridge alias table and no drift. The
repository's own `RBE01` config-contract invariant
(`test-domain-config-contract.rbe01.test.ts`) enforces the pairing between a
bridge vitest config and its bridge tsconfig; the ACT's test was added to
BOTH sides of the existing pair, which also REPAIRED one previously-failing
RBE01 assertion ("every bridge tsconfig include is in the BRIDGE vitest
include" now passes).

## RED-1 — Disabled by default (CONSERVATION CONTROL)

**Production seam:** `buildSessionConfig()` in
`apps/vscode/src/sdk/cline-session-factory.ts`.

```ts
const config = await buildSessionConfig({ cwd: "..." })

expect(config.adjudication).toBeUndefined()
expect(config.adjudication?.enabled).toBeUndefined()
expect(config.adjudication?.vocabulary).toBeUndefined()
expect(config.adjudication?.revisionResolver).toBeUndefined()
expect(config.adjudication?.secretProvider).toBeUndefined()
```

and, separately:

```ts
expect(config.systemPrompt ?? "").not.toContain("cline-adjudication")
expect(config.systemPrompt ?? "").not.toContain("adjudication_candidate")
```

**Result at ENTRY_HEAD:** PASSED (with the producer changes stashed).
**Result after the implementation:** PASSED.

This is the conservation control the ACT asks for: it already passed before
the change and still passes after it.

## RED-2 — Explicit opt-in reaches the runtime (THE POSITIVE PATH)

```ts
getAdjudicationTaskContractStore().arm({ vocabulary: AUTHORIZED_VOCABULARY })

const config = await buildSessionConfig({ cwd: workspaceRoot })

expect(config.adjudication).toBeDefined()
expect(config.adjudication?.enabled).toBe(true)
expect(config.adjudication?.vocabulary).toEqual(AUTHORIZED_VOCABULARY)
expect(typeof config.adjudication?.revisionResolver?.resolve).toBe("function")
expect(typeof config.adjudication?.secretProvider).toBe("function")
```

**Result at ENTRY_HEAD:** FAILED (`expected undefined to be defined`).
**Result after the implementation:** PASSED.

Plus the boundary controls:

```ts
// A path OUTSIDE the authorized workspace has no source identity.
expect(await resolver.resolve({ sourcePath: outsidePath, toolName: "read_files" })).toBeUndefined()

// A non-source-observing tool has no source authority.
expect(await resolver.resolve({ sourcePath: insidePath, toolName: "run_commands" })).toBeUndefined()
```

Plus the session-scoping control:

```ts
expect(store.consumeForSession("session-A")).toBeDefined()
expect(store.getBound("session-B")).toBeUndefined()
expect(store.consumeForSession("session-B")).toBeUndefined()
expect(store.hasArmed()).toBe(false)
```

## RED-3 — Real source observation

Drives the REAL SDK `captureAcquisitionEvidence` with the REAL VS Code
resolver against a REAL, tiny, synthetic git repository (a temp directory
with one file and one commit).

| Witness | Assertion | Result |
|---|---|---|
| captures an acquisition record | `acquisition.sourcePaths === ["synthetic/pool-config.ts"]` | PASS |
| | `acquisition.revision.revision` matches `/^[0-9a-f]{40}$/` | PASS |
| | `acquisition.contentIdentities.size === 1` | PASS |
| | `workspaceRootIdentity` is a 64-hex digest and does NOT contain the absolute workspace path | PASS |
| | `repositoryIdentity` is a 64-hex digest | PASS |
| captures NO acquisition for a `run_commands` result | `acquisition === undefined` | PASS |
| captures NO acquisition for a FAILED read | `acquisition === undefined` | PASS |
| fails closed OUTSIDE the authorized workspace | `acquisition === undefined` | PASS |

## RED-4 — Candidate acceptance (C1)

Drives the REAL SDK `parseAdjudicationEnvelope` and `resolveAdjudicationCandidate`
with the REAL registry, the REAL acquisition ledger and the REAL vocabulary.

| Witness | Assertion | Result |
|---|---|---|
| accepts a candidate citing the ACTUAL observed handle | `schema_valid === true` | PASS |
| | `canonical_refs_resolved === true` | PASS |
| | `source_revision_bound === true` | PASS |
| | `candidate_accepted === true`, `reason === undefined` | PASS |
| | `author === "MODEL"`, `authority === "PROVISIONAL"` | PASS |
| | `semantic_support_verified === false` (no independent adjudicator exists) | PASS |
| REJECTS a forged handle | `candidate_accepted === false`, `canonical_refs_resolved === false` | PASS |
| REJECTS an empty evidence list | `candidate_accepted === false` | PASS |
| REJECTS an unknown finding id | `candidate_accepted === false` | PASS |
| REJECTS a missing essential qualification | `candidate_accepted === false` | PASS |
| REJECTS a candidate with NO vocabulary | `candidate_accepted === false`, `reason === "no_authorized_vocabulary"` | PASS |

The handle is the REAL one minted by the registry from the ACTUAL observed
tool-call id:

```ts
expect(handle).toMatch(/^cline-ev-[0-9a-f]{16}$/)
```

No handle was manually inserted: it is `registry.handleFor(toolUseId)`, where
`toolUseId` is the id of the tool call in the canonical history.

## RED-5 — Compaction continuity (C2)

Drives the REAL `createContextCompactionPrepareTurn({ strategy: "agentic" })`
behind the REAL `createCompactionStateAwarePrepareTurn`, with the summarizer
mocked at the EXISTING provider-handler injection boundary.

| Witness | Assertion | Result |
|---|---|---|
| carries the accepted candidate forward even when the summarizer OMITS it | the summary carrier contains `S1` | PASS |
| | exactly ONE `<!-- cline-adjudication:begin -->` and ONE `<!-- cline-adjudication:end -->` | PASS |
| | the section names `decision=narrowed` and `qualification=manual_enforcement_only` | PASS |
| | the section names the ACTUAL evidence handle | PASS |
| | the PROVIDER-VISIBLE projection (the REAL `MessageBuilder.buildForApi`) contains the section exactly once | PASS |
| produces the SAME carried section when the summarizer REPEATS the candidate | the section text is byte-identical to the omitting-summarizer case | PASS |
| produces NO duplicate section on a SECOND compaction | exactly one section; the summary is byte-identical to the first | PASS |

### A measurement note

The "exactly one section" count is taken over the SUMMARY CARRIER (the first
message's text), not over the whole serialized message. The production
projection stores the summary in TWO places (the content text and
`metadata.summary`), so counting the whole serialization would count ONE
section twice. The first draft of this witness did exactly that and
observed `2`; the carrier-scoped count is the correct measurement and was
verified against the actual installed text.

## RED-6 — Session restoration

| Witness | Assertion | Result |
|---|---|---|
| re-derives the SAME evidence handle after a host recreation | `secretB === secretA` (the RESTORE-mode provider never mints) | PASS |
| | `handleB === handleA` | PASS |
| | the restored acquisition ledger has 1 record for the original tool-call id | PASS |
| | the accepted candidate is preserved (`finding_id` matches) | PASS |
| FAILS CLOSED for a DIFFERENT session | `secretB !== secretA` | PASS |
| | `handleB !== handleA` | PASS |
| | a handle minted in session A does not resolve in session B (`canonical_refs_resolved === false`) | PASS |

### A note on what "host recreation" means here

This witness recreates the REGISTRY (the object that owns the session secret
and mints the handles) against the SAME persisted secret store, and rebuilds
the ledger from the SAME persisted canonical history. It proves the
RESTORATION CONTRACT, not an extension-host process restart. The extension
host restart is a separate observation and is reported separately in
`08-installed-live-qualification.md`.
