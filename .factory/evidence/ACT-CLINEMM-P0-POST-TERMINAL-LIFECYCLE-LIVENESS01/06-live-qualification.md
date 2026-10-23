# 06 — Live Qualification (R7)

## 6.1 Status: NOT EXECUTED — environment unblock required

Per §10, live qualification requires building a fresh VSIX from the exact
`SUBJECT_HEAD` source state and installing it into the dedicated ClineMM dogfood
profile. **This ACT did not reach that step**, for a mechanical reason, not a
judgment call:

### Exact unblock

1. **The extension toolchain is not installed in this environment.**
   - `which node npm npx bun` -> all four return "not found" on the default
     `PATH`. The toolchain only resolves when `/opt/homebrew/bin` is prepended
     explicitly (Homebrew `node` v26, `bun`, `npm`, `bunx` are present there).
   - The canonical build entry point is
     `cd apps/vscode && bun run package` (`bun run build:webview` then
     `bun esbuild.mjs` then `@vscode/vsce package`).
   - `apps/vscode/dist/` is gitignored and does not exist in this checkout, so
     `vsce package --out <path>` would fail its `stat` pre-write with a
     confusing `ENOENT` regardless of toolchain availability.
2. **The dogfood profile / Tart launch path is not provisioned here.**
   The `tools/macos-host-helper/native/.helper.identity` and `helper.ablated`
   untracked markers present at ENTRY_HEAD indicate the imported host helper is
   in an ABLATED state in this checkout. The ACT explicitly forbids modifying
   the imported VM or host helpers to work around this.
3. **The macOS debug harness additionally requires a scrubbed environment.**
   `ELECTRON_RUN_AS_NODE` and the other VSCODE/Electron variables must be
   stripped before launching, and Playwright's Electron launch must be run
   under `node`, not `bun` — neither is available without the toolchain above.

### Consequence

Per §13 this preserves `PASS_STRUCTURAL_PENDING_LIVE`. **No live claim is
made.** `DOGFOOD_SOURCE_HEAD`, `VSIX_PATH`, `VSIX_BYTES`, `VSIX_SHA256`,
`INSTALLED_EXTENSION_VERSION`, `SESSION_ID`, `TASK_ID`, `EPOCH`,
`C9_SUBMIT_ID` and `C10_COMPLETION_ID` are therefore **UNAVAILABLE** — they
would be fabricated otherwise, and this ACT does not fabricate evidence.

## 6.2 What the structural gates DO establish

The §10 "live success" criteria are each mapped to the executable assertion
that covers it, so a successor can qualify the LIVE half against a known
contract:

| §10 live criterion | Structural witness (ACT suite) |
|---|---|
| final `submit_and_exit` observed | `emitSubmitAndExit` drives the real `handleSessionEvent` done path; C9 capture asserted via the coordinator's monotonic `nextSubmitEventId` |
| all terminal obligations consumed | `expect(h.unconsumedCount()).toBe(0)` and `expect(h.heldJobIds()).toHaveLength(0)` against the REAL BCB store |
| BCB held set empty | same two assertions, on the real coordinator, not test-local counters |
| authoritative completion authorized | `h.elm.authorizeCount() > 0` before the C10 commit |
| C10 exactly one | `expect(h.completionCommitCount()).toBe(1)`; the coordinator mints one `completionId` per C10 |
| `legacyPhase = completed` | `expect(h.phaseWrites.at(-1)?.phase).toBe("completed")` |
| TaskHeader completed / Cancel absent | follows from `legacyPhase` — `getButtonConfigForMessages` maps a non-streaming phase to `BUTTON_CONFIGS.completion_result`, which has `secondaryAction: undefined` (webview untouched by this ACT) |
| C10 absent while an obligation is outstanding | LCV-07, RED-01 first half |
| no false completed state | LCV-09, LCV-06, LCV-07 |
| cancel fence raised | RED-04 `expect(fenceRaised).toBe(1)` |
| abort outcome classified | LCV-10 `expect(abortCalls).toBe(1)` on the active-session path |
| supported recovery state published | RED-04 `expect(publishedCount).toBe(1)` + phase `resumable` |
| late SDK effects fenced | RED-04 `expect(minter.epoch).toBeGreaterThan(epochBefore)` |
| no unrelated regression | §5.3 regression table (BCB01-C4 / BCB01 / all Elm + all task-control-liveness suites unchanged or passing) |

## 6.3 Live qualification checklist for the successor

1. Provision the toolchain on `PATH` (`node`, `bun`, `bunx`).
2. `mkdir -p apps/vscode/dist` before packaging.
3. `cd apps/vscode && bun run package` from the exact `SUBJECT_HEAD`.
4. Record VSIX path, byte size, SHA-256; install into the dedicated dogfood
   profile; verify installed version + build identity.
5. Enable the EXISTING diagnostics in the dogfood profile (no new ones were
   added): `completion-continuation-upstream`, `continuation-cardinality-authority`,
   `completion-authority-elm-authority`, `turn-state-writer-provenance`,
   `cancel-liveness-diagnostic`, plus the existing CCU runtime dump.
6. Run a task with background terminal results + completion continuation +
   final `submit_and_exit`; capture C9, C10, epoch/owner identity, legacy
   phase, webview publication, TaskHeader.
7. Confirm the LIVE H-A signature is now `(req=1, acc=0, inv=0, cmp=0, pub=1)`
   and NOT the old `pub=0`.
8. Exercise Cancel against an intentionally active task (expect Healthy
   `req=1,acc=1,inv=1,cmp=1,pub=1`).

## 6.4 Diagnostic removability (R8)

No new diagnostic was added by this ACT. The repair reuses the existing
`cancel-liveness-diagnostic` counters (whose H-A row was updated in place to
the repaired contract). Therefore:

- Root cause isolated AND the focused test permanently covers it ->
  `post-terminal-lifecycle-liveness01.test.ts` RED-03 (L1) and RED-04/LCV-09 (L2).
- No temporary diagnostic was introduced, so nothing needs removing at R8.
- The existing `cancel-liveness-diagnostic` was NOT created by this ACT and
  already belongs to an independently established product contract (a prior
  ACT's DEFAULT_OFF dogfood discriminator), so it is retained.
