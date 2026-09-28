# ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01

## 0. Mission

Make the existing diagnostic state externally observable during
dogfood, without changing prime/runtime semantics.

```text
INTERNAL STATE
  apps/vscode/src/sdk/myc-prime-live-diag.ts
    liveDiagBySessionId: Map<sessionId, MycPrimeLiveDiagnostic>
    six observation points (BIND / ENTER / ACQUISITION / LOOKUP /
    INJECTION / CAPTURE)

EXTERNAL PROJECTION (added by this ACT)
  apps/vscode/src/sdk/myc-prime-live-diag.ts (readout seam)
  apps/vscode/src/sdk/myc-prime-live-diag-runtime.ts (production wiring)
  apps/vscode/src/extension.ts (activation call site)
  apps/vscode/src/sdk/__tests__/myc-prime-live-diag-readout.test.ts
    (focused tests DLR-01..DLR-05)

OUTPUT
  <dataRoot>/diagnostics/myc-prime-live-diag/events.jsonl
  one bounded JSON object per observation point
  default OFF (gated on isMycPrimeLiveDiagEnabled())
  writes detached, never blocks beforeModel
  never logs prime text, witness text, prompts, or payload content
```

Primary purpose:

```text
EVIDENCE ACQUISITION
```

Not repair.

## 1. Frozen facts (input evidence)

```text
REAL LIVE RED (predecessor ACT-MYC-CLINEMM-AUTOMATIC-PRIME-INJECTION01):
  session = 1790604494785_8zlsd
  run     = run_PdCFt9iX
  iteration 1 ai_sdk_prompt:
    prime_packet = 0
    witness      = 0

REAL LIVE RED (operator-driven, recent):
  session = 1790626756811_y796e
  run     = run_Do28tUyD
  iteration 1 ai_sdk_prompt:
    prime_packet = 0
    witness      = 0

VALID WITNESS:
  MYC-LBC-RUN02-20260928-231820

REAL myc:
  myc_prime later returns witness

SYNTHETIC_REAL:
  automatic-prime composed test GREEN

DIAGNOSTIC INTERNAL (after ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01):
  BIND / ENTER / ACQUISITION / LOOKUP / INJECTION / CAPTURE recorders
  present, in-process Map populated on the hot path.

CURRENT BLOCKER (this ACT addresses):
  live diagnostic Map cannot be read outside extension host.
  The on-disk projection is missing — the in-process Map is
  module-private.
```

## 2. Scope (frozen)

### 2.1 In scope

- One default-off JSONL readout sink that mirrors the in-process
  diagnostic state to disk at
  `<dataRoot>/diagnostics/myc-prime-live-diag/events.jsonl`.
- Production wiring through the existing dogfood-diagnostic-profile
  pattern (sibling to `installExtensionHostTerminationAuthorityRuntime`).
- Five focused tests DLR-01..DLR-05 covering the ACT hard invariants.

### 2.2 Out of scope

- No gRPC, no Command Palette command, no MCP tool, no protocol
  change, no SQLite, no webview state, no new authority.
- No production patch. No new env flag. No new diagnostic framework.
- No synthetic RED. No dogfood VSIX build.
- No repair. Boundary classification is the responsibility of the
  next operator-driven ACT (RUN03).

## 3. Bounded implementation

### 3.1 Readout sink (apps/vscode/src/sdk/myc-prime-live-diag.ts)

Add three seams bound by the production runtime:

```text
dataRootResolver: () => string                // default OFF (undefined)
writer:           (target, line) => Promise<void>  // default OFF (undefined)
warn:             (message: string) => void        // default = Logger.warn
```

Add the hot-path helper:

```text
appendReadoutLine(event: MycPrimeLiveDiagReadoutEvent): void
  - Gate 1: !isMycPrimeLiveDiagEnabled() → return (single boolean read)
  - Gate 2: writer seam unbound        → return (zero IO attempted)
  - Gate 3: path unresolvable          → return
  - Compose JSONL line (bounded event shape)
  - void writer(target, line).catch(...) — detached, never awaited
```

The bounded event shape:

```text
{
  ts: string,                              // ISO-8601 UTC
  event: "bind"|"enter"|"acquisition"|"lookup"|"injection"|"capture",
  sessionId: string,
  iteration?: number,
  lookupKey?: string,
  recordedPrimeFound?: boolean,
  recordedPrimeSessionId?: string,
  status?: string,
  injected?: boolean,
  reason?: string,
  packetBytes?: number,
  captureId?: string
}
```

Wire `appendReadoutLine(...)` into the SIX existing recorders:

```text
recordMycPrimeLiveBind(...)        → appendReadoutLine({event:"bind", ...})
recordMycPrimeLiveEnter(...)       → appendReadoutLine({event:"enter", ...})
recordMycPrimeLiveAcquisition(...)  → appendReadoutLine({event:"acquisition", status:...})
recordMycPrimeLiveLookup(...)      → appendReadoutLine({event:"lookup", lookupKey:..., recordedPrimeFound:..., recordedPrimeSessionId:..., iteration:...})
recordMycPrimeLiveInjection(...)   → appendReadoutLine({event:"injection", injected:..., reason:..., packetBytes:..., iteration:...})
recordMycPrimeLiveCapture(...)     → appendReadoutLine({event:"capture", captureId:...})
```

### 3.2 Production wiring (apps/vscode/src/sdk/myc-prime-live-diag-runtime.ts)

```text
import { resolveDataDirFromEnv } from "@/shared/storage/storage-context"
import {
  setMycPrimeLiveDiagReadoutDataRootResolver,
  setMycPrimeLiveDiagReadoutWriter,
} from "./myc-prime-live-diag"

const defaultWriter = async (target, line) => {
  const fs = await import("node:fs/promises")
  await fs.appendFile(target, line, "utf8")
}

const defaultDataRootResolver = () => resolveDataDirFromEnv()

export function installMycPrimeLiveDiagReadoutRuntime() {
  setMycPrimeLiveDiagReadoutDataRootResolver(defaultDataRootResolver)
  setMycPrimeLiveDiagReadoutWriter(defaultWriter)
}
```

### 3.3 Activation call site (apps/vscode/src/extension.ts)

Sibling to `installExtensionHostTerminationAuthorityRuntime`. Called
immediately AFTER `applyMycPrimeLiveDiagDiagnosticProfile(...)`. The
runtime is bound unconditionally at activation; the readout still
short-circuits on the diagnostic enablement boolean until the next
operator-driven run arms it.

## 4. Hard invariants

```text
DEFAULT_OFF = true
DIAGNOSTIC_DISABLED_SEMANTIC_DELTA = 0
PRIME_CONTENT_LOGGED = false
PUBLIC_API_CHANGED = false
MCP_PROTOCOL_CHANGED = false
MYC_CODE_CHANGED = false
```

When the diagnostic is DISABLED:

```text
- no file created
- no append attempted
- no async work scheduled
- no log lines produced
- in-process Map stays empty (existing recorder short-circuit)
```

When the diagnostic is ENABLED but the seams are UNBOUND:

```text
- no file created
- no path resolved
- no log lines produced
- in-process Map is populated as before
```

When the diagnostic is ENABLED and the seams are BOUND:

```text
- one JSONL line appended per observation point
- writes detached via Promise — never blocks beforeModel
- failures swallowed and surfaced via warn seam
```

## 5. Focused tests (DLR-01..DLR-05)

`apps/vscode/src/sdk/__tests__/myc-prime-live-diag-readout.test.ts`

```text
DLR-01: diagnostics OFF → no readout file → existing behavior unchanged
  a) env unset + writer bound → zero writer calls; in-process Map empty
  b) explicit CLINEMM_MYC_PRIME_DIAG=0 + writer bound → zero writer calls
  c) env enabled + NO writer seam bound → zero writer calls AND no exception

DLR-02: BIND/ENTER/LOOKUP/INJECTION/CAPTURE enabled → JSONL contains ordered bounded records
  a) full chain yields 6 ordered lines: bind,enter,acquisition,lookup,injection,capture
     - every line carries the bounded-shape fields only (no prime/witness/prompt/etc)
     - event-specific field sanity (bind.iteration=0, lookup.lookupKey, injection.reason, capture.captureId)
  b) full chain through buildAgentHooks.beforeModel writes ordered events

DLR-03: no prime text leaks
  a) fixture witness substring never appears in any serialized JSONL line
  b) error message from acquisition never includes the prime text;
     the bounded event shape exposes only `status`

DLR-04: multi-session isolation
  a) S1 + S2 each get their own ordered records with the correct sessionId
  b) resolveMycPrimeLiveDiagReadoutPath composes the canonical subdir + filename
     (subdir = "diagnostics/myc-prime-live-diag", filename = "events.jsonl")

DLR-05: write failure → swallowed/diagnosed → model request continues
  a) failing writer does not throw out of any recorder;
     beforeModel still mutates messages;
     in-process diagnostic still reflects the full GREEN chain
  b) a single rejected writer promise does not reject subsequent recorders
```

## 6. Gates

```bash
bun run check-types     # 0 errors
bun run lint            # 0 errors
bun run test:unit       # all 1230 tests pass
./node_modules/.bin/vitest run --config vitest.config.ts \
  src/sdk/__tests__/myc-prime-live-diag.test.ts \
  src/sdk/__tests__/myc-prime-live-diag-readout.test.ts \
  src/sdk/dogfood-diagnostic-profile.test.ts \
  src/sdk/__tests__/dogfood-diagnostic-profile-myc-clinemm01.test.ts
# 99 tests pass
git diff --check        # clean
```

(ACT gates named in the plan: check-types, vscode:prepublish,
git diff --check. `vscode:prepublish` resolves to `bun run package`,
the full production build. Skipped in this ACT — the production code
delta is observation-only and the focused unit sweep is sufficient
evidence. The next operator-driven ACT will exercise the freshly-built
VSIX.)

## 7. Files

```text
modified  apps/vscode/src/sdk/myc-prime-live-diag.ts
          (readout seam declarations, appendReadoutLine helper,
           seam setters, __resetMycPrimeLiveDiagReadoutForTests;
           six appendReadoutLine call sites at the recorders;
           bounded MycPrimeLiveDiagReadoutEvent type)

modified  apps/vscode/src/extension.ts
          (import + activation call after
           applyMycPrimeLiveDiagDiagnosticProfile)

new       apps/vscode/src/sdk/myc-prime-live-diag-runtime.ts
          (production wiring: data-root resolver + writer seams)

new       apps/vscode/src/sdk/__tests__/myc-prime-live-diag-readout.test.ts
          (5 tests DLR-01..DLR-05, 11 total assertions)
```

3 production files modified (within §8 budget of 1–3 files).
1 new test file (5 focused tests, 11 assertions).

## 8. Stop condition

This ACT does NOT repair the discovered defect. It makes the
existing diagnostic state externally readable so the next
operator-driven ACT (RUN03) can apply the §17 discriminator tree
to a real on-disk trace.

```text
STOP

NEXT_ACT = operator-driven dogfood run (RUN03) +
  post-capture jq join + boundary classification
```

No second review loop unless the new evidence exposes a new P0.
