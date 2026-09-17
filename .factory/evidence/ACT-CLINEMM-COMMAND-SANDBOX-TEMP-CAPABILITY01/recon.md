# ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01 — recon

## Current state of the tempRoot seam

The `tempRoot` capability field is ALREADY plumbed end-to-end through the
production code path. It is just never POPULATED by the production builder.

| Layer | Status | File:line |
|-------|--------|-----------|
| `CommandCapability.tempRoot?: string` exists | yes | `sdk/packages/core/src/runtime/sandbox/types.ts:122` |
| Docstring: "backend synthesizes one under the system temp root" when omitted | yes (documented) | `types.ts:113` |
| `seatbelt-backend.prepare()` canonicalizes caller-supplied `tempRoot` | yes | `seatbelt-backend.ts:191-204` |
| `seatbelt-backend.prepare()` SYNTHESIZES one when omitted | **NO (gap)** | `seatbelt-backend.ts:191` only enters `if (cap.tempRoot)` |
| Profile emits `(allow file-write* (subpath "<tempRoot>"))` | yes | `seatbelt-profile.ts:204-206` |
| `materializeEnvironment` sets `TMPDIR=syntheticTempDir` | yes | `environment.ts:205-207` |
| `prepare()` cleanup removes profileDir (NOT tempRoot) | yes | `seatbelt-backend.ts:280-282` |
| Production builder `buildExperimentalReconCapability` populates `tempRoot` | **NO (gap)** | `apps/vscode/src/sdk/sandbox-policy.ts:142-160` always returns `writableRoots: []` and never sets `tempRoot` |
| `os.tmpdir()` on macOS | per-user `/var/folders/.../T` | node `os.tmpdir()` returns this — canonicalized by realpath |

## Conflict between two docstrings

Two existing docstrings disagree about who owns `tempRoot` allocation
when the caller omits it:

  - `types.ts:113`:
    "When `tempRoot` is omitted and `environment.mode='sanitized'`,
    the backend synthesizes one under the system temp root."
  - `environment.ts:17`:
    "When the capability does not provide a `tempRoot`,
    the caller is responsible for allocating one before invoking
    `materializeEnvironment`."

The implementation (`seatbelt-backend.ts:191`) is silent — it never
synthesizes AND never asks the caller.

Verdict: the `types.ts:113` contract is the more recently authored
contract (it carries the explicit "synthetic TMPDIR" wording that
matches what `materializeEnvironment` actually does today). The
`environment.ts:17` wording is a relic from before backend synthesis
was specified. **Honor `types.ts:113`** and synthesize in `prepare()`.

## Profile ordering

The Seatbelt profile already orders the rules correctly:

  1. `(allow file-write* (subpath "<tempRoot>")) ...` (synthesized tempRoot)
  2. `(allow file-write* (literal "/dev/null") ...)` (always-writable)
  3. `(allow file-write* (subpath "/dev/...") ...)` (always-writable system subpaths)
  4. `(deny file-write* (subpath "<readonlyRoot>"))` for each readonlyRoot

Seatbelt processes rules in order; later deny wins over earlier allow
on overlapping subpaths. So if a `readonlyRoot` is a descendant of
`tempRoot`, the deny correctly wins. No need to special-case overlap.

The Wave-1 capability has `readonlyRoots = workspace roots` and
`writableRoots = []`. The synthesized `tempRoot` will be created
under `os.tmpdir()` (per-user `/var/folders/.../T`), which is NOT a
descendant of any user workspace. Overlap is impossible by
construction.

## Tests already in place

- `seatbelt-profile.test.ts:165` — profile emits `(subpath "<tempRoot>")`
- `seatbelt-profile.test.ts:183` — profile is deterministic given tempRoot
- `seatbelt-backend.test.ts` — exists but does NOT exercise tempRoot
- `command-job-manager.sandbox-c3-real-kernel.test.ts:183` — proves
  that `writableRoots=[]` denies writes outside workspace AND outside
  /dev/null. This is exactly the negative proof that mktemp gets
  EPERM at the kernel today.

## Dogfood RED (Wave-1 evidence, already frozen)

```
T01: mktemp       → exit 1, stderrClass=kernel-eperm, COMPATIBILITY_FAIL
T02: mktemp -d    → exit 1, stderrClass=kernel-eperm, COMPATIBILITY_FAIL
E04: TMPDIR=      → expected "informational", stdout empty
```

Live at `apps/vscode/.factory/evidence/ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01/probe-results.jsonl`.

## Decision: backend synthesizes tempRoot when omitted (option A from §10)

Reasons:
1. types.ts:113 already documents this.
2. The lifecycle stays localized: prepare() creates, cleanup() removes.
3. The builder (buildExperimentalReconCapability) doesn't need to
   change — backend honors its own contract.
4. Sandbox-policy.ts becomes simpler, not more complex.
5. Existing profile-temp-dir allocation (seatbelt-backend.ts:222)
   already uses `mkdtempSync(join(tmpdir(), PREFIX))` — synthesized
   tempRoot uses the same pattern.
