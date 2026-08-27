# ACT-CLINEMM-PTAD-ENV-OPTIN01

> Status: **OPEN / IMPLEMENTATION SHIPPED** — adds a `CLINEMM_PTAD`
> environment opt-in that ORs with the existing persisted PTAD workspace
> toggle. Default off, additive, no schema/wire change, no forced-disable
> semantics.
> Primary purpose: diagnostic usability — eliminate the "rare evidence lost
> because I forgot the knob" failure mode. The diagnostic is temporary
> forensic infrastructure; remembering to invoke a command before a rare
> specimen appears is needless human-state dependency.
> Cuts in before `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01`
> because the failure mode it prevents (silent missed capture) is more
> expensive than the small follow-up work it adds.

## 0. Frozen contract

```text
PTAD_ENABLED =
  persistedWorkspaceToggle === true
  OR CLINEMM_PTAD === "1"
  OR CLINEMM_PTAD.toLowerCase() === "true"
```

Truth table (from the user-facing spec):

| persistedToggle | CLINEMM_PTAD | effective |
|-----------------|--------------|-----------|
| false | unset       | **OFF**   |
| true  | unset       | **ON**    |
| false | `"1"`       | **ON**    |
| false | `"true"`    | **ON**    |
| true  | `"0"`       | **ON**    (env does NOT force-disable) |
| true  | `"false"`   | **ON**    (env does NOT force-disable) |
| false | `"0"`       | **OFF**   (env parser treats `0` as "not contributing") |
| false | garbage     | **OFF**   (env source ignored) |

Conservation invariant: when `CLINEMM_PTAD` is unset, the merged predicate
is behaviorally/semantically equivalent to the pre-OPTIN01 workspace-only
predicate — two different implementations returning the same boolean for
every toggle state. No production path-semantic change in the default
build.

Scope boundaries:

- The env var **enables collection** (bounded ring-buffer recording).
- The env var does **NOT** automatically dump on every event.
- The existing dump command (`cline.debug.dumpPostTerminalAuthorityDiagnostic`)
  remains the manual trigger for serializing to JSONL.
- The existing toggle command
  (`cline.debug.togglePostTerminalAuthorityDiagnostic`) still flips ONLY the
  persisted workspace flag (env never mutates persisted state).

## 1. Production seam identified

```text
ENV_VAR                  = "CLINEMM_PTAD"
DEFAULT                  = unset -> no env contribution
TRUTHY                   = "1" | "true" (case-insensitive, whitespace-trimmed)
FALSY                    = "0" | "false" | unset | "" | garbage
HELPER                   = apps/vscode/src/sdk/post-terminal-authority-diagnostic-runtime.ts
                          (parseClinemmPtadEnv + isPostTerminalAuthorityDiagnosticEffectivelyEnabled)
SDKCONTROLLER_READ_SITES = apps/vscode/src/sdk/SdkController.ts
                          (sync block + wire-bit stamp)
WIRE_BIT                 = _ptadEnabled (UNCHANGED - extension stamps true if either source on)
                          _ptadPushId   (UNCHANGED)
NO_NEW_WIRE_FIELDS       = true
NO_SCHEMA_CHANGE         = true
NO_NEW_PERSISTED_KEY     = true (env var is not persisted)
NO_FORCED_DISABLE        = true (env "0" does not override persisted true)
```

## 2. Files (2 production + 2 test)

### Production

| File | Change |
|---|---|
| `apps/vscode/src/sdk/post-terminal-authority-diagnostic-runtime.ts` | NEW `parseClinemmPtadEnv(env?: NodeJS.ProcessEnv)` pure helper (default-arg seam; never inline `process.env` reads); NEW `isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, env?)` merged predicate (OR of persisted-toggle + env); both helpers documented with the full truth table |
| `apps/vscode/src/sdk/SdkController.ts` | Replace TWO call-sites of `isPostTerminalAuthorityDiagnosticWorkspaceEnabled(...)` with the merged `isPostTerminalAuthorityDiagnosticEffectivelyEnabled(...)` so the env opt-in arms the extension-side recorder on startup AND stamps the existing `_ptadEnabled` wire bit on every state push (webview auto-arms on next state-push). Remove the now-unused workspace-predicate import. |

### Test

| File | Change |
|---|---|
| `apps/vscode/src/sdk/__tests__/post-terminal-authority-diagnostic-runtime.test.ts` | NEW `R9: CLINEMM_PTAD env opt-in` describe block - `R9-A: parseClinemmPtadEnv` (9 cases pinning parser), `R9-B: isPostTerminalAuthorityDiagnosticEffectivelyEnabled truth table` (8 cases pinning the OR), `R9-C: conservation invariant` (2 cases pinning that the env var changes NOTHING when unset, and that the toggle command never reads process.env). Existing `R1-2` toggle test still passes unchanged. |
| `apps/vscode/src/sdk/__tests__/post-terminal-authority-diagnostic-wiring.test.ts` | Update `W5-2` to assert SdkController reads the **merged** predicate (not the bare workspace one); NEW `W14: ACT-CLINEMM-PTAD-ENV-OPTIN01 wiring` describe block (5 cases pinning both ends of the seam). |

Test totals:

- **24 NEW tests** added (`R9-A` x9 + `R9-B` x8 + `R9-C` x2 + `W14-1..5` x5)
- All 24 pass
- All 87 pre-existing PTAD tests still pass
- Targeted suite: 111/111 PASS

## 3. Design rationale (decisions captured)

1. **Centralized env parse in one helper** (not sprinkling `process.env`
   reads across capture sites). Two call-sites that need the env both
   take it via a `NodeJS.ProcessEnv = process.env` default-arg, so the
   only seam is the function signature - `W14-2` enforces exactly two
   `process.env` references in the runtime module's code (not comments).

2. **Merged predicate is the canonical read** at every SdkController
   site that asks "should this be armed?" The bare
   `isPostTerminalAuthorityDiagnosticWorkspaceEnabled(...)` is kept
   around ONLY because the toggle function inside the runtime module
   consults it. `W14-3` enforces that SdkController never calls the bare
   workspace predicate (which would silently bypass the env opt-in).

3. **Webview auto-arms via the existing wire bit.** The webview reads
   `stateData._ptadEnabled === true` and enables its recorder. The
   extension stamps `_ptadEnabled: true` whenever the merged predicate
   is true, so the webview needs NO new env-read on its own bundle side
   - `W14-4` enforces no new wire fields.

4. **Toggle command stays authoritative for the persisted flag.**
   `W14-5` enforces that `extension.ts` still calls
   `togglePostTerminalAuthorityDiagnosticWorkspaceEnabled(context)` for
   the toggle command - the env opt-in is purely additive and never
   mutates persisted state. The merged predicate re-arms the recorder
   on the next `getStateToPostToWebview` pass.

5. **No forced-disable.** Spec is explicit: `CLINEMM_PTAD=0` does not
   override a `true` persisted toggle. `R9-B5` and `R9-B6` pin this.

6. **No automatic dumping.** The env var arms the bounded 64-record
   ring buffer; the dump command is unchanged. This avoids uncontrolled
   disk logging and preserves the existing bounded design.

## 4. Why this fits the architecture

Upstream Cline already uses environment-gated debug-only behavior such as
`CLINE_CAPTURE_BROWSER=1`, and the debug harness launches the debugee
with that variable for browser-capture diagnostics. Cline also has a
broader established family of runtime env configuration
(`CLINE_BUILD_ENV`, `CLINE_DEBUG_*`, sandbox variables, etc.). The
existing codebase precedent for a `CLINEMM_*` env-var opt-in is
`CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL` in
`apps/vscode/src/sdk/task-state-shadow-host-wiring.ts:62`. So env-gated
PTAD is consistent with the existing architecture rather than inventing
a new configuration mechanism.

## 5. Conservation invariant

```text
CLINEMM_PTAD unset
  -> historical PTAD behavior byte-for-byte unchanged
```

Enforced by:

- `R9-C1` in the runtime test (the merged predicate equals the
  workspace-only predicate for every toggle state when env is unset)
- `W14-4` in the wiring test (no new wire fields added)
- The default-arg pattern means callers that don't opt into the env path
  get the same behavior as before (the only change is the SdkController
  read sites, and only the input to the boolean changes, not the
  boolean's output for env=unset)

## 6. Dogfood usage

```bash
CLINEMM_PTAD=1 codium .
# or inject it into whatever launch script starts the dogfood VSCodium
```

Then PTAD is armed **from extension startup**, and the developer only
needs the dump command when the interesting symptom appears.

In the running dogfood session, the existing
`cline.debug.togglePostTerminalAuthorityDiagnostic` command still flips
the persisted workspace flag (and the UI shows the
"ENABLED/DISABLED" notification as before). The dump command
`cline.debug.dumpPostTerminalAuthorityDiagnostic` still flushes the
JSONL files. The env var simply removes the requirement to remember
to invoke the toggle before the specimen appears.

## 7. Removal / supersession

This ACT introduces temporary diagnostic infrastructure. The
removal/evolution sequence mirrors the existing PTAD sequence:

- First of (root cause classified, capture insufficient, successor
  evidence supersedes this diagnostic).
- The env opt-in can be removed independently of the persisted toggle
  by deleting `parseClinemmPtadEnv` + the merged predicate and
  restoring the bare workspace predicate at the two SdkController
  read-sites.
- The toggle + dump commands remain until the diagnostic itself is
  removed.

## 8. Future maintenance notes

- **Avoid `process.env` reads anywhere in the SDK or webview except
  through the helpers in this ACT** - the `W14-2` assertion will catch
  it. If a future caller needs an env value, take it as a
  `NodeJS.ProcessEnv = process.env` default-arg parameter so tests can
  inject a deterministic env.
- **If a different env var is preferred**, rename `CLINEMM_PTAD` in
  `parseClinemmPtadEnv` only - the call-sites go through the merged
  predicate and need no change.
- **If forced-disable semantics are ever wanted**, the spec docstring
  on `isPostTerminalAuthorityDiagnosticEffectivelyEnabled` calls out
  that it would require flipping the short-circuit to also check
  `!parseClinemmPtadEnv(env)` in the truthy branch - but that is NOT
  this ACT.
