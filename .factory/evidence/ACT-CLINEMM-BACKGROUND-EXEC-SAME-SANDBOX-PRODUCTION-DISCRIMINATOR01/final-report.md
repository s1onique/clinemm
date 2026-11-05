# Final Report

**ACT:** `ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01`
**Status:** `PASS_STRUCTURAL_ONLY` — code complete, artifact built and identity-verified, live installed-extension measurement NOT executed (operator required).

---

## 1. Executive summary

The ACT's single mission question —

> Does `(allow signal (target same-sandbox))` allow a ClineMM Background
> Exec workload to terminate its own child when launched by the real
> VSCodium extension host?

— is **NOT YET ANSWERED**. The decisive live measurement was blocked by
the agent's own execution substrate, exactly as the charter anticipated.

What IS delivered and verified:

1. The production seam was confirmed at source level, and every
   RECON01 anchor was verified at ENTRY_HEAD.
2. A **TEMPORARY, DEFAULT_OFF, ONE-SHOT** diagnostic was implemented that
   changes **exactly one profile line** for **exactly one command
   identity**, behind a **trusted host-side gate** that untrusted command
   content cannot activate.
3. All ten structural requirements (T1–T10) are satisfied and witnessed
   by 21 new process-free tests (all green) with **zero** new typecheck
   errors and **zero** new lint findings.
4. The diagnostic VSIX was built through the existing dogfood pipeline at
   exact HEAD, its identity recorded, its bundle verified to carry the
   diagnostic code, and it was **successfully installed** with a
   byte-identical bundle SHA-256.
5. The finite parent/child fixture was validated: it reproduces the RED
   `EPERM` signal AND is orphan-safe (independent 4s self-exit deadline;
   `ESRCH` afterwards).
6. A new, decisive piece of `LIVE` evidence was obtained: the **real**
   dogfood extension host's own live profile was captured from the system
   temp root, proving (a) the real host DOES apply the ClineMM Seatbelt
   profile, (b) it uses the ORIGINAL `(allow signal (target self))` rule,
   and (c) its `TMPDIR` is the SYSTEM per-user root — i.e. the extension
   host is NOT itself inside a ClineMM Seatbelt profile and therefore
   inherits ONLY the Chromium zygote authority. That is precisely the
   composition the candidate must be tested against.

**No architecture is selected.** `SELECT_SEATBELT_SIGNAL_REPAIR` and
`SELECT_COMPOSED_BOUNDARY_REPAIR` both remain open, and the evidence
collected here does NOT discriminate between them. The successor ACT
must be chosen by the live measurement, not by inference.

## 2. Why the live measurement was not executed

The agent's `run_commands` substrate is itself a ClineMM Background Exec
command inside a ClineMM Seatbelt profile:

* **Nested `sandbox-exec` is denied** there —
  `sandbox-exec: sandbox_apply: Operation not permitted` (rc=71).
  A VSCodium launched from that substrate produces an extension host that
  cannot apply ANY Seatbelt profile, so the candidate rule would never
  reach the kernel. That is `CAPTURE_INSUFFICIENT` (Case C), not a
  measurement.
* **The VSCodium extensions directory is outside the agent's writable
  roots** — `mkdir ~/.vscodium-clinemm/extensions/... → EPERM` — so the
  diagnostic VSIX cannot be installed into the running dogfood instance
  from here.

The charter explicitly forbids circumventing the agent's own sandbox to
manufacture these measurements, and explicitly forbids confusing a
nested `sandbox-exec` failure with the production result. Both were
honoured.

**Attempted and recorded** (`raw/agent-vscodium-launch.log`,
`raw/agent-vscodium-cli.log`):
install into `~/.vscodium-clinemm/extensions` → EPERM; install into a
repo-local (writable) extensions dir → **SUCCEEDED**, bundle SHA-256
verified identical; GUI launch from the substrate → the process exited
immediately with no extension host.

## 3. What was built

### 3.1 Source changes (diagnostic source head `cfd81f355`)

| File | Change |
|---|---|
| `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts` | Optional `signalTarget` option; DEFAULT `"self"` reproduces the original bytes exactly. |
| `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts` | PRIVATE module-level one-shot authorization slot + `resolveSignalTargetForInvocation()`; exact executable + full-argv match; consumed and revoked on first match, before the profile write. |
| `sdk/packages/core/src/index.ts` | Temporary barrel re-export (same shape as the pre-existing `setSeatbeltDiagnosticObserver` diagnostic precedent). |
| `apps/vscode/src/sdk/sandbox-policy.ts` | Trusted host-side opt-in gate: `CLINEMM_DIAG_SAME_SANDBOX_SIGNAL` + Seatbelt mode + `CLINEMM_RUNTIME_PROFILE=dogfood` + operator-stated exact command identity. |
| `apps/vscode/src/extension.ts` | Arms the diagnostic once, at the earliest activation seam. |
| `apps/vscode/src/test/cline-core-vitest-stub.ts` | Test-resolution bridge for the new symbols. |
| `apps/vscode/tsconfig.json` | Excludes the new stub-importing test from the base `tsc` program (same pattern as the existing Seatbelt observer test). |

**No public API, no user setting, no protocol field, no wire method, no
capability variant, no sandbox bypass, no global policy change.**

### 3.2 Tests

* `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-same-sandbox-discriminator01.test.ts` — 11 tests (T1–T9).
* `apps/vscode/src/sdk/__tests__/same-sandbox-production-discriminator01.policy.test.ts` — 10 tests (T2/T4 + fail-closed).

Both GREEN. Existing regression suites GREEN (40 profile + 25 backend).

### 3.3 Fixture

`.factory/evidence/.../probe-fixtures/same-sandbox-probe.mjs` — finite
parent/child Node probe reusing the RECON01/RECON02 behaviour, emitting
the §6 evidence shape as `SAME_SANDBOX_RESULT_JSON=<json>`.

## 4. Artifact identity

```
DOGFOOD_SOURCE_HEAD = cfd81f35594a759e185da97834923450f4ba8e9b
DOGFOOD_VERSION     = 4.1.16-5a1c485cb-cfd81f355
VSIX_PATH           = dist/clinemm-4.1.16-5a1c485cb-cfd81f355.vsix
VSIX_SIZE           = 49544306
VSIX_SHA256         = 16f5962428fb7c9039d33dffc28b7d664b9a4674d6526d625ee0c4829db8e568
BUNDLE_SHA256       = f183358f96fdc043f3677b11491c16051ceeae05f83bc17241d393f311da31f1
```

Built via `scripts/build-dogfood-vsix.py` (clean detached worktree at
exact HEAD, `skip_typecheck=false`, Elm 0.19.2). The extracted
`extension/dist/extension.js` carries the diagnostic symbols and STILL
carries the DEFAULT-OFF `(allow signal (target self))` rule.

## 5. Live evidence obtained

`LIVE` — the real dogfood extension host's own profile, captured from
the system temp root while the production extension was running:

```
/private/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T/
  clinemm-sandbox-profile-LiZbKs/profile-a385e0b4535d.sb
```

It contains `(allow signal (target self))` — the ORIGINAL production
rule — and the extension host's `TMPDIR` is the system per-user root
(not a `clinemm-sandbox-temp-*` dir), proving the extension host is not
itself ClineMM-Seatbelt-sandboxed.

`LIVE` (agent substrate) — the finite fixture's RED:

```
childReady=true   signalAttempt.errno=EPERM   childReceivedSigterm=false
childExited=true  childSelfExited=true  childStillAliveAfter=false
childAliveProbeErrno=ESRCH
```

No orphan. The RED is bound to the same finite fixture, the same
child-directed SIGTERM, and the same errno as the accepted RECON01
production-seam RED.

## 6. Not established

* The mission question itself (`NOT_EXECUTED`).
* Whether H2 (Seatbelt rule alone) or H3 (both authorities) is the
  production cause (`INFERRED` — H1 and H2 are each supported; H3 is not
  excluded).
* Candidate PGIDs in the production context (`LIVE_UNOBSERVABLE` from
  inside the sandbox — `/bin/ps` is denied there; the independent
  Terminal must observe them from the recorded PIDs).

## 7. Next action

Run the ONE live measurement per `OPERATOR-INSTRUCTIONS.md`, then:

* **Case A (GREEN)** → `SELECT_SEATBELT_SIGNAL_REPAIR` → bounded
  permanent implementation of the one-line profile repair (regression,
  adversarial, conservation, and real Vitest qualification). **No
  LaunchAgent.**
* **Case B (EPERM with the candidate applied)** →
  `SELECT_COMPOSED_BOUNDARY_REPAIR` → a minimal host-side command-launch
  discriminator, reusing the existing
  `process-group.register-owned` / `process-group.terminate-owned`
  primitive. **No unrestricted `execute(command,cwd,env)` method.**
* **Case C/D/E** → `CAPTURE_INSUFFICIENT` / `HALT_DIAGNOSTIC_NOT_APPLIED`.

Then **REMOVE** the diagnostic per `diagnostic-contract.md`
§Removal inventory and rebuild + reinstall a normal artifact.

## 8. Repository safety

* `stash@{0}` (the protected historical stash) was NEVER popped or
  modified; it is preserved.
* The pre-existing RECON02 evidence dirt was NOT modified — it was
  stashed intact during the clean-tree build and is currently preserved
  in the stash stack. **It must be restored before this ACT's board
  closure.**
* The native host helper was NOT restarted, rebuilt, or modified; its
  live `health` reported build ID
  `585ef8cb29cb2cff695a090c5c81c7cab4958e07f6e7383cf40da0613e958052`,
  PID `62790`, unchanged.
* No LaunchAgent registration was touched. No `sudo`, no SIP change, no
  service change.
* The historical native-helper files were NOT restored.
* No new orphan process was created by this ACT.
