# ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01

## 0. Mission

Determine the **first production-only divergence** between:

```text
REAL installed product:
  iteration-1 provider-bound ai_sdk_prompt
  prime_packet absent
  witness absent

SYNTHETIC_REAL composed test:
  automatic prime succeeds
  beforeModel lookup hits
  prime_packet injected
  first model request contains witness
```

This ACT is **evidence acquisition only**. Do not repair anything
unless and until one causal boundary is proven.

Primary epistemic purpose:

```text
LIVE EVIDENCE ACQUISITION
```

Expected terminal outcomes:

```text
PASS_LIVE_BOUNDARY_CAPTURED
CAPTURE_INSUFFICIENT
HALT_UNEXPECTED_TRACKED_DIRT
```

Do not return `PASS` for the product behavior itself. The product is
already known RED.

## 1. Entry trust

```text
git status --short
git rev-parse HEAD
git log -3 --oneline
```

Expected:

```text
ENTRY_HEAD = 27868d9f1214e099bd444101f1c8ef8ed3869de9
```

Known untracked files from the predecessor may remain only if they
exactly match the already-known set.

Unexpected tracked dirt:

```text
HALT_UNEXPECTED_TRACKED_DIRT
```

Do not fold unrelated files into this ACT.

## 2. Preserve predecessor facts

Freeze these as input evidence; do not re-litigate them:

```text
LIVE_RED_CLASSIFICATION = REAL
LIVE_RED_SESSION_ID      = 1790604494785_8zlsd
LIVE_RED_RUN_ID          = run_PdCFt9iX
LIVE_RED_ITERATION       = 1

LIVE_PROVIDER_PACKET_PRESENT  = false
LIVE_PROVIDER_WITNESS_PRESENT = false

SYNTHETIC_REAL_TEST_RESULT  = 4/4 GREEN
SYNTHETIC_REAL_REPRODUCTION = false

ROOT_CAUSE = UNKNOWN_PRODUCTION_ONLY_DELTA
```

The successor exists precisely because the current evidence says the
production-only composition path is the unproven region.

## 3. Recon before instrumentation

Inspect the actual source and identify the exact production seams for:

```text
A. buildAgentHooks creation
B. hook bag passed into real AgentRuntime construction
C. beforeModel entry
D. prime recorder lookup
E. injection return
F. final request handed to provider / ai_sdk_prompt capture
```

The important distinction is:

```text
hook created
≠ hook installed in runtime
≠ hook invoked
≠ lookup hit
≠ messages mutated
≠ provider received mutated messages
```

Upstream Cline documents `beforeModel` as a hook that runs before each
model request and may mutate the request; hooks are awaited by the
runtime.

Also preserve the architectural distinction between lightweight
`AgentRuntime` and the fuller `ClineCore` host/session composition,
because that is exactly what the synthetic test bypassed.

## 4. Diagnostic design

Add the smallest default-off diagnostic surface necessary. Use the
already-existing diagnostic mechanism if possible. Do **not** invent a
second diagnostics framework.

Required events:

```text
myc_beforemodel_enter
myc_beforemodel_lookup
myc_beforemodel_exit
myc_provider_capture_binding
```

Each event must be keyed by session.

### Event 1 — `myc_beforemodel_enter`

Capture:

```text
sessionId
iteration
hooksInstalled
conversationId_present
```

Do not capture prompt/message contents.

### Event 2 — `myc_beforemodel_lookup`

Capture:

```text
sessionId
iteration
lookupKey
recordedPrimeFound
recordedPrimeSessionId
recordedPrimeStatus
```

Do not capture prime text.

### Event 3 — `myc_beforemodel_exit`

Capture:

```text
sessionId
iteration
attempted
injected
reason
packetBytes
outputMessageCount
```

No packet contents.

### Event 4 — `myc_provider_capture_binding`

Capture:

```text
sessionId
iteration
captureId
captureStage
primePacketCount
```

Prefer cardinality only. Do not record prompt contents.

## 5. Diagnostic safety contract

Instrumentation must be:

```text
DEFAULT_OFF
explicitly opt-in
zero state-semantic delta when disabled
no public API change
no wire/protocol change
no MCP protocol change
no myc change
removable after causal isolation
```

Absolutely no side effects inside React state updaters or similar
semantic paths.

Do not add:

```text
counters that alter runtime behavior
new session state authority
new completion authority
new MCP metadata fields
prime payload logging
sentinel logging
```

## 6. Diagnostic gate

Reuse the existing dogfood diagnostic profile if practical.

Preferred gate:

```text
CLINEMM_MYC_PRIME_DIAG=1
```

Do not add a second env flag unless the existing diagnostic mechanism
cannot represent these events cleanly.

If one new flag becomes necessary, justify it explicitly and keep it
default-off.

## 7. RED is already satisfied

Do **not** manufacture another synthetic RED.

The REAL RED already exists:

```text
provider-bound iteration-1 request lacks prime_packet
```

Therefore this ACT does not need:

```text
new reproduction harness
new deterministic fixture
new synthetic scenario
```

The predecessor synthetic-real test remains a conservation test only.

## 8. Minimal implementation budget

Expected production delta:

```text
1–3 files
diagnostics only
```

Likely seams:

```text
apps/vscode/src/sdk/hooks-adapter.ts
existing myc-prime-live-diag module
provider-capture correlation seam if necessary
```

If the implementation starts spreading into:

```text
McpHub
PendingPromptsController
BackgroundNotifyCoordinator
completion presentation
myc code
provider adapter business logic
```

then stop:

```text
HALT_WRONG_SEAM
```

## 9. Focused diagnostic tests

Add only enough tests to prove diagnostics themselves are semantically
inert.

Required cases:

```text
LBC-01 diagnostics OFF:
       behavior identical
       no diagnostic events recorded

LBC-02 beforeModel lookup HIT:
       enter → lookup → exit sequence
       injected=true
       no payload captured

LBC-03 lookup MISS:
       recordedPrimeFound=false
       injected=false
       reason preserved

LBC-04 provider-binding:
       same session + iteration linked to captureId

LBC-05 multi-session:
       events keyed independently by session
```

These are **diagnostic correctness** tests, not bug reproduction tests.

## 10. Conservation

At minimum run predecessor coverage around:

```text
myc-prime-auto-injection01       4/4
myc-prime-live-diag             14/14 (+5 LBC = 19/19)
myc-prime-automation.model-visible
myc-prime-automation.identity-join
mcpSessionAutostart01           10/10
finalizationRunBootstrapStall01 4/4
```

Also run any focused hook/runtime tests touched by instrumentation.

The new ACT must not change:

```text
automatic prime cardinality
manual myc_prime behavior
MCP autostart
MCP teardown
completion semantics
provider request contents
session IDs
```

## 11. Build gates

Before dogfood packaging:

```bash
bun run check-types
git diff --check
```

Then:

```bash
bun run vscode:prepublish
```

All must be GREEN.

## 12. Artifact identity

Build a new dogfood VSIX.

Bind:

```text
DOGFOOD_SOURCE_HEAD
VERSION
VSIX_PATH
VSIX_BYTE_SIZE
VSIX_SHA256
INSTALLED_EXTENSION_VERSION
INSTALLED_EXTENSION_PATH
```

Do not predict commit SHA before committing.

The live run is invalid if installed artifact identity cannot be
proven:

```text
HALT_INSTALLED_ARTIFACT_IDENTITY_UNPROVEN
```

## 13. Operator boundary

ClineMM still does **not** launch Codium.

ClineMM may:

```text
prepare diagnostics
build/package
verify artifact identity
prepare exact operator recipe
inspect source/log artifacts afterwards
```

Operator owns:

```text
quit/relaunch Codium
Start New Task
type mundane prompt
observe UI
close session
```

## 14. Live run

Use exactly one clean installed-Codium dogfood session.

Do not use the old session.

Do not manually call `myc_prime` before the first provider request.

A ready witness may already exist in myc; use a fresh ready witness
only if needed to make prime non-empty.

The mundane prompt should not mention:

```text
myc
prime
sentinel
memory
diagnostics
```

Example:

> Inspect the repository briefly and summarize the most relevant
> engineering context for continuing work. Do not modify files and
> avoid long-running commands.

## 15. Capture the session ID

After task startup:

```bash
MYC_PID="$(
  pgrep -f '/\.myc/bin/myc mcp --profile agent' |
  head -1
)"

S="$(
  ps eww -p "$MYC_PID" 2>/dev/null |
  tr ' ' '\n' |
  sed -n 's/^MYC_SESSION_ID=//p' |
  head -1
)"

printf 'MYC_PID=%s\nSESSION_ID=%s\n' "$MYC_PID" "$S"
```

Require:

```text
S != empty
```

## 16. Read the diagnostic trace

Extract only the events for `S`.

Required ordering:

```text
myc_beforemodel_enter
→ myc_beforemodel_lookup
→ myc_beforemodel_exit
→ myc_provider_capture_binding
```

For iteration 1.

If no trace exists despite diagnostics enabled:

```text
CAPTURE_INSUFFICIENT
```

## 17. Discriminator tree

This is the ACT's decisive logic.

### Case A

```text
myc_beforemodel_enter absent
```

Verdict:

```text
BOUNDARY = PRODUCTION_HOOK_ASSEMBLY_OR_INSTALLATION
```

Meaning:

```text
the real runtime did not execute the expected beforeModel hook
```

No repair in this ACT.

### Case B

```text
enter present
sessionId != S
```

Verdict:

```text
BOUNDARY = PRODUCTION_RUNTIME_SESSION_IDENTITY
```

Meaning:

```text
production host/config composition changed the runtime session identity
```

No repair.

### Case C

```text
sessionId == S
recordedPrimeFound == false
```

Verdict:

```text
BOUNDARY = PRIME_RECORDER_LIFETIME_OR_INSTANCE
```

Possible class:

```text
recorder written in one module instance
lookup occurring in another
or recorder never written in live path
```

Do not speculate further without evidence.

### Case D

```text
recordedPrimeFound == true
injected == false
```

Verdict:

```text
BOUNDARY = PRIME_INJECTION_GUARD
```

Record exact `reason`.

### Case E

```text
injected == true
primePacketCount at provider capture == 0
```

Verdict:

```text
BOUNDARY = POST_HOOK_REQUEST_COMPOSITION_LOSS
```

This means the hook mutated messages but the provider-bound request
did not retain them.

### Case F

```text
injected == true
provider primePacketCount == 1
```

Then the predecessor LIVE failure did not reproduce in this fresh
build/run:

```text
BOUNDARY = NOT_REPRODUCED_LIVE
```

Do not call the old LIVE RED false. Preserve both observations.

## 18. Evidence quality

Label the final result:

```text
LIVE
REAL_PRODUCTION_SEAM
```

for the operator-driven installed run.

Diagnostic unit tests remain:

```text
SYNTHETIC_REAL
```

Do not promote them.

## 19. No repair rule

This ACT must not repair the discovered defect.

Even if the cause looks obvious, stop once the first divergence is
isolated.

The output of this ACT is:

```text
boundary classification
exact live evidence
successor repair ACT
```

not a patch.

## 20. Success criteria

PASS means we have isolated the first divergence:

```text
VERDICT=PASS_LIVE_BOUNDARY_CAPTURED
```

with exactly one of:

```text
BOUNDARY=PRODUCTION_HOOK_ASSEMBLY_OR_INSTALLATION
BOUNDARY=PRODUCTION_RUNTIME_SESSION_IDENTITY
BOUNDARY=PRIME_RECORDER_LIFETIME_OR_INSTANCE
BOUNDARY=PRIME_INJECTION_GUARD
BOUNDARY=POST_HOOK_REQUEST_COMPOSITION_LOSS
BOUNDARY=NOT_REPRODUCED_LIVE
```

Not:

```text
ROOT_CAUSE=PROVEN
```

unless the captured evidence genuinely establishes causality.

## 21. Final report shape

```text
ACT=ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01
VERDICT=

ENTRY_HEAD=
IMPLEMENTATION_HEAD=
DOGFOOD_SOURCE_HEAD=

DIAGNOSTICS_DEFAULT_OFF=true
PRODUCTION_SEMANTICS_CHANGED=false
MYC_CODE_CHANGED=false

LIVE_SESSION_ID=
LIVE_RUN_ID=
LIVE_ITERATION=1

BEFOREMODEL_ENTER_PRESENT=
BEFOREMODEL_ENTER_SESSION_ID=
BEFOREMODEL_ENTER_ITERATION=

LOOKUP_ATTEMPTED=
LOOKUP_KEY=
RECORDED_PRIME_FOUND=
RECORDED_PRIME_SESSION_ID=
RECORDED_PRIME_STATUS=

INJECTION_ATTEMPTED=
INJECTION_RESULT=
INJECTION_REASON=
PACKET_BYTES=

PROVIDER_CAPTURE_PRESENT=
PROVIDER_CAPTURE_ID=
PROVIDER_CAPTURE_SESSION_ID=
PROVIDER_CAPTURE_ITERATION=
PROVIDER_PRIME_PACKET_COUNT=

FIRST_DIVERGENCE=
BOUNDARY_CLASSIFICATION=

REAL_LIVE_RED_PREDECESSOR=PRESENT
SYNTHETIC_REAL_PREDECESSOR=GREEN_4_OF_4

TYPECHECK=
VSCODE_PREPUBLISH=
DIFF_CHECK=

PRODUCTION_PATCH_APPLIED=false
READY_FOR_REPAIR_ACT=
```

## 22. Stop condition

After the first production-only divergence is identified:

```text
STOP
```

Open exactly one successor repair ACT around that seam.

No second review loop unless the evidence exposes a new P0.
