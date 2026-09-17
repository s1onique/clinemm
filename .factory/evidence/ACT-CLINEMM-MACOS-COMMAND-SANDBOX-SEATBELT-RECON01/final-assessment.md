# ACT-CLINEMM-MACOS-COMMAND-SANDBOX-SEATBELT-RECON01 — Final Assessment

## Verdict

```
PASS_SEATBELT_RECON_PRODUCTION_CANDIDATE
```

Seatbelt (`/usr/bin/sandbox-exec`) is a viable per-command capability substrate on this macOS host (14.7.4, arm64, Darwin 23.6.0). All ten questions (Q1-Q10) resolve positively for the architecture we want — a CommandCapability-driven profile generator with workspace, network, and descendant-process boundaries.

## Host

| Field | Value |
|-------|-------|
| OS | macOS 14.7.4 (Build 23H420) |
| Kernel | Darwin 23.6.0 arm64 (xnu-10063.141.1.703.2~1) |
| SDK | 14.0 |
| Substrate binary | `/usr/bin/sandbox-exec` (118 944 bytes, Feb 4 2025, universal x86_64+arm64e) |
| Host-specific quirk | Nix-Darwin shell: `rg`, `git`, `go` live under `/nix/store/<hash>-<pkg>/` |
| $HOME | `/Volumes/UserData/Users/chistyakov` (real directory, not a symlink) |

The Nix-Darwin substrate is a useful stress test: it forces the profile generator to handle non-standard binary locations. Pure-vanilla macOS results should be identical or stricter, never more permissive.

## Q & A summary

| # | Question | Result |
|---|----------|--------|
| Q1 | Is sandbox-exec present and functional? | YES |
| Q2 | Can it deny reads outside a designated workspace? | YES (with `(subpath "...")` on canonical resolved path) |
| Q3 | Can it allow normal workspace reads? | YES |
| Q4 | Can it independently allow/deny workspace writes? | YES (separate `file-read*` / `file-write*` rules) |
| Q5 | Do restrictions inherit into bash / sh / node / python / git? | YES (all 5 verified) |
| Q6 | Can network be denied? | YES |
| Q7 | Can localhost / Unix sockets be treated separately? | YES — `(remote ip "localhost:*")` allowed; `(deny network*)` blocks AF_UNIX to system sockets; in-process `socketpair()` still works |
| Q8 | Which common developer commands break? | `ps` (image activation), `Keychain` access (requires user-inherited entitlements not present in shell), nothing else |
| Q9 | Can we generate profiles from capability state? | YES (probe in `capability-model-probe.ts`) |
| Q10 | Is the backend usable enough to justify production work? | YES |

## Critical implementation gotchas (load-bearing for production)

### 1. Path-resolution vs textual-path matching

macOS exposes many "synthetic" symlinks: `/tmp` → `/private/tmp`, `/var` → `/private/var`, etc. Seatbelt's `(subpath "/tmp")` matches against the **resolved vnode path**, NOT the textual path passed by the process. So `(subpath "/tmp")` does NOT match `/tmp/foo` if the vnode is `/private/tmp/foo`.

**Rule**: always use the canonical macOS path (`/private/tmp`, `/private/var/folders/...`). Anything else silently no-ops.

### 2. `require-not` semantics at filter level

Two `(require-not X) (require-not Y)` clauses at the same level behave as **OR**, not AND. So `(allow file-read* (require-not X) (require-not Y))` denies only paths matching BOTH X AND Y, which is usually not what you want.

**Rule**: wrap multiple exclusions in `(require-all (require-not X) (require-not Y) ...)` to get AND semantics.

### 3. `deny` after `allow` works

`(allow file-read*) (deny file-read* (subpath OUTSIDE))` correctly denies reads of OUTSIDE (direct and via symlink from inside). This is the cleanest containment pattern.

### 4. `network-outbound` syntax

`(remote ip "127.0.0.1:*")` is rejected at profile-parse time ("host must be * or localhost"). Use `(remote ip "localhost:*")` instead.

### 5. Environment variables are NOT sanitized

Seatbelt does not touch the environment. `SSH_AUTH_SOCK`, `NIX_SSL_CERT_FILE`, `HOME` and friends pass through. A second layer (env scrubbing before exec) is required if ClineMM wants to limit credential exposure. This is the most important open item for a future ACT.

### 6. `ps` cannot be exec'd

Even with `(allow process-info*)` added, `/bin/ps` itself fails to exec under deny-default. Seatbelt does not relax this for the ps image. Workaround: not needed for ClineMM (the agent doesn't need `ps`).

### 7. Process inheritance

bash, sh, env, python3, node children all inherit the parent's sandbox. None can escape via execve.

### 8. Symlink containment

A symlink at `INSIDE/link-out -> ../outside` is contained by `(deny file-read* (subpath "outside"))`. Seatbelt resolves the path before matching.

## Recommended production profile shape

```scheme
(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup)
(allow file-read*
  (require-all
    (require-not (subpath "<HOME>/.ssh"))
    (require-not (subpath "<HOME>/.aws"))
    (require-not (subpath "<HOME>/.gnupg"))
    (require-not (subpath "<EXCLUDED_DIR>"))))
(allow file-write* (literal "/dev/null") (literal "/dev/tty") (subpath "/tmp") (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "<WORKSPACE>"))
(deny network*)
(allow file-read-metadata (subpath "/"))
```

See `profiles/production-shape-recommended.sb` for the exact file.

## Apple support posture

`sandbox-exec` is a **documented** macOS binary and Apple has historically used it internally (it predates the public App Sandbox), but it is **not part of the public App Sandbox API**. Apple supports `App Sandbox` (entitlement-based, kernel-enforced) and `Embedding a helper tool in a sandboxed app` (Developer-ID-friendly). The latter is the recommended fallback if `sandbox-exec` is ever deprecated.

**Support status**:
- `sandbox-exec`: EXPERIMENTAL_UNSUPPORTED_INTERFACE — works on macOS 14.7.4 today, but Apple could change semantics without notice.
- App Sandbox + helper: SUPPORTED_PATH_FOUND — more work to wire up, but real Apple backing.

## Long-term substrate comparison (no implementation, just scoring)

| Dimension | Seatbelt / sandbox-exec | App-Sandboxed helper | Lightweight VM / container |
|-----------|--------------------------|----------------------|----------------------------|
| Startup latency | ~10–30 ms per command | ~50–200 ms (XPC handshake) | ~500 ms+ (VM) or ~100 ms (container) |
| Filesystem isolation | Subpath rules (good enough) | Full per-helper container | Total |
| Network isolation | Per-rule granular | Per-helper global | Per-NIC |
| Descendant inheritance | Yes (kernel-enforced) | Yes (entitlement-inherited) | Yes (kernel namespace) |
| Dynamic per-command policy | Yes (regenerate profile) | No (helper has one sandbox) | Yes (per-container spec) |
| Developer-tool compatibility | Mostly works (see caveats) | Needs entitlements per tool | Total |
| Supportability | Undocumented API | Apple-supported | Vendor-specific |
| Signing / deployment burden | None | Code signing required | Image distribution |
| Future-proofing | Risk | Low risk | Medium risk |

**Conclusion**: Seatbelt offers the best dynamic policy + low-latency combination for ClineMM's threat model. App-Sandbox helper is the right fallback if Seatbelt is ever deprecated.

## Next ACT

```
ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01
```

Scope:
- Define `SandboxBackend` interface
- Port `capability-model-probe.ts` into a real generator
- Add `SeatbeltBackend` implementation, **default OFF**
- Add unit tests that materialize a profile from each canonical CommandCapability and assert deny/allow invariants
- **Zero behavior change when the feature flag is off**

Then separately:
```
ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD01
```
Opt-in installed qualification (real ClineMM-spawned commands under sandbox).
