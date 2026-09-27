# ACT-CLINEMM-BACKGROUND-COMPLETION-LIVE01 — Operator Runbook

## Phase 1 — Install the CORRECTION04 build into your dogfood VSCodium

The current dogfood install at
`~/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-6abd73a15/` is the
**PRE-CORRECTION04** build (it has `enqueueCompletionContinuation` /
`lastCompletionContinuationSessionEpoch` from CORRECTION03 but is **missing**
the CORRECTION04 trigger fire inside `reevaluateDeferredCompletionBarrier`).

A fresh VSIX built from `6abd73a15` with the CORRECTION04 chain is ready at:

```
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/dist/clinemm-4.1.16-6abd73a15.vsix
```

Replace the extension in your dogfood profile:

```bash
/Applications/VSCodium.app/Contents/Resources/app/bin/codium \
  --user-data-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data \
  --extensions-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions \
  --install-extension /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/dist/clinemm-4.1.16-6abd73a15.vsix \
  --force
```

The CLI install may fail with EPERM under the macOS sandbox. If so, the existing
`dist/extension.js` lives in the read-only extension directory and cannot be
replaced from this process. As an alternative, **Reload Window** in the running
VSCodium (the pre-CORRECTION04 build is on disk; this is exactly the bug the
ACT is live-qualifying — so re-install from inside the VSCodium UI via the
Extensions panel is the right path).

## Phase 2 — Confirm diagnostics are armed

Make sure the dogfood launch sets `CLINEMM_RUNTIME_PROFILE=dogfood`. The
Continuitiy Cardinality Authority (CCARD) diagnostic only captures when
`isDogfoodRuntime() === true`. Check the launchctl / Squirrel plist for the
dog, or set the env var before the next manual restart.

Without this knob, the CCARD ring stays empty and the JSONL dump will be a
zero-line file — the diagnostic pipeline is correct, just gated off.

## Phase 3 — Run the live scenario

Open the Cline sidebar (Cmd-Shift-P → `Cline: Open in New Tab` or click the
icon). Send exactly this user prompt to a fresh Cline session:

> Start four finite commands in the background, with durations of roughly 3, 5,
> 7, and 9 seconds. Each should print a unique final token `BCB-LIVE-J1` through
> `BCB-LIVE-J4`. Continue working while they run. Before finishing, make sure
> you have observed the terminal result of every command. Do not ask me for
> input merely because a background command is still running.

Then **do not send any further user message** until either:

- The model reports task completion with the four `BCB-LIVE-J*` tokens accounted for, OR
- The session sits idle in "Your turn" with unobserved terminal jobs for >30 s.

## Phase 4 — Capture the diagnostics

After the scenario settles, dump each diagnostic via the Command Palette:

```
Cmd-Shift-P → "Cline Debug: Dump Continuation Cardinality Authority"
Cmd-Shift-P → "Cline Debug: Dump Background Job Liveness Authority"
Cmd-Shift-P → "Cline Debug: Dump Background Owner Correlation"
Cmd-Shift-P → "Cline Debug: Dump Host Ownership Diagnostic"
```

Each dump writes to `<globalStorageUri>/<diagnostic>.jsonl` (plus a
`<diagnostic>.counters.json` for the cardinality dump).

The Cline globalStorageUri for your dogfood profile is:

```
/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data/User/globalStorage/s1onique.clinemm
```

Copy the resulting JSONL / counters files into:

```
.factory/evidence/ACT-CLINEMM-BACKGROUND-COMPLETION-LIVE01/03-ccard.jsonl
.factory/evidence/ACT-CLINEMM-BACKGROUND-COMPLETION-LIVE01/03-ccard.counters.json
.factory/evidence/ACT-CLINEMM-BACKGROUND-COMPLETION-LIVE01/04-bjla.jsonl
.factory/evidence/ACT-CLINEMM-BACKGROUND-COMPLETION-LIVE01/05-bocor.jsonl
.factory/evidence/ACT-CLINEMM-BACKGROUND-COMPLETION-LIVE01/06-host-ownership.jsonl
```

## Phase 5 — Adjudicate

Walk the LIVE_A..LIVE_F decision matrix from the ACT body using the dumped
records. Update `result.json` with `verdict` and the six per-LIVE verdicts,
then write the final summary into this evidence directory and close the ACT.

## Sandbox note

This session could not drive the harness live — the harness downloads its own
VSCode binary that SIGSEGVs under the macOS sandbox (same class as
ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01), and any new VSCodium with a
fresh user-data-dir silently exits. The existing dogfood VSCodium is the only
real VSCodium available, so the live run is operator-driven.

The artifact-preparation half is complete and reproducible: `apps/vscode/dist/extension.js`
and `dist/clinemm-4.1.16-6abd73a15.vsix` were both built from `6abd73a15` and
contain the full CORRECTION04 chain. The diagnostic capture infrastructure
(CCARD / BJLA / BOCOR / host-ownership) was reviewed for completeness and is
exactly what the ACT asks to capture.
