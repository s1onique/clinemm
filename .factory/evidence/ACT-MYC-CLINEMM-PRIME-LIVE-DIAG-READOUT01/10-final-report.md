# ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01 — Final Report (CORRECTION01)

```text
VERDICT                       = PASS_READOUT_PARENT_MATERIALIZATION
P0_READOUT_PARENT_DIR_MISSING = CLOSED
PRODUCTION_SEMANTICS_CHANGED  = false
DIAGNOSTIC_IO_CHANGED         = true (mkdir-on-first-use added to writer)
MYC_CODE_CHANGED              = false
READY_FOR_RUN03               = true
ENTRY_HEAD                    = 72dd7520d (pre-correction)
IMPL_HEAD                     = uncommitted (1 production modified + 1 test modified)
```

## What this ACT did

A reviewer audit on the original ACT (commit `72dd7520d`) caught a
**P0 in the evidence-acquisition path**: the original ACT claimed the
readout path is "created lazily by the first `appendFile` call", but
Node's `appendFile` does NOT create the parent directory. On a clean
dogfood profile where `<dataRoot>/diagnostics/myc-prime-live-diag/`
does not yet exist, the first append would reject with `ENOENT`. The
detached `.catch()` in `appendReadoutLine` would correctly prevent
semantic damage, but the sink would silently produce zero evidence —
straight back to `CAPTURE_INSUFFICIENT`.

### Bounded fix applied

One file (`apps/vscode/src/sdk/myc-prime-live-diag-runtime.ts`):

```diff
+import path from "node:path"
 ...
 const defaultWriter: MycPrimeLiveDiagReadoutWriter = async (target, line) => {
   const fsPromises = await import("node:fs/promises")
+  await fsPromises.mkdir(path.dirname(target), { recursive: true })
   await fsPromises.appendFile(target, line, "utf8")
 }
```

The docstring in the same file was also corrected (it was the source
of the false claim). No other production code changed; the activation
seam in `extension.ts`, the read-only API surface in
`myc-prime-live-diag.ts`, and the seam setter API are all unchanged.

The writer Promise is still detached at the call site in
`appendReadoutLine`; the only difference is that the writer's internal
`mkdir`+`appendFile` chain now also does a directory creation. The
failure mode is identical (rejected Promise reaches the warn seam);
DLR-06.b proves this against the production writer.

### RED → GREEN test added

One new filesystem-level test `DLR-06` (3 sub-cases, vitest) exercises
the **PRODUCTION** writer (not a spy) against a real on-disk temp data
root whose diagnostic subdir does not yet exist:

| Test | Asserts |
|------|---------|
| DLR-06.a | `<dataRoot>/diagnostics/myc-prime-live-diag/` does NOT exist BEFORE the recorder fires; AFTER the recorder fires, the subdir IS a directory, `events.jsonl` IS a file, and it contains exactly one valid JSON line with the bounded shape `{ts, event, sessionId, iteration}`. |
| DLR-06.b | A failing production writer (e.g. data root points at a regular file so mkdir of its child dir rejects) is swallowed by the warn seam. `beforeModel` still resolves with the prime injected. The in-process diagnostic entry still reflects the full GREEN chain. (Re-pins DLR-05.a against the production writer topology.) |
| DLR-06.c | Diagnostic OFF + production writer bound → zero I/O. (Re-pins DLR-01.a against the production writer topology.) |

The previous tests (DLR-01..DLR-05) are unchanged. Total DLR suite
size: 6 tests, 14 assertions.

## Conservation (PASS)

```text
myc-prime-live-diag-readout.test.ts                14/14 GREEN
myc-prime-live-diag.test.ts                        19/19 GREEN
dogfood-diagnostic-profile.test.ts                 30/30 GREEN
dogfood-diagnostic-profile-myc-clinemm01.test.ts   39/39 GREEN
                                                       ----
  focused 4-file vitest sweep                      102/102 GREEN

bun run test:unit                                 1230/1230 GREEN across 92 files
apps/vscode tsc --noEmit                                    0 errors
git diff --check                                             clean
biome lint                                                   0 errors
```

### Pre-existing drift (independent of this ACT)

The reviewer notes a stale/invalid `.factory/gate-summary.json` (P2,
non-blocking). The vitest sweep also exposes pre-existing failures on
`turn-state-writer-provenance.wprov.test.ts WPROV07.1` and several
`extension-host-termination-authority01.termination-authority.test.ts`
and `sdk-task-history.test.ts` cases. These are pre-existing drift
(verified by `git stash` on `72dd7520d` and re-run; the failures
reproduce without my change). They are NOT introduced by CORRECTION01
and are NOT blocking the P0 fix.

## Hard invariants — verified

```text
DEFAULT_OFF = true
DIAGNOSTIC_DISABLED_SEMANTIC_DELTA = 0
PRIME_CONTENT_LOGGED = false
WITNESS_CONTENT_LOGGED = false
PROMPT_CONTENT_LOGGED = false
PAYLOAD_CONTENT_LOGGED = false
PUBLIC_API_CHANGED = false
MCP_PROTOCOL_CHANGED = false
MYC_CODE_CHANGED = false
BEFORE_MODEL_NEVER_AWAITED = true
WRITE_FAILURE_NEVER_BLOCKS = true (DLR-05 + DLR-06.b)
PRODUCTION_WRITER_MATERIALIZES_PARENT_DIR = true (DLR-06.a)
DIAGNOSTIC_OFF_ZERO_IO_WITH_PRODUCTION_WRITER_BOUND = true (DLR-06.c)
SESSION_ISOLATION_PRESERVED = true (DLR-04.a)
BOUNDED_EVENT_SHAPE = true (DLR-03 + DLR-06.a)
```

## Files changed (1 production modified + 1 test modified)

```text
apps/vscode/src/sdk/myc-prime-live-diag-runtime.ts
  + import path from "node:path"
  ~ defaultWriter: +1 mkdir line
  ~ docstring: corrected to reflect Node's actual contract

apps/vscode/src/sdk/myc-prime-live-diag.ts
  (unchanged by CORRECTION01; the read-only API surface is the same)

apps/vscode/src/extension.ts
  (unchanged by CORRECTION01; activation seam is the same)

apps/vscode/src/sdk/__tests__/myc-prime-live-diag-readout.test.ts
  + import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
  + import { tmpdir } from "node:os"
  + import { join } from "node:path"
  + import { installMycPrimeLiveDiagReadoutRuntime } from "@/sdk/myc-prime-live-diag-runtime"
  + describe("DLR-06: production writer materializes parent dir", ...): 3 it blocks
```

Production change footprint: 1 import line + 1 await line in one file.
Total diff: ~10 lines.

## No repair applied

This ACT is **observation-only**, even after CORRECTION01. The LIVE
RED's boundary classification is the responsibility of RUN03 (the
next operator-driven ACT). RUN03 will:

1. Build a fresh VSIX from this corrected commit.
2. Install it in Codium.
3. Run one mundane task with a fresh READY witness (one new sentinel).
4. `jq` the events.jsonl trace against the captured `MYC_SESSION_ID`.
5. Apply the §17 discriminator tree from
   `ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01`.
6. Emit exactly one boundary classification.

The trace will land at:

```bash
S="<operator-captured-myc-session-id>"
jq -c "select(.sessionId == \"$S\")" \
   ~/.vscodium-clinemm/cline-data/diagnostics/myc-prime-live-diag/events.jsonl
```

## After RUN03: one bounded repair ACT follows

If the trace classifies the boundary to a known category
(HOOK_ASSEMBLY, RUNTIME_SESSION_IDENTITY, PRIME_RECORDER_LIFETIME,
PRIME_INJECTION_GUARD, POST_HOOK_COMPOSITION_LOSS), a single bounded
repair ACT follows. If the trace says `NOT_REPRODUCED_LIVE`, the
successor ACT investigates the reproduction environment (probably
lifecycle / install order on a fresh profile).
