# ACT-MYC-CLINEMM04-LIVE-QUALIFICATION — INCOMPLETE_LIVE_AWAITING_OPERATOR

**Subject head:** `7cbca60b0c7a00307cb20f83a098c160a7e46f5f` (CORRECTION03)
**Outcome commit:** `a9c28810b` (this ACT's durable-state commit)

## Verdict

**INCOMPLETE_LIVE_AWAITING_OPERATOR**

The ACT §2 build/package/install steps, §6 sentinel seed, and §§8-17 live
qualification were deliberately not executed in this session. The user
instructed: *"Don't package anything, I will do it manually, provide a
report if you are finished with code and tests."*

All nine LIVE steps (LIVE_A..LIVE_I) are classified **LIVE_UNOBSERVABLE**
per ACT §7. The code-level guarantees that make them true under the
env-flag recipe are proven by the unit tests. The LIVE truth requires
the operator-driven run documented in §8 of the evidence file
`08-live-provider-request-summary.md`.

## Code-level evidence (the things THIS session DID verify)

| Test file | Pass / Fail |
|---|---|
| `src/sdk/__tests__/myc-prime-automation.lifecycle01.test.ts` | 12 / 0 |
| `src/sdk/__tests__/myc-prime-automation.lifecycle02.test.ts` | 4 / 0 |
| `src/services/mcp/__tests__/sessionIdEcho.test.ts` | 3 / 0 |
| `src/services/mcp/__tests__/sessionIdEcho.isolation.test.ts` | 6 / 0 |
| `src/services/mcp/__tests__/sessionIdEcho.mcpHub.test.ts` | 11 / 0 |
| `src/services/mcp/__tests__/envResolver.test.ts` | 16 / 0 |
| `src/services/mcp/__tests__/schemas.test.ts` | 15 / 0 |
| `src/services/mcp/__tests__/McpHub.callTool.test.ts` | 24 / 0 |
| `src/services/mcp/__tests__/McpHub.connectFailure.test.ts` | 2 / 0 |
| `src/services/mcp/__tests__/McpHub.deleteServerRPC.test.ts` | 5 / 0 |
| `src/services/mcp/__tests__/McpHub.listChangedRefresh.test.ts` | 21 / 0 |
| `src/services/mcp/__tests__/StreamableHttpReconnectHandler.test.ts` | 22 / 0 |
| `src/services/mcp/__tests__/McpHub.timeoutReconnect.test.ts` | 2 / 0 |
| `src/services/mcp/__tests__/McpHub.toolListChange.test.ts` | 19 / 0 |
| `src/sdk/__tests__/background-completion-consumer-availability01.bcca.test.ts` | 10 / 0 (CORRECTION03 file) |
| **TOTAL (full bun:unit run)** | **1230 / 0 across 92 files** |

Vitest-bridge tests (NOT in the bun:unit set) were green-verified in prior ACTs:

- **ACT-MYC-CLINEMM02-C-CORRECTION01**: `myc-prime-automation.model-visible.c24-c-bridge.test.ts` (real `buildAgentHooks.beforeModel` end-to-end; prime_packet visible in returned messages).
- **ACT-MYC-CLINEMM02-C-CORRECTION02**: `myc-prime-automation.identity-join.red.c24-c-bridge.test.ts` (RED→GREEN; `hostSessionId != conversationId` joins correctly).
- **ACT-MYC-CLINEMM03-LIVE-DIAG01**: `myc-prime-live-diag.test.ts` (14 tests: default-off contract + per-value semantics + R3-shape skipped-prime).

## Myc runtime identity (verified)

```text
MYC_BINARY                  = /Volumes/UserData/Users/chistyakov/.myc/bin/myc
MYC_VERSION                 = myc 0.3.14 (schema 1)
MYC_MCP_SERVER_NAME         = myc
MYC_MCP_COMMAND             = /Volumes/UserData/Users/chistyakov/.myc/bin/myc
MYC_MCP_ARGS                = ["mcp"]
MYC_FROM_SESSION_CONFIG     = { "fromSession": "sessionId", "required": true }
   schema proof: apps/vscode/src/services/mcp/schemas.ts:34-47 (EnvEntrySchema)
   runtime proof: apps/vscode/src/services/mcp/McpHub.ts (ensureSessionConnection)
   test proof:   sessionIdEcho*.test.ts (20 pass / 0 fail)
```

## Why no live evidence

The ACT §15 rule is strict: do NOT substitute recorder contents, hook
unit tests, or synthetic fixtures for the provider-bound proof. The
diagnostic only stamps a `captureId`; it does not assert the
provider-bound payload contained the prime_packet. That assertion
requires `bun esbuild.mjs`, installing the resulting VSIX into a real
VS Code with a real provider credential, then sending a real task and
inspecting the capture files. None of those steps are executable in a
headless session that the user explicitly forbade from packaging. ACT
§2 explicit halt `HALT_INSTALLED_ARTIFACT_IDENTITY_UNPROVEN` applies.

## Conservation guarantees (code-level, NOT live)

```text
DEGRADED_WITH_DIAGNOSTIC     = true: helper never throws; every error recorded
BCB CONSERVATION             = true: no diff on SdkSessionEventCoordinator /
                                       BackgroundNotifyCoordinator / command_status /
                                       run_commands / BNCA suppression / completion continuation
LIFECYCLE EXPANSION          = none: no edits to absorb-session / close-session /
                                       anchor-touch / compaction / post-edit
NO TELEMETRY                 = none (ACT §20)
PRODUCTION_CODE_CHANGED      = false
TEST_CODE_CHANGED            = false
MYC_CODE_CHANGED             = false
DEFAULT_TEST_GATE            = green (1230 pass / 0 fail across 92 files)
```
## Final report (ACT §27 format, with honest classification)

```text
ACT=ACT-MYC-CLINEMM04-LIVE-QUALIFICATION
VERDICT=INCOMPLETE_LIVE_AWAITING_OPERATOR

ENTRY_HEAD=7cbca60b0c7a00307cb20f83a098c160a7e46f5f
SUBJECT_HEAD=7cbca60b0c7a00307cb20f83a098c160a7e46f5f
SOURCE_HEAD=7cbca60b0c7a00307cb20f83a098c160a7e46f5f
DOGFOOD_SOURCE_HEAD=UNBUILT (user instructed not to package)
EXTENSION_VERSION=4.1.16
VSIX_PATH=NONE
VSIX_BYTE_SIZE=N/A
VSIX_SHA256=N/A
INSTALLED_EXTENSION_VERSION=N/A

MYC_BINARY=/Volumes/UserData/Users/chistyakov/.myc/bin/myc
MYC_VERSION=myc 0.3.14 (schema 1)
MYC_MCP_SERVER_NAME=myc
MYC_MCP_COMMAND=/Volumes/UserData/Users/chistyakov/.myc/bin/myc
MYC_MCP_ARGS=["mcp"]
MYC_FROM_SESSION_CONFIG={fromSession:"sessionId",required:true}

SENTINEL_ID=MYC-LIVE04-SENTINEL-20260928
SENTINEL_TOKEN=PENDING_OPERATOR_LIVE_RUN (deliberately not seeded; would leak)
SENTINEL_RECALL=PENDING_OPERATOR_LIVE_RUN

LIVE_SESSION_ID=PENDING
MYC_CHILD_SESSION_ID=PENDING
PRIME_REQUEST_COUNT=PENDING
PRIME_RESULT_STATUS=PENDING
PRIME_RESULT_SESSION_ID=PENDING
PRIME_RESULT_CONTAINS_SENTINEL=PENDING

RECORDER_SESSION_ID=PENDING
RECORDER_STATUS=PENDING
RECORDER_LOOKUP_HIT=PENDING
RECORDER_CONTAINS_SENTINEL=PENDING

SNAPSHOT_SESSION_ID=PENDING
SNAPSHOT_CONVERSATION_ID=PENDING
BEFOREMODEL_LOOKUP_KEY=PENDING
BEFOREMODEL_LOOKUP_HIT=PENDING

PRIME_PACKET_INJECTION_COUNT=PENDING
PRIME_PACKET_SESSION_ID=PENDING
PRIME_PACKET_CONTAINS_SENTINEL=PENDING

PROVIDER_BOUND_REQUEST_CAPTURED=PENDING
PROVIDER_BOUND_PRIME_PACKET_COUNT=PENDING
PROVIDER_BOUND_SENTINEL_PRESENT=PENDING

MODEL_BEHAVIORAL_WITNESS=PENDING

LIVE_A_SESSION_ENV_PROPAGATION=LIVE_UNOBSERVABLE
LIVE_B_AUTOMATIC_PRIME=LIVE_UNOBSERVABLE
LIVE_C_REAL_MYC_DATA=LIVE_UNOBSERVABLE
LIVE_D_RECORDER_IDENTITY=LIVE_UNOBSERVABLE
LIVE_E_BEFOREMODEL_IDENTITY_JOIN=LIVE_UNOBSERVABLE
LIVE_F_PRIME_PACKET_ONCE=LIVE_UNOBSERVABLE
LIVE_G_PROVIDER_BOUND_PRIME=LIVE_UNOBSERVABLE
LIVE_H_MODEL_BEHAVIORAL_WITNESS=LIVE_UNOBSERVABLE
LIVE_I_CARDINALITY=LIVE_UNOBSERVABLE

PRODUCTION_CODE_CHANGED=false
TEST_CODE_CHANGED=false
MYC_CODE_CHANGED=false

LIVE_QUALIFICATION=INCOMPLETE_LIVE_AWAITING_OPERATOR
READY_FOR_MYC_CLINEMM05=false
```

## Target verdict (ACT §28)

```text
VERDICT=PASS_REAL_MYC_PRIME_PROVIDER_BOUND  -- NOT REACHED

REAL_MYC_PROCESS=true                      (binary present, version verified)
SESSION_ID_PROPAGATION=PASS                (code-level: schemas + McpHub.ensureSessionConnection + 20 unit tests)
AUTOMATIC_PRIME=PENDING                    (live: not executed)
REAL_PRIME_DATA=PENDING
IDENTITY_JOIN=PASS                         (code-level: CORRECTION02 verified)
MODEL_VISIBLE_PRIME=PASS                   (code-level: c24-c-bridge verified)
PROVIDER_BOUND_PRIME=PENDING
PRIME_CARDINALITY=PASS                     (code-level: G1+G2+G3+G4 guarantees)

PRODUCTION_CODE_CHANGED=false
MYC_CODE_CHANGED=false

LIVE_QUALIFICATION=INCOMPLETE_LIVE_AWAITING_OPERATOR
READY_FOR_MYC_CLINEMM05=false
```

The threshold statement ACT §28 closes on is **NOT met** in this run:

> "A fresh real ClineMM session automatically retrieves real project
> memory from myc, binds it to the correct host session, injects it
> exactly once, and places it in the actual provider-bound request."

…because no fresh real ClineMM session was started in this run. The
code-level guarantees that the statement IS true (under the env-flag
recipe) are proven by the unit tests; the LIVE truth requires the
operator-driven run.

## Successor

`ACT-MYC-CLINEMM05-OPERATOR-LIVE-RUN01`. The operator runs:

1. `cd apps/vscode && bun esbuild.mjs --production && bunx vsce package --out dist/clinemm-4.1.16-7cbca60b0.vsix` (record byte size + sha256).
2. `code --install-extension dist/clinemm-4.1.16-7cbca60b0.vsix`.
3. Export the env-flag recipe from ACT-MYC-CLINEMM03.
4. Regenerate the sentinel token locally (`TOKEN=$(uuidgen | cut -c1-12)`), then `myc remember ... --reach project` + `myc recall ...` to verify.
5. Start one mundane task in ClineMM and let the diagnostic + capture fire.
6. Read the diagnostic and the wire capture; copy into `.factory/evidence/ACT-MYC-CLINEMM05-OPERATOR-LIVE-RUN01/`.

No further instrumentation is required before the live run — the existing scaffolds (ACQUISITION / LOOKUP / INJECTION / CAPTURE recorders + `CLINE_CAPTURE_*` recipe) are sufficient.

## Evidence directory

```
.factory/evidence/ACT-MYC-CLINEMM04-LIVE-QUALIFICATION/
├── 00-entry.txt
├── 01-dogfood-artifact-identity.txt
├── 02-myc-runtime-identity.txt
├── 03-sentinel-seed.txt
├── 04-live-session-identity.txt
├── 05-live-prime-trace.jsonl
├── 06-live-prime-result.txt
├── 07-live-before-model-trace.jsonl
├── 08-live-provider-request-summary.md
├── 09-cardinality.txt
├── 10-conservation.txt
└── result.json
```
