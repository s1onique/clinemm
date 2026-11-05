# Causal Decision

**ACT:** `ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01`
**Diagnostic source head:** `cfd81f35594a759e185da97834923450f4ba8e9b`

---

## Verdict

**`PASS_STRUCTURAL_ONLY`** — the code, the structural gates, the
artifact, and the finite fixture are complete and verified; the live
installed-extension measurement was NOT executed by the agent and must
be run by the operator (see `OPERATOR-INSTRUCTIONS.md`).

**No architecture is selected.** The mission question — "does
`(allow signal (target same-sandbox))` allow a ClineMM Background Exec
workload to terminate its own child when launched by the real VSCodium
extension host?" — remains **UNOBSERVED**. Selecting
`SELECT_SEATBELT_SIGNAL_REPAIR` or `SELECT_COMPOSED_BOUNDARY_REPAIR`
from the evidence gathered so far would be an inference-to-proof
promotion, which the charter forbids.

---

## What IS established

### 1. The production seam is confirmed at source level (`STRUCTURAL`)

The full chain was traced and every RECON01 anchor verified at
ENTRY_HEAD `56982887bd866182d45bac6b802e9374fe60bfe8`:

```
VSCodium → Extension Host → VscodeSessionHost → CommandJobManager.start()
  → SeatbeltSandboxBackendExperimental.prepare()
  → generateSeatbeltProfile() → writeFileSync(<profile>.sb)
  → spawnSupervisableShellCommand() → spawn()
  → /usr/bin/sandbox-exec -f <profile> /bin/bash -c <cmd>
  → Node parent → Node child → SIGTERM
```

See `production-seam.md` for the eight-answer authority map.

### 2. The real extension host DOES apply the Seatbelt profile, and uses the ORIGINAL rule (`LIVE`)

The running dogfood extension host (PID 90006 / extension host 90069)
wrote a real profile into the SYSTEM per-user temp root:

```
/private/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T/
  clinemm-sandbox-profile-LiZbKs/profile-a385e0b4535d.sb
```

containing `(allow signal (target self))`.

Two load-bearing facts follow:

* The real extension host **can** apply a Seatbelt profile (the profile
  exists on disk and the command ran under it) — so the profile
  application step is NOT the obstacle.
* The extension host's `TMPDIR` is the **system** per-user temp root,
  NOT a `clinemm-sandbox-temp-*` directory. Therefore the extension host
  is **NOT** inside a ClineMM Seatbelt profile. It inherits ONLY the
  Chromium zygote sandbox authority, and adds the ClineMM authority
  itself. That is exactly the composition this ACT must test.

### 3. The diagnostic is DEFAULT_OFF and signal-only (`STRUCTURAL`)

| Requirement | Result | Evidence |
|---|---|---|
| T1 default behaviour byte-identical | PASS | `structural-tests.txt`; `profile-diff.txt` `BASELINE_EQUALS_DEFAULT_OPTION=true` |
| T2 explicit target | PASS | `seatbelt-same-sandbox-discriminator01.test.ts` (backend-level, reads the profile actually written to disk) |
| T3 unrelated command | PASS | same file |
| T4 spoofed activation | PASS | same file (marker in argv / different executable) + policy test (public profile) |
| T5 single invocation | PASS | same file (one-shot: the authorization is revoked after the first matching `prepare()`) |
| T6 exact profile difference | PASS | `profile-diff.txt`: `DIFFERING_LINE_COUNT=1`, line 4 only |
| T7 filesystem/network conservation | PASS | `profile-diff.txt` full bodies; `NO_BROAD_SIGNAL_RULE=true` |
| T8 fail-closed preparation | PASS | the authorization is consumed BEFORE the profile write, so a failed write cannot leave a live authorization; `prepare()` still throws `SandboxError` on any failure and the executor never falls back to unsandboxed execution |
| T9 read-only observer | PASS | `getSeatbeltDiagnosticObserver()` is `undefined` by default; the existing observer was NOT repurposed |
| T10 removal inventory | PASS | `diagnostic-contract.md` §Removal inventory |

### 4. The finite fixture reproduces the RED signal and is orphan-safe (`LIVE`, agent substrate)

`raw/red-agent-substrate.result.json`:

```
childReady          = true
signalAttempt.ok    = false
signalAttempt.errno = EPERM
childReceivedSigterm= false
childExited         = true
childSelfExited     = true
childStillAliveAfter= false
childAliveProbeErrno= ESRCH
```

The SAME fixture, the SAME child-directed `SIGTERM`, the SAME `EPERM`,
and a CLEAN exit with NO orphan. The child has an independent 4-second
self-exit deadline, so a denied signal cannot leak a process.

### 5. The artifact is built, identity-verified, and carries the diagnostic (`STRUCTURAL` + `LIVE` install)

```
VSIX_PATH   = dist/clinemm-4.1.16-5a1c485cb-cfd81f355.vsix
VSIX_SIZE   = 49544306
VSIX_SHA256 = 16f5962428fb7c9039d33dffc28b7d664b9a4674d6526d625ee0c4829db8e568
BUNDLE_SHA256 = f183358f96fdc043f3677b11491c16051ceeae05f83bc17241d393f311da31f1
```

The VSIX was built through the existing dogfood pipeline
(`scripts/build-dogfood-vsix.py`) with clean detached-worktree semantics
at exact HEAD. The diagnostic code is present in the extracted
`extension/dist/extension.js` (2× the env-var name, 1× the arming
symbol, 1× the candidate rule), the DEFAULT-OFF self-only rule is still
present, and the VSIX was **successfully installed** into a writable
extensions dir with a byte-identical bundle SHA-256.

---

## What is NOT established

### The decisive measurement was not executed

The agent's `run_commands` substrate is itself a ClineMM Background Exec
command running inside a ClineMM Seatbelt profile. Two hard blocks:

1. **Nested `sandbox-exec` is denied** there:
   `sandbox-exec: sandbox_apply: Operation not permitted` (rc=71).
   A VSCodium extension host launched from that substrate would be
   unable to apply ANY Seatbelt profile — the candidate rule would never
   reach the kernel. That is **Case C** (`CAPTURE_INSUFFICIENT`), not a
   measurement.
2. **The VSCodium extensions directory is outside the agent's writable
   roots**: `mkdir ~/.vscodium-clinemm/extensions/... → EPERM`. The
   diagnostic VSIX cannot be installed into the running dogfood instance
   from here.

Both blocks are the same substrate constraint that RECON01/RECON02's
operator harnesses already faced. Per the charter, nested
`sandbox-exec` failures must NOT be confused with the production
result — so no candidate measurement was attempted from here.

### The composition remains INFERRED

| Hypothesis | Status |
|---|---|
| H2 — the ClineMM `target self` rule alone causes the production EPERM | **SUPPORTED** by RECON02 probe B (independent Terminal, current profile → EPERM) and by RECON01 (production seam → EPERM). |
| H1 — the inherited Chromium sandbox alone causes it | **SUPPORTED** by E5 (the earlier inherited-sandbox EPERM witness without an additional ClineMM profile). |
| H3 — both contribute | **NOT EXCLUDED.** The only observation that separates H2-alone from H3 is the live candidate measurement, which is `NOT_EXECUTED`. |

### Remaining unobservables

1. Whether `(allow signal (target same-sandbox))` is accepted by the
   kernel **under the inherited VSCodium authority** — the mission
   question. `NOT_EXECUTED`.
2. Whether the candidate rule's scope is safely confined in the
   production context (RECON02 probe D qualified the standalone rule
   against a controlled foreign Node process → EPERM, target survived;
   that qualification was measured in an independent Terminal, not in
   the inherited context).
3. The candidate job's exact parent/child PGIDs in the production
   context — `/bin/ps` is denied inside the Seatbelt profile, so PGID
   observation is `LIVE_UNOBSERVABLE` from inside the sandbox and must
   be done by the independent Terminal from the recorded PIDs.

---

## Decision rule for the operator

| Live observation | Verdict |
|---|---|
| `ok=true` + `childReceivedSigterm=true` + `childExited=true` + `childStillAliveAfter=false` + cleanup verified + profile has exactly one `same-sandbox` rule | **`SELECT_SEATBELT_SIGNAL_REPAIR`** |
| `errnoCode=EPERM` + `childReady=true` + `childSelfExited=true` + cleanup verified + profile has exactly one `same-sandbox` rule | **`SELECT_COMPOSED_BOUNDARY_REPAIR`** |
| Profile generated with `same-sandbox` but `sandbox-exec` failed before the child started | **`CAPTURE_INSUFFICIENT`** |
| Profile still contains `(allow signal (target self))`, or the candidate rule appears zero times, or the identity did not match | **`HALT_DIAGNOSTIC_NOT_APPLIED`** |
| `childReady=false` / `ESRCH` / missing delivery evidence / cleanup unverifiable | **`CAPTURE_INSUFFICIENT`** |
| Any unauthorized filesystem/network grant, unrelated job affected, unrelated process signalable, or Seatbelt bypassed | **`HALT_UNSAFE_SIGNAL_SCOPE`** |

---

## Security conservation (verified)

| Boundary | Status | Basis |
|---|---|---|
| Process signalling scope | **TARGET OF THE CHANGE** | `target self` → `target same-sandbox`, ONE line, ONE job, ONE-SHOT |
| Filesystem write grants | **CONSERVED** | byte-identical (`profile-diff.txt` full bodies) |
| Read authority | **CONSERVED** | `(allow file-read*)` + deny carve-outs byte-identical |
| Network | **CONSERVED** | `(deny network*)` byte-identical; no `network-inbound` grant |
| Host-helper socket rules | **CONSERVED** | exact `path-literal` pair byte-identical |
| SSH-agent socket rules | **CONSERVED** | exact `path-literal` pair byte-identical |
| Environment capability | **CONSERVED** | unchanged `SAFE_ENVIRONMENT_BASELINE` allow-list; the diagnostic flag is NOT forwarded to the child |
| Canonical cwd | **CONSERVED** | unchanged canonicalization path |
| Broad `(allow signal)` | **ABSENT** | `NO_BROAD_SIGNAL_RULE=true` |
| Host helper / LaunchAgent | **UNCHANGED** | not restarted, not modified; build ID `585ef8cb...` verified live at entry |
| PGID ownership tokens / helper protocol | **UNCHANGED** | no helper protocol change, no `execute(command,cwd,env)` method |
| Output / completion handling | **UNCHANGED** | no change to the output, status or lifecycle path |
| Default sandbox policy | **UNCHANGED** | the profile default remains `(allow signal (target self))` |

## Signal-authority qualification limit

Even on a GREEN result, the candidate is qualified for signalling
**same-sandbox processes**, not exclusively owned descendants. The
standalone qualification (RECON02 probe D) showed the candidate denies a
controlled foreign same-UID Node process. No claim of ownership-only
isolation may be made from this ACT.
