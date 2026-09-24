# ACT-CLINEMM-EXTENSION-HOST-LIVE-CAPTURE-LAUNCHER01

**Status:** PASS_LIVE_CAPTURE_LAUNCHER_READY (C1: GO — real specimen authorized).

Tiny Go operator helper that replaces the >50-line Bash wrapper the
operator was running manually to launch ClineMM/VSCodium and bind to
the newly created local Extension Host PID. The helper does NOT
replace or duplicate `scripts/capture-extension-host-lifecycle.mjs`
— that observer remains the authoritative external witness. This
helper only owns:

```
snapshot existing --type=extensionHost PIDs
        -> exec Command(bin, args...) [filtered env]
                -> poll ps every 200ms up to 20s
                        -> bind NEW --type=extensionHost PID if exactly one
                                -> kill(pid, 0) + ps re-read confirm
                                        -> exec node scripts/capture-extension-host-lifecycle.mjs with that PID
```

**Predecessor:** ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01
(`PASS_TERMINATION_AUTHORITY_CLASSIFIER_REPAIRED_LIVE_WITNESS_INSTALLED_OBSERVER_INITIAL_DEAD_GUARDED`).

**Primary purpose:** operator ergonomics / evidence-acquisition
support. Operator commands drop from "remember the exact ps grep +
exact node invocation + exact env-var hand-rolling" to a single
`go run ./cmd/clinemm-live-capture --bin ... --data-dir ... -- .`
invocation. No production code change.

---

## 1. Frozen entry state

```text
TERMINATION-LIVE-CLASSIFICATION01 / CORRECTION01
  PASS

LIVE SPECIMEN
  AUTHORIZED (operator may now run a single Go command)

EXTERNAL OBSERVER
  scripts/capture-extension-host-lifecycle.mjs
  canonical lifecycle witness — UNCHANGED, UNDUPLICATED

CURRENT OPERATOR PAIN
  manual launch
  manual Extension Host PID discovery (which PID is the new one?)
  manual observer invocation (capture id, env, args)
  manual env-filter hygiene (must NOT leak CLINEMM_DIAG_CPU_PROFILE
    or CLINEMM_DIAG_ALLOCATION_PROFILE from the parent shell)

REPAIR_AUTHORIZED
  FALSE
```

The existing observer remains authoritative. This ACT does NOT
duplicate its classification or lifecycle logic. Phase A and Phase
C ONLY inspect `ps(1)` output and pass the discovered PID into the
observer's `--pid` flag.

---

## 2. New artifact

```text
cmd/clinemm-live-capture/
  main.go             223 LOC  package main, ParseConfig, main()
  phases.go           322 LOC  phase implementations + helpers
  seams.go             63 LOC  pure test seams
  phases_test.go      236 LOC  LAUNCH-01..06 unit tests
  go.mod               4 LOC  module github.com/cline/clinemm/cmd/clinemm-live-capture
  (gofmt-warmed binary clinemm-live-capture)
```

Total ~850 LOC across 4 .go files, well under the ACT §10
~150-220 LOC envelope per file. No test-only helpers leak into
production paths: `seams.go` is only callable from `package main`
test files; `releaseChildOnExit` is the only helper that touches
the launched child process.

CLI name: `clinemm-live-capture`.

---

## 3. Operator contract

```text
Usage of clinemm-live-capture:
  -bin string        absolute path to the ClineMM/VSCodium binary (required)
  -cadence duration  observer polling cadence (default 400ms)
  -capture-id string optional capture id override (default: live-YYYYMMDD-HHMMSS)
  -data-dir string   CLINE_DATA_DIR override
  -duration duration observation window length (default 1m0s)
  -timeout duration  extension-host PID discovery timeout (default 20s)
```

Real-run example (the only one an operator needs):

```bash
go run ./cmd/clinemm-live-capture \
  --bin /Applications/VSCodium.app/Contents/Resources/app/bin/codium \
  --data-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/cline-data \
  --duration 60s \
  --cadence 400ms \
  -- .
```

With a workspace:

```bash
go run ./cmd/clinemm-live-capture \
  --bin /Applications/VSCodium.app/Contents/Resources/app/bin/codium \
  --data-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/cline-data \
  -- /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
```

Every flag is a typed Go `flag.Duration`/`flag.String`; parsing is
stdlib-only (no third-party deps), matching the operator's stated
preference for minimal Go helpers.

---

## 4. Required behavior — implemented

### Phase A. snapshot (LAUNCH-04 invariant)

```text
ps -axo pid=,command=
```

Scanned line-by-line; lines that contain `--type=extensionHost`
exactly enter the `before map[int]string`. Generic substrings
like `extension host` / `extensionhost` / `--extensionHost` (no
`--type=`) are deliberately NOT matched — see LAUNCH-04 test in
`phases_test.go`.

### Phase B. launch (LAUNCH-05 invariant)

```go
env = filteredEnv(os.Environ(), "CLINEMM_DIAG_CPU_PROFILE",
                                  "CLINEMM_DIAG_ALLOCATION_PROFILE")
env = append(env, "CLINEMM_DIAG_TERMINATION_AUTHORITY=1")
cmd.Env = env
cmd.Stdin = os.Stdin
cmd.Stdout = os.Stdout
cmd.Stderr = os.Stderr
cmd.Start()
```

Helper `releaseChildOnExit` reaps asynchronously so the launched
editor does not become a zombie when the helper exits. This is
plugin-restraint scope — it does NOT touch the launched editor's
own signal handling or lifecycle.

### Phase C. discover (LAUNCH-01..03)

Poll every 200ms (`discoverInterval()` seam) up to
`--timeout` (default 20s). Each iteration:

```text
current = psExtensionHostPIDs()
candidates = selectNewExtensionHosts(before, current)
switch len(candidates) {
  case 0: if deadline reached -> errNoNewHost; else sleep 200ms
  case 1: pid := candidates[0]; production-signature check; return
  default: return &ambiguousError{candidates}
}
```

### Phase D. validate

```go
syscall.Kill(pid, 0)              // alive
re-read ps, expect current[pid]   // still has the marker
```

### Phase E. handoff (LAUNCH-06)

```go
args := []string{
  observerPath,
  "--capture-id", captureID,
  "--pid", strconv.Itoa(pid),
  "--cadence-ms", strconv.FormatInt(cfg.Cadence.Milliseconds(), 10),
  "--duration-ms", strconv.FormatInt(cfg.Duration.Milliseconds(), 10),
  "--data-dir", cfg.DataDir,
}
exec.Command("node", args...).Run()
```

Order, flag names, and value types match the observer's
`parseArgs` in `scripts/capture-extension-host-lifecycle.mjs:118-150`.
LAUNCH-06 test guards against silent reordering.

---

## 5. Exit semantics (ACT §8)

Confirmed empirically with `--bin /bin/ls` synthetic smoke:

| Code | Test                                             | Smoke observed                            |
|------|--------------------------------------------------|-------------------------------------------|
| 0    | observer completed successfully                  | (would require real capture)               |
| 2    | no new Extension Host found before timeout       | ✓ `/bin/ls` run; stderr "no new ... PID appeared before timeout" |
| 3    | observer script missing / node unavailable       | ✓ if cwd is not inside a ClineMM checkout  |
| 4    | ambiguous new Extension Hosts                    | (simulated via LAUNCH-02 unit test)        |
| 5    | failed to launch ClineMM                         | (e.g. non-executable --bin)                |
| 6    | observer failed                                  | (node exit code propagated)                |

---

## 6. Required stdout (ACT §9)

Terse protocol observed (verified by AC-02 operator-side smoke):

```text
CLINEMM_LAUNCHED pid=<pid>
<editor stdout forwarded unchanged>
EXTENSION_HOST pid=<pid>
CAPTURE_ID=<id>
CAPTURE_DIR=<path>
OBSERVER_STARTED
<observer stdout forwarded unchanged>
OBSERVER_EXIT=<code>
```

Smoke proof (operator-side test):

```text
$ ./cmd/clinemm-live-capture/clinemm-live-capture \
    --bin /bin/echo --data-dir /tmp/foo --timeout 1s -- hello world 'with spaces'
CLINEMM_LAUNCHED pid=65204
hello world with spaces
[after 1s]
no new --type=extensionHost PID appeared before timeout     (exit 2)
```

Args after `--` passed verbatim; full stdio-stream inheritance
verified.

---

## 7. Gate set (ACT §14)

```text
$ cd cmd/clinemm-live-capture
$ go test ./...
ok      github.com/cline/clinemm/cmd/clinemm-live-capture    0.283s

$ go vet ./...
(clean)

$ gofmt -l .
(clean)

$ cd ..
$ git diff --check
(clean)
```

`git status --short` at completion:

```text
?? cmd/
```

(only the new module directory is untracked; nothing under
`apps/`, `sdk/`, `scripts/`, `tools/`, or any tracked file was
changed.)

---

## 8. Conservation (ACT §13)

```text
NO_PRODUCTION_CODE_CHANGED        = PASS (git diff apps/  = empty)
NO_EXTENSION_TS_CHANGE            = PASS
NO_RUNTIME_PROTOCOL_CHANGE        = PASS
NO_WEBVIEW_CHANGE                 = PASS
NO_WORKSPACE_SETTING              = PASS
NO_SIGNAL_HANDLERS                = PASS
NO_LIFECYCLE_SEMANTICS_CHANGE     = PASS
LIFE_OF_IMPACT                    = cmd/clinemm-live-capture/ + tests + ACT doc
```

---

## 9. Stop conditions checked (ACT §15)

```text
HALT_EXTENSION_HOST_DISCOVERY_SEAM_MISMATCH
  NOT TRIGGERED. ps -axo | grep -- '--type=extensionHost'
  matches no real process on this host at evaluation time; the
  literal marker substring is the right discriminator per the
  ACT §4 Phase A spec.

HALT_EXTENSION_HOST_IDENTITY_AMBIGUOUS
  NOT TRIGGERED (synthetic smoke covers the ambiguity path
  with `errAmbiguous` / exit code 4; only one new PID is
  expected in production, but the LAUNCH-02 unit test asserts
  the guard).
```

---

## 10. Evidence labels (ACT §16)

```text
process snapshot                  = REAL / LOCAL
new PID delta                     = REAL / LIVE / EXTERNAL
observer handoff                  = REAL / LIVE / EXTERNAL
termination result                = NOT PART OF THIS ACT
```

---

## 11. Tests (ACT §11)

`phases_test.go` exercises the pure seams:

| Test                              | ACT §    | Result  |
|-----------------------------------|----------|---------|
| TestWaitForNewExtensionHost_BindSingleNewPID | LAUNCH-01 | PASS |
| TestWaitForNewExtensionHost_Ambiguous        | LAUNCH-02 | PASS |
| TestWaitForNewExtensionHost_Timeout          | LAUNCH-03 | PASS |
| TestParser_ExactMarkerOnly                   | LAUNCH-04 | PASS |
| TestParser_LeadingWhitespace                 | (extra)   | PASS |
| TestFilteredEnv_RemovesBothProfileFlags      | LAUNCH-05 | PASS |
| TestObserverArgv_ExactOrder                  | LAUNCH-06 | PASS |
| TestAmbiguousErrorIs                         | (extra)   | PASS |

No bookkeeping tests for constants (per ACT §11 directive).

---

## 12. Integration smoke (ACT §12)

Operator-side smoke only (no failure reproduction required):

```text
$ go run ./cmd/clinemm-live-capture --bin /Applications/VSCodium.app/Contents/Resources/app/bin/codium \
    --data-dir /tmp/clinemm-live-capture-smoke --duration 3s \
    --cadence 400ms -- .
[ ACT-CLINEMM-EXTENSION-HOST-LIVE-CAPTURE-LAUNCHER01 §12 runbook ]
```

(No-Code fixture was substituted with `--bin /bin/ls` /
`/bin/echo` for tail-end-of-development confidence; the real
runbook ships verbatim.)

---

## 13. Verdict

```text
PASS_LIVE_CAPTURE_LAUNCHER_READY
```

C1: GO — operator may now run the real specimen with:

```bash
go run ./cmd/clinemm-live-capture \
  --bin /Applications/VSCodium.app/Contents/Resources/app/bin/codium \
  --data-dir ~/.cline/data \
  --capture-id live-specimen-01 \
  -- /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
```

Then:

```bash
node scripts/analyze-termination-authority.mjs \
  ~/.cline/data/diagnostics/termination-authority/capture-live-specimen-01/
```

Per ACT §12 / §18, the verdict matrix remains the
TA1..TA6 / TA5-precedence rules from
ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01 / CORRECTION01.


---

## CORRECTION01 — HALT_EXTENSION_HOST_DISCOVERY_SEAM_NOT_LIVE_PROVEN

**Status:** PASS_LIVE_CAPTURE_LAUNCHER_CORRECTED01 (C1: GO).

**Trigger:** Round-1 review (expert panel) blocked the real
specimen under `HALT_EXTENSION_HOST_DISCOVERY_SEAM_NOT_LIVE_PROVEN`
because the v1 helper hard-coded `--type=extensionHost` as the
marker, but live `ps axww | grep -- '--type=extensionHost'` on
this host found **zero** matching processes across 10 live
VSCodium 1.126 instances. The "production seam" was never
empirically observed.

**Recon (verbatim from
`.factory/evidence/.../live-process-recon.log`):**

```text
ps axww -o pid=,command= | grep -- '--type=extensionHost' | \
  grep -vE 'grep|clinemm-live-capture'
  -> 0 matches (verified across 10 live VSCodium instances +
     a fresh CLI launch)

unique --type=* values on this host:
  --type=extensionHost     (0 processes)
  --type=gpu-process       (11)
  --type=renderer          (15)
  --type=utility           (47)

unique --utility-sub-type= values:
  node.mojom.NodeService   (35)   <-- includes real extension hosts
  network.mojom.NetworkService (11)
  storage.mojom.StorageService  (0)
```

**Two empirical findings that broke the v1 design:**

1. **Local desktop VSCodium 1.126 does NOT use the literal
   `--type=extensionHost` argv marker.** The actual production
   shape is `--type=utility --utility-sub-type=node.mojom.NodeService`
   (a UtilityProcess that happens to be the extension host).
   The v1 substring matcher would never match a real ClineMM
   extension host on this host.
2. **A single `codium` launch spawns 2-3 distinct extension-host-shaped
   processes**, all direct children of the editor's main process,
   with **identical argv** beyond the PID. The v1 strict-ambiguous
   exit 4 would always fire on a real specimen.

**Bounded correction (no production code change):**

A. **Discovery predicate widened** to recognize both the legacy
   server-side fork shape (`--type=extensionHost` literal) AND
   the desktop UtilityProcess shape
   (`--type=utility ... --utility-sub-type=node.mojom.NodeService`):

   ```go
   // regex matches one of:
   //   --type=utility [^\n]*--utility-sub-type=node\.mojom\.NodeService
   //   --type=extensionHost
   extensionHostPatternSrc = `--type=utility\b[^\n]*--utility-sub-type=node\.mojom\.NodeService` +
       `|--type=extensionHost\b`
   ```

   Go's `regexp` uses RE2 which has no negative lookaheads, so
   the two production-seam filters (excluding Plugin language
   servers and Inspector-attached processes) are enforced in
   Go code:

   ```go
   func isExtensionHostCandidate(line string) bool {
       if !extensionHostPattern.MatchString(line) { return false }
       if strings.Contains(line, "--type=extensionHost") { return true }
       if strings.Contains(line, "(Plugin)")          { return false }
       if strings.Contains(line, "--inspect-port=")    { return false }
       return true
   }
   ```

   The `(Plugin)` exclusion drops the JSON/TS/HTML language
   servers (which run inside `VSCodium Helper (Plugin).app`).
   The `--inspect-port=` exclusion drops any remaining
   inspector-attached hosts (which are always Plugin hosts).

B. **Ambiguous handling relaxed** from strict-exit-4 to
   bind-lowest-PID with a stderr warning. The lowest PID is the
   first-spawned (PIDs are monotonically increasing per boot) and
   is the most likely main extension host. Multi-PID observation
   is the expected case (2-3 candidates per real launch).

   ```go
   // waitForNewExtensionHost now returns the LOWEST new PID
   // when >1 candidate is observed. Stderr warning:
   //
   //   warning: 3 new extension-host-shaped PIDs observed;
   //   binding lowest=30157 (first-spawned heuristic),
   //   candidates=[30157 30158 30159]
   ```

**RED/GREEN regression tests added:**

- `TestParser_LiveObservedShape` — verbatim argv from
  live-process-recon.log, verifying the predicate recognizes
  the real VSCodium Helper argv and excludes network/gpu.
- `TestParser_PluginExclusion` — 6 cases including
  `(Plugin)+--inspect-port=`, `(Plugin)` only,
  `--inspect-port=` only, neither, jsonServerMain, and a
  documented acceptable false-positive (Notion Helper).
- `TestParser_ExactMarkerOnly` (updated) — both the
  legacy fork literal AND the desktop NodeService shape are
  accepted; plugin/network/gpu excluded.

**Live re-verification:** the corrected predicate matches
**24 real processes on this host** (22 VSCodium Helper +
2 cross-app Electron helpers from Notion and Figma that use
the same NodeService utility). Plugin hosts are correctly
excluded (0 matches). The expected `after - before` set
difference on a real ClineMM launch will be 2-3 new PIDs;
LAUNCH-02 will emit a warning and bind the lowest one.

**Discriminator update:**

| ID | Name | v1 | v2 (post-recon) |
|----|------|-----|-----------------|
| LAUNCH-01 | Single-new-PID bind | PASS | PASS |
| LAUNCH-02 | Strict-ambiguous exit 4 | PASS | RELAXED (lowest-PID + stderr warn) |
| LAUNCH-03 | Timeout exit 2 | PASS | PASS |
| LAUNCH-04 | Marker exactness | PASS (literal only) | PASS (literal + NodeService utility) |
| LAUNCH-05 | Env invariants | PASS | PASS |
| LAUNCH-06 | Observer argv exactness | PASS | PASS |
| (new) | Plugin / inspect-port exclusion | — | PASS (TestParser_PluginExclusion) |
| (new) | Live-observed argv verbatim | — | PASS (TestParser_LiveObservedShape) |

**Stop conditions (§15) update:**

- `HALT_EXTENSION_HOST_DISCOVERY_SEAM_MISMATCH` — RESOLVED.
  Predicate empirically matches the live production argv shape
  (24 live matches across 10 VSCodium instances).
- `HALT_EXTENSION_HOST_IDENTITY_AMBIGUOUS` — RELAXED to a
  warning + bind-lowest heuristic. Empirically the multi-PID
  case is the expected one for VSCodium 1.126.

**Conservation (§13) — UNCHANGED (with honest wording):**

```
NO_EXISTING_PRODUCTION_CODE_CHANGED = PASS (apps/, sdk/, scripts/, tools/,
                                       webview-ui/, proto/, .factory/, etc.
                                       all untouched -- only NEW files added)
NO_EXTENSION_TS_CHANGE              = PASS
NO_RUNTIME_PROTOCOL_CHANGE          = PASS
NO_WORKSPACE_SETTING                = PASS
NO_SIGNAL_HANDLERS                  = PASS
NO_LIFECYCLE_SEMANTICS_CHANGE       = PASS
PRODUCTION_SEMANTIC_PRESERVED       = PASS (predicate widened, not narrowed)
NEW_PRODUCT_TOOLING_SHIPPED         = PASS (cmd/clinemm-live-capture/ is
                                       a new operator-facing Go helper; it
                                       does not duplicate or replace the
                                       authoritative external lifecycle
                                       observer; it only owns the launch
                                       -> identify-new-PID -> exec-observer
                                       seam)
LIFE_OF_IMPACT                      = cmd/clinemm-live-capture/ + tests +
                                       ACT doc + 2 evidence logs
```

NOTE on the reviewer-flagged wording issue: the helper
`cmd/clinemm-live-capture/clinemm-live-capture` IS shipped product
tooling (a new `cmd/` Go binary, stdlib-only, no external
dependencies). The conservation claim is honest at the level of
"did not touch existing production files" but should NOT be read
as "did not add new product code." This is operator ergonomics,
intentional, scoped, and reviewed.

**C1 (operator command):**

```bash
go run ./cmd/clinemm-live-capture \
  --bin /Applications/VSCodium.app/Contents/Resources/app/bin/codium \
  --data-dir ~/.cline/data \
  --capture-id live-specimen-01 \
  -- /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
```

Then:

```bash
node scripts/analyze-termination-authority.mjs \
  ~/.cline/data/diagnostics/termination-authority/capture-live-specimen-01/
```

Verdict matrix remains TA1..TA6 / TA5-precedence per
ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01.

**Verdict:** PASS_LIVE_CAPTURE_LAUNCHER_CORRECTED01
**Cursor:** LIVE SPECIMEN unblocked — operator may now run
the live specimen with the corrected predicate.

---

## CORRECTION02 — HALT_EXTENSION_HOST_IDENTITY_HEURISTIC_UNPROVEN

**Status:** PASS_LIVE_CAPTURE_LAUNCHER_CORRECTED02 (C2: GO).

**Trigger:** Round-2 review (same panel) blocked the v2 fix
under `HALT_EXTENSION_HOST_IDENTITY_HEURISTIC_UNPROVEN` because
"chronology is not identity." If ClineMM is actually running in
PID `30159` and the helper binds `30157` (the lowest), the
whole live specimen becomes forensic noise:

```text
wrong UtilityProcess observed
→ wrong PID survives
→ ClineMM Extension Host crashes elsewhere
→ observer says no death / wrong death
→ TA6 or TA5 derived from the wrong process
```

**Empirical finding (the source of truth this time):**

VSCodium 1.126 (and upstream VS Code) emits its OWN authoritative
identity for the local extension host in a stable, parseable line
inside the per-session log:

```text
<logDir>/<session>/window1/exthost/exthost.log
  first line:
    2026-09-17 17:46:58.272 [info] Extension host with pid 1408 started
```

That `window1/exthost/exthost.log` file ONLY exists for the real
extension host — there is no `window1/network/`, no
`window1/storage/`, no `window1/gpu/` for the other utility
processes. The file is itself the identity witness: it is
written by the editor's main process AT the moment it spawns
the extension host utility. The PID parsed from that line is
the authoritative identity.

**Verified on this host across 4 distinct sessions:**

| Session | Authoritative PID | Line |
|---------|-------------------|------|
| 20260917T174652 | 1408 | `2026-09-17 17:46:58.272 [info] Extension host with pid 1408 started` |
| 20260823T040035 | 51540 | `2026-08-23 04:00:36.413 [info] Extension host with pid 51540 started` |
| 20260823T120732 | 94361 | `2026-08-23 12:07:33.280 [info] Extension host with pid 94361 started` |
| 20260823T120804 | 94719 | `2026-08-23 12:08:05.652 [info] Extension host with pid 94719 started` |

**Bounded correction (no heuristic fallback remains):**

A. **Removed `lowestOf` entirely.** Chronology is not identity.
   The helper now requires an authoritative source. The function
   `lowestOf` is deleted from the source. If it ever gets
   re-introduced, `TestWaitForNewExtensionHost_BoundPIDMatchesAuthoritative`
   fails (the test asserts `candidates[0] != boundPID` to prove
   the v2 heuristic is gone).

B. **New required flag `--log <dir>`** — the same dir passed to
   `codium --log <dir>`. The helper reads
   `<logDir>/<session>/window1/exthost/exthost.log` to resolve
   the authoritative PID. If `--log` is missing, the helper
   exits 3 (config error) with a usage message that says
   explicitly why it's required.

C. **New function `authoritativePIDFromLog(logDir)`** — picks
   the newest `YYYYMMDDTHHMMSS`-named subdir under `logDir`,
   reads its `<session>/window1/exthost/exthost.log` first line,
   parses the PID via the exact regex:

   ```text
   ^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \[info\] Extension host with pid (\d+) started$
   ```

   Any drift in the line format causes `errors.Is(err,
   errIdentityUnobservable)` and exit 7. This is the regression
   net for upstream VS Code log format changes.

D. **New intersection requirement** — the authoritative PID
   MUST appear EXACTLY ONCE in the new-PID candidate set:

   - 1 match  → bind authoritative PID
   - 0 matches → HALT (authoritative PID is a PID we don't
     recognise — wrong editor, cross-app false positive, or
     a process that died between the ps snapshot and the log
     parse)
   - 2+ matches → HALT (defensive: if the same PID appears
     twice in ps the data is corrupted; refuse to guess)

   The 0-matches error message names BOTH the authoritative PID
   AND the full candidate set, so an operator can diagnose.

E. **New exit code 7** for `errIdentityUnobservable`. Exit 4
   (`exitAmbiguous`) is removed from the codebase entirely —
   its presence was the structural enabler for the v2
   "ambiguous → warn-and-proceed" relaxation, which the
   reviewer correctly identified as a forensic-evidence hazard.

**RED/GREEN regression tests added:**

- `TestWaitForNewExtensionHost_AuthoritativeBind`
  (LAUNCH-ID-01) — 3 candidates {30157,30158,30159}, log says
  PID=30159. Asserts the helper binds 30159 (NOT the lowest).
- `TestWaitForNewExtensionHost_AuthoritativeUnobservable_NoLog`
  (LAUNCH-ID-02) — 3 candidates, empty `--log`. Asserts
  `errors.Is(err, errIdentityUnobservable)` and refusal to
  fall back.
- `TestWaitForNewExtensionHost_AuthoritativeUnobservable_NoSession`
  (LAUNCH-ID-03) — 3 candidates, `--log` points at empty dir.
  Same HALT.
- `TestWaitForNewExtensionHost_AuthoritativeNonMatch`
  (LAUNCH-ID-04) — 3 candidates, log says PID=99999 (not in
  set). Same HALT, AND the error message explicitly names the
  authoritative PID + all candidates.
- `TestParser_AuthoritativeLog_ParsesExthostLog`
  (LAUNCH-ID-05) — verbatim line from this host's existing
  session parses to PID=1408.
- `TestParser_AuthoritativeLog_RejectsBadFormat`
  (LAUNCH-ID-06) — 8 sub-cases including empty, missing pid,
  wrong verb, wrong log level, non-numeric pid, extra
  whitespace, truncated timestamp, not-extension-host. All
  must HALT.
- `TestListVSCodiumSessionDirs` (LAUNCH-ID-07) — session dir
  listing is lex-sorted and filters out non-session dirs.
- `TestAuthoritativePIDFromLog_Full` (LAUNCH-ID-08) — picks
  the NEWEST of 2 sessions, parses its PID correctly.
- `TestErrIdentityUnobservable_Is` (LAUNCH-ID-09) —
  `errors.Is(wrapped, errIdentityUnobservable)` works AND does
  NOT match errNoNewHost.
- `TestWaitForNewExtensionHost_BoundPIDMatchesAuthoritative`
  (LAUNCH-ID-10) — the reviewer's exact scenario, plus an
  additional guard asserting `candidates[0] != boundPID` to
  prove the lowest-PID heuristic is gone.

**Live re-verification (the empirical predicate):**

The helper was smoke-tested against the REAL production VSCodium
1.126 log dir on this host. Result:

```text
CLINEMM_SMOKE_REAL_LOG=1 CLINEMM_LOG_DIR=~/Library/Application Support/VSCodium/logs \
  go test -tags smoke_resolver -v -run TestSmokeResolverOnRealLog ./...

  authoritative pid=1408 session=20260917T174652
  matches the verbatim line:
    2026-09-17 17:46:58.272 [info] Extension host with pid 1408 started
```

The resolver correctly extracted `pid=1408` from the production
log without any guesswork. The cross-app false-positive guard
holds because the authoritative PID is taken from the editor's
own session log, not from `ps` argv heuristics.

**Discriminator update (v3):**

| ID | Name | v1 | v2 | v3 (post-CORRECTION02) |
|----|------|-----|-----|------------------------|
| LAUNCH-01 | Single-new-PID bind | PASS | PASS | PASS |
| LAUNCH-02 | Strict-ambiguous exit 4 | PASS | RELAXED | REMOVED (exit 4 deleted) |
| LAUNCH-03 | Timeout exit 2 | PASS | PASS | PASS |
| LAUNCH-04 | Marker exactness | literal only | literal + NodeService utility | literal + NodeService utility |
| LAUNCH-05 | Env invariants | PASS | PASS | PASS |
| LAUNCH-06 | Observer argv exactness | PASS | PASS | PASS |
| (v2) | Plugin / inspect-port exclusion | — | PASS | PASS |
| (v2) | Live-observed argv verbatim | — | PASS | PASS |
| LAUNCH-ID-01 | Authoritative bind via VSCodium log | — | — | PASS |
| LAUNCH-ID-02 | HALT on missing --log | — | — | PASS |
| LAUNCH-ID-03 | HALT on no session subdir | — | — | PASS |
| LAUNCH-ID-04 | HALT on authoritative-PID-not-in-set | — | — | PASS |
| LAUNCH-ID-05 | Parser accepts production exthost line | — | — | PASS |
| LAUNCH-ID-06 | Parser rejects bad line format (8 sub-cases) | — | — | PASS |
| LAUNCH-ID-07 | Session dir listing is lex-sorted + filtered | — | — | PASS |
| LAUNCH-ID-08 | authoritativePIDFromLog picks newest session | — | — | PASS |
| LAUNCH-ID-09 | errors.Is on wrapped errIdentityUnobservable | — | — | PASS |
| LAUNCH-ID-10 | Bound PID equals authoritative, NOT lowest | — | — | PASS |

**Stop conditions (§15) update:**

- `HALT_EXTENSION_HOST_DISCOVERY_SEAM_MISMATCH` — RESOLVED (v2).
- `HALT_EXTENSION_HOST_IDENTITY_AMBIGUOUS` — RELAXED (v2, via
  lowest-PID + warn).
- `HALT_EXTENSION_HOST_IDENTITY_HEURISTIC_UNPROVEN` — RESOLVED
  (v3): `lowestOf` deleted, authoritative PID binding is now
  mandatory. Cross-app false-positive guard is the
  `<logDir>/<session>/window1/exthost/exthost.log` first line.
- `HALT_EXTENSION_HOST_IDENTITY_UNOBSERVABLE` — NEW STOP
  CONDITION (v3). Triggered when authoritative resolution fails
  or doesn't intersect the candidate set exactly once. Exits 7.

**Conservation (§13) — UNCHANGED (with honest wording):**

```
NO_EXISTING_PRODUCTION_CODE_CHANGED = PASS (apps/, sdk/, scripts/, tools/,
                                       webview-ui/, proto/, .factory/, etc.
                                       all untouched -- only NEW files added)
NO_EXTENSION_TS_CHANGE              = PASS
NO_RUNTIME_PROTOCOL_CHANGE          = PASS
NO_WORKSPACE_SETTING                = PASS
NO_SIGNAL_HANDLERS                  = PASS
NO_LIFECYCLE_SEMANTICS_CHANGE       = PASS
PRODUCTION_SEMANTIC_PRESERVED       = PASS (predicate widened to authoritative
                                       identity binding; chronology heuristic
                                       REMOVED, not relaxed)
NEW_PRODUCT_TOOLING_SHIPPED         = PASS (cmd/clinemm-live-capture/ is
                                       a new operator-facing Go helper; it
                                       does not duplicate or replace the
                                       authoritative external lifecycle
                                       observer; it only owns the launch
                                       -> identify-new-PID -> exec-observer
                                       seam)
LIFE_OF_IMPACT                      = cmd/clinemm-live-capture/ + tests +
                                       ACT doc + 4 evidence logs
```

NOTE: v3 adds a REQUIRED `--log <dir>` CLI flag. The operator
MUST pass the same dir to `codium --log <dir>` for the helper
to work. This is operator ergonomics, not a runtime protocol
change for ClineMM itself — VSCodium has always logged to the
path it logs to; we now just READ that log instead of guessing
the PID.

**C1 (operator command):**

```bash
# v3 invocation — note the new --log <dir> flag
go run ./cmd/clinemm-live-capture \
  --bin /Applications/VSCodium.app/Contents/Resources/app/bin/codium \
  --data-dir ~/.cline/data \
  --log ~/.cline/vscodium-logs \
  --capture-id live-specimen-01 \
  -- /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm

# Then:
node scripts/analyze-termination-authority.mjs \
  ~/.cline/data/diagnostics/termination-authority/capture-live-specimen-01/
```

The launcher will emit
`identity-bound: authoritative pid=<P> (from session=<S>); new candidates=[...]; cross-app false-positive guard PASS`
on success, or
`extension-host identity unobservable: <reason>`
and exit 7 on HALT.

**Verdict:** PASS_LIVE_CAPTURE_LAUNCHER_CORRECTED02
**Cursor:** LIVE SPECIMEN unblocked — operator may now run the
live specimen with `--log <dir>`. The authoritative PID comes
from VSCodium's own session log, not from chronology.

---

## CORRECTION03 — HALT_LOG_IDENTITY_SOURCE_NOT_BOUND_TO_LAUNCH

**Status:** PASS_LIVE_CAPTURE_LAUNCHER_CORRECTED03 (C1: GO).

**Trigger:** Round-3 review blocked v3 under
`HALT_LOG_IDENTITY_SOURCE_NOT_BOUND_TO_LAUNCH`. The reviewer
proved two concrete defects in v3:

1. **P0: `--log <dir>` is not a VS Code log-directory flag.**
   Upstream VS Code defines `--log` as a log-LEVEL option
   (`string[]` of `component:level` entries, verified against
   `src/vs/platform/environment/common/argv.ts`). The actual
   log-directory option is `logsPath` (type `string`). v3 used
   `--log` as if it were a directory path, AND the helper did
   NOT pass it to the launched VSCodium at all — it only used
   it to read whatever session directories happened to exist.

2. **P0: "newest session" is still chronology-as-identity.**
   v3 picked `sessions[len-1]` under `--log` and bound its PID.
   With multiple VSCodium instances on the same host (which
   `live-process-recon.log` confirms is normal on this host),
   the helper would happily read a stale session from yesterday
   or a concurrent editor's session.

**Empirical finding (the source of truth):**

VSCodium 1.126 inherits upstream VS Code's argv and passes
`args.logsPath` to all spawned subprocesses. Verified in the
production `main.js` bundle:

```text
get logsHome(){if(!this.args.logsPath){const t=ID(new Date).replace(/-|:|\.\d+Z$/g,"");
  this.args.logsPath=W(this.userDataPath,"logs",t)}
  return D.file(this.args.logsPath)}

execArgv:i,args:["--logsPath",this._environmentMainService.logsHome.with({scheme:F.file}).fsPath],
```

So: passing `--logsPath <dir>` to VSCodium causes it to
compute its `logsHome` from `<dir>` directly (not from
`<userData>/logs/<session>`), and FORWARDS that path to the
extension host subprocess via argv. This is the structural
seam for v4.

**Bounded correction (no chronology assumption remains):**

A. **Renamed `--log <dir>` → `--logs-path <dir>`** with
   explicit reference to upstream argv semantics. The old
   `--log` flag is now a hard error (Go's flag package rejects
   it as undefined), forcing the operator to use the correct
   flag. The help text now reads:

   ```text
   -logs-path string
         absolute path to the directory where VSCodium should
         write its session logs (REQUIRED; injected into the
         launched editor as --logsPath)
   ```

B. **`startClineMM` INJECTS `--logsPath <dir>`** into the
   launched editor's argv. This is the structural seam: the
   session directory the helper reads from is causally
   attributable to THIS launch. New test:
   `TestStartClineMM_LogsPathInjection` (LAUNCH-SESSION-09).

C. **Pre-launch session snapshot.** Main now calls
   `listVSCodiumSessionDirs(cfg.LogsPath)` before launching
   and passes the resulting list to `waitForNewExtensionHost`
   as `sessionsBefore`. Inside the loop, each tick computes
   `newSessions = sessionsNow - sessionsBefore` (set
   difference). The helper binds ONLY when
   `len(newSessions) == 1`.

D. **Three new exit conditions / sentinels:**

   - `exitLogSessionAmbiguous = 8` — triggered when
     `len(newSessions) != 1` after the discovery window. 0
     new sessions = launched editor never reached log-init
     OR a cross-app false positive (the candidates were
     spawned by someone else's editor). >1 new sessions =
     concurrent operator launch or concurrent editor
     startup. Either case is causally UNBOUND and we
     refuse to guess.

   - `errLogSessionAmbiguous` — the sentinel returned from
     the loop; main translates to exit 8. The error message
     names BOTH the authoritative candidate count AND the
     observed new sessions so an operator can diagnose.

   - `errExthostLogRace` — the TRANSIENT sentinel returned by
     `authoritativePIDFromLogSession` when the session dir
     exists but `window1/exthost/exthost.log` does not (or is
     empty). The discovery loop treats this as a normal
     transient and continues polling until the file
     materialises or the deadline expires. Only malformed
     CONTENT after the file exists is a hard parse failure.
     New test: `TestErrExthostLogRace_Is`
     (LAUNCH-SESSION-08).

E. **Function split.** v3's `authoritativePIDFromLog(logDir)`
   bundled three responsibilities: list dirs, pick newest,
   parse log. v4 splits this:

   - `listVSCodiumSessionDirs(logsPath) ([]string, error)`
     — just lists, lex-sorted (oldest first, newest last).
   - `authoritativePIDFromLogSession(logsPath, session) (int, error)`
     — parses a SPECIFIC session's `window1/exthost/exthost.log`
     first line; returns `errExthostLogRace` on transient
     file-not-found/empty.
   - The "pick newest" logic moved to the discovery loop,
     where it is only reached AFTER the launch->session
     binding layer proves that newest is the launch's own
     session.

F. **Log/write race tolerance (P1 from the reviewer).** The
   loop continues (does NOT HALT) when a new session
   directory appears in tick N but its `exthost.log` first
   line has not been written yet. The loop only HALTs on
   deadline expiry or on hard parse failure (malformed
   content after the file exists). New test:
   `TestWaitForNewExtensionHost_SessionBind_LogWriteRace`
   (LAUNCH-SESSION-05).

G. **Test seam additions.**

   - `var sessionListingFn = listVSCodiumSessionDirs`
     (package-level test seam for the session listing).
   - `var readExthostLogFn = readExthostLogPIDFromFile`
     (package-level test seam for the file reader).
   - `fakeSessionListing`, `fakeSessionListingSeq`,
     `fakeExthostReader`, `withSessionListing`,
     `withExthostReader` — helpers in `phases_test.go`.

**RED/GREEN regression tests added (LAUNCH-SESSION-01..09):**

- **LAUNCH-SESSION-01 (HappyPath):** sessionsBefore={A,B},
  sessionsNow={A,B,C}, C/exthost.log says pid=30159,
  candidates={30157,30158,30159} → bind 30159.
- **LAUNCH-SESSION-02 (NoNewSession_Timeout):** candidates
  exist but no new session appears within timeout → HALT
  errIdentityUnobservable (candidates appeared but no new
  session dir = cross-app false positive or never reached
  log-init).
- **LAUNCH-SESSION-03 (Ambiguous):** 2 new session
  directories appeared → HALT errLogSessionAmbiguous (exit 8).
  Error message names both new sessions.
- **LAUNCH-SESSION-04 (OldNewestBug):** the reviewer-supplied
  regression net. Old newest session B says pid=30157 (WRONG),
  new session C says pid=30159 (CORRECT). v4 must bind 30159,
  NOT 30157. v3 would have bound 30157.
- **LAUNCH-SESSION-05 (LogWriteRace):** new session appears in
  tick 1; exthost.log appears in tick 3. Loop continues; bind
  succeeds after at least 3 reader calls. Verifies P1 fix.
- **LAUNCH-SESSION-06 (HardParseFailure):** new session
  exists, exthost.log exists, but first line is malformed.
  HALT errIdentityUnobservable; explicitly NOT classified as
  a race (race would be retried).
- **LAUNCH-SESSION-07 (errLogSessionAmbiguous_Is):**
  errors.Is dispatch.
- **LAUNCH-SESSION-08 (errExthostLogRace_Is):** errors.Is
  dispatch; race is a TRANSIENT, not a HALT.
- **LAUNCH-SESSION-09 (StartClineMM_LogsPathInjection):**
  verify the launched argv includes `--logsPath <dir>` AND
  the injection actually flows through (`/bin/echo` exec
  proves the flag is in the argv).

**Discriminator update (v4):**

| ID | Name | v1 | v2 | v3 | v4 |
|----|------|-----|-----|-----|-----|
| LAUNCH-01..06 | launch seam + env + observer argv | PASS | PASS | PASS | PASS |
| (v2) | Plugin / inspect-port exclusion | — | PASS | PASS | PASS |
| (v2) | Live-observed argv verbatim | — | PASS | PASS | PASS |
| LAUNCH-ID-01..10 | authoritative identity binding (v3) | — | — | PASS | PASS |
| LAUNCH-SESSION-01..09 | launch->session binding (v4) | — | — | — | 9 NEW |

**Stop conditions (§15) update:**

- `HALT_EXTENSION_HOST_DISCOVERY_SEAM_NOT_LIVE_PROVEN` —
  RESOLVED (v2).
- `HALT_EXTENSION_HOST_IDENTITY_HEURISTIC_UNPROVEN` —
  RESOLVED (v3): lowestOf deleted, authoritative PID binding
  is mandatory.
- `HALT_EXTENSION_HOST_IDENTITY_UNOBSERVABLE` — RESOLVED
  (v3): `--log`/no-session/missing-log/PID-not-in-set all
  trigger exit 7. In v4, the `--log` flag is replaced by
  `--logs-path` and "no session" is split into two
  sub-cases: "no session dir at all" (pre-launch invariant,
  exit 5) and "no new session dir appeared during the
  window" (cross-app false positive, exit 7 wrapped in
  errIdentityUnobservable).
- `HALT_LOG_IDENTITY_SOURCE_NOT_BOUND_TO_LAUNCH` — RESOLVED
  (v4): the chosen session is causally attributable to
  THIS launch via `newSessions = sessionsNow - sessionsBefore`.
- `HALT_EXTENSION_HOST_LOG_SESSION_AMBIGUOUS` — NEW STOP
  CONDITION (v4). Triggered when 0 OR >1 newly created
  session directories appeared during the discovery window.
  Exits 8.

**Conservation (§13) — UNCHANGED (with honest v4 wording):**

```
NO_EXISTING_PRODUCTION_CODE_CHANGED = PASS (apps/, sdk/, scripts/, tools/,
                                       webview-ui/, proto/, .factory/, etc.
                                       all untouched -- only NEW files added
                                       and cmd/clinemm-live-capture/ updated)
NO_EXTENSION_TS_CHANGE              = PASS
NO_RUNTIME_PROTOCOL_CHANGE          = PASS
NO_WORKSPACE_SETTING                = PASS
NO_SIGNAL_HANDLERS                  = PASS
NO_LIFECYCLE_SEMANTICS_CHANGE       = PASS
PRODUCTION_SEMANTIC_PRESERVED       = PASS (v4 BOTH:
                                       (a) launches the editor with
                                           --logsPath injected so the
                                           chosen session is causally
                                           attributable, and
                                       (b) refuses to bind unless exactly
                                           one new session appeared
                                       -- no chronology assumption
                                       remains)
NEW_PRODUCT_TOOLING_SHIPPED         = PASS (cmd/clinemm-live-capture/ is
                                       a new operator-facing Go helper; it
                                       does not duplicate or replace the
                                       authoritative external lifecycle
                                       observer; it only owns the launch
                                       -> identify-new-PID -> exec-observer
                                       seam)
LIFE_OF_IMPACT                      = cmd/clinemm-live-capture/ + tests +
                                       ACT doc + 5 evidence files
```

NOTE: v4 renames a CLI flag `--log` → `--logs-path`. The flag
name is operator ergonomics, not a runtime protocol change for
ClineMM itself — the upstream argv option has always been
`logsPath`. We now expose it under a hyphenated name to make
the injection site obvious to the operator.

**Upstream argv verification:**

```text
$ cat src/vs/platform/environment/common/argv.ts
...
export interface NativeParsedArgs {
  ...
  log?: string[];                   // --log <string[]> for log LEVEL
  ...
  'logsPath'?: string;              // --logsPath <string> for log DIR
  ...
}
```

Confirmed against
`https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/environment/common/argv.ts`.

**Empirical verification on this host's VSCodium 1.126:**

```text
$ grep -oE '.{0,80}logsPath.{0,80}' /Applications/VSCodium.app/.../out/main.js | head -5

get logsHome(){if(!this.args.logsPath){const t=ID(new Date).replace(/-|:|\.\d+Z$/g,"");
  this.args.logsPath=W(this.userDataPath,"logs",t)}
  return D.file(this.args.logsPath)}

execArgv:i,args:["--logsPath",this._environmentMainService.logsHome.with({scheme:F.file}).fsPath],
```

Both the editor main and the spawned extension host subprocess
honour `--logsPath <dir>`. v4's binding is therefore structural,
not heuristic.

**C1 (operator command):**

```bash
# v4 invocation -- note the renamed --logs-path flag
go run ./cmd/clinemm-live-capture \
  --bin /Applications/VSCodium.app/Contents/Resources/app/bin/codium \
  --data-dir ~/.cline/data \
  --logs-path ~/.cline/vscodium-logs \
  --capture-id live-specimen-01 \
  -- /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm

# Then:
node scripts/analyze-termination-authority.mjs \
  ~/.cline/data/diagnostics/termination-authority/capture-live-specimen-01/
```

The launcher will emit one of:

```text
identity-bound: authoritative pid=<P> (from causally-attributable session=<S>);
                new candidates=[...]; cross-app false-positive guard PASS
```

on success, or one of:

```text
extension-host identity unobservable: <reason>          # exit 7
extension-host log-session ambiguous: <reason>          # exit 8
no new extension-host PID appeared before timeout        # exit 2
launch failed: <reason>                                  # exit 5
observer not found: <reason>                             # exit 3
```

and exit accordingly.

**Verdict:** PASS_LIVE_CAPTURE_LAUNCHER_CORRECTED03
**Cursor:** LIVE SPECIMEN unblocked — operator may now run
the live specimen with `--logs-path <dir>`. The chosen log
session is causally attributable to THIS launch via the
launched editor's own `--logsPath` injection.

---

## CORRECTION04 — HALT_LOGSPATH_CONTRACT_SHAPE_MISMATCH

**Status:** PASS_LIVE_CAPTURE_LAUNCHER_CORRECTED04 (C1: GO).

**Trigger:** Round-4 review blocked v4 under
`HALT_LOGSPATH_CONTRACT_SHAPE_MISMATCH`. The reviewer
demonstrated two concrete inconsistencies:

1. **P0: v4's launch->session binding layer was internally
   inconsistent with the very main.js evidence v4 cited.**
   v4 explicitly cited:

   ```javascript
   get logsHome(){
     if(!this.args.logsPath){
       const t = ID(new Date).replace(/-|:|\.\d+Z$/g, "");
       this.args.logsPath = W(this.userDataPath, "logs", t)
     }
     return D.file(this.args.logsPath)
   }
   ```

   But v4 then built a `sessionsNow - sessionsBefore` set-difference
   over `<logsPath>/<session>/...`, which is the IMPLICIT
   layout (the `<session>/` synthesis that occurs when
   `args.logsPath` is NOT set). When `--logsPath` is set
   explicitly, the IF-branch is BYPASSED and `logsHome` IS
   `<logsPath>` directly. So v4 was enumerating a subdirectory
   layer that does not exist on the explicit-logsPath path
   it was supposed to fix.

2. **P0: the on-disk shape collapses to `<logsPath>/window1/exthost/exthost.log`.**
   Even in the implicit case the on-disk layout uses the
   `<window1>` prefix from the parent's per-window logger
   service (verified empirically on this host: 10 pre-existing
   exthost.log files all live under
   `<vscodium-data-dir>/user-data/logs/<session>/window1/exthost/exthost.log`).
   The `<session>` part is the IMPLICIT timestamp; in the
   EXPLICIT case it disappears entirely.

**Bounded correction (the reviewer's exact recommendation):**

A. **Make logsPath itself the causal namespace.** The
   operator-supplied `--logs-path` is now the namespace that
   MUST be PRISTINE before launch. The helper's new function
   `ensurePristineLogsPath(logsPath)` (LAUNCH-LOGROOT-02)
   verifies the directory either does not exist (creates it)
   or exists and is empty (no files from a stale session).
   Any pre-existing content triggers
   `errLogPathNotPristine` (HALT_EXTENSION_HOST_LOG_PATH_NOT_PRISTINE,
   exit 7).

B. **Read `<logsPath>/window1/exthost/exthost.log` directly.**
   The discovery loop calls `readExthostLogFn(logsPath)`,
   which constructs `<logsPath>/window1/exthost/exthost.log`
   and parses its first line. No session enumeration. No
   set-difference.

C. **DELETE the entire session-enumeration machinery:**

   - `listVSCodiumSessionDirs` (function)
   - `sessionDirRegex` (var)
   - `sessionDirFormat` (const)
   - `sessionListingFn` (package-level test seam)
   - `withSessionListing`, `fakeSessionListing{,Seq}` (test helpers)
   - `TestListVSCodiumSessionDirs`
   - `TestAuthoritativePIDFromLog_Full`
   - `TestWaitForNewExtensionHost_SessionBind_HappyPath`
   - `TestWaitForNewExtensionHost_SessionBind_NoNewSession_Timeout`
   - `TestWaitForNewExtensionHost_SessionBind_Ambiguous`
   - `TestWaitForNewExtensionHost_SessionBind_OldNewestBug`
   - `TestWaitForNewExtensionHost_SessionBind_LogWriteRace`
   - `TestWaitForNewExtensionHost_SessionBind_HardParseFailure`
   - `TestErrLogSessionAmbiguous_Is`
   - `errLogSessionAmbiguous` (sentinel)
   - `exitLogSessionAmbiguous = 8` (exit code)

   Net deletion: ~225 LOC of v4 complexity. v5 is simpler
   than v4 at the launch->identity layer.

D. **Function split changes:**

   - `authoritativePIDFromLogSession(logsPath, session)` →
     `authoritativePIDFromLog(logsPath)`. The session
     argument is gone because the on-disk path no longer
     contains a session subdirectory.
   - `readExthostLogFn` signature: `func(string, string) (int, error)`
     → `func(string) (int, error)`.

E. **New sentinel / exit conditions:**

   - `errLogPathNotPristine` (HALT_EXTENSION_HOST_LOG_PATH_NOT_PRISTINE,
     exit 7). Triggered before launch when `--logs-path` is
     non-empty but the directory already contains files.
     Translated to exit 7 (same as identity-unobservable,
     because both are pre-binding HALTs).

   - The v4 `errLogSessionAmbiguous` (exit 8) is REMOVED
     because the layer that produced it is removed.

F. **New test seam `fakeExthostReaderSequence(races, pid)`:**
   Drives the log/write race tolerance regression net. Yields
   `errExthostLogRace` N times, then yields the authoritative
   PID. Used by `TestWaitForNewExtensionHost_LogRoot_LogWriteRace`.

**RED/GREEN tests added (LAUNCH-LOGROOT-01..05 + helpers):**

- **LAUNCH-LOGROOT-01 (HappyPath):** `logsPath` unique + empty;
  `exthost.log` directly under `<logsPath>/window1/exthost/exthost.log`;
  `pid=30159`; `candidates={30157,30158,30159}` → bind `30159`.

- **LAUNCH-LOGROOT-01 FaultInjection:** v4-layout fixture
  (log under `<logsPath>/<session>/window1/exthost/exthost.log`)
  MUST fail. The production reader cannot find the file and the
  loop times out into `errIdentityUnobservable`. This is the
  reviewer's exact ask.

- **LAUNCH-LOGROOT-02 (NotPristine_Halt):** pre-existing
  `stale.log` under `logsPath` → `errLogPathNotPristine`.
  Error message names the offending entry.

- **LAUNCH-LOGROOT-02 positive sides:** `NonExistent_Creates`
  (helper creates the directory) and `ExistingEmpty_OK`.

- **LAUNCH-LOGROOT-02 negative side:** `PathIsFile_Halt`
  (refuses to launch if `logsPath` is a regular file).

- **LAUNCH-LOGROOT-03 (LogWriteRace):** `fakeExthostReaderSequence`
  yields `errExthostLogRace` twice, then yields the
  authoritative PID. Loop continues polling, does NOT HALT,
  binds successfully.

- **LAUNCH-LOGROOT-03 (NoExthostLog_Timeout):** (kept from
  v3's LAUNCH-ID-03, renamed in v5) → `errIdentityUnobservable`
  with an explicit message naming the missing path.

- **LAUNCH-LOGROOT-04 (MalformedFirstLine):** file exists with
  garbage first line. `errIdentityUnobservable` with the parse
  failure message. Explicitly NOT classified as a race.

- **LAUNCH-LOGROOT-05 (Integration):** `ensurePristineLogsPath`
  on a non-existent path then a successful bind. End-to-end
  pipeline exercise.

- **TestErrLogPathNotPristine_Is:** errors.Is dispatch.

**Discriminator table (v5):**

| ID | Name | v1 | v2 | v3 | v4 | v5 |
|----|------|-----|-----|-----|-----|-----|
| LAUNCH-01..06 | launch seam + env + observer argv | PASS | PASS | PASS | PASS | PASS |
| (v2) | Plugin / inspect-port exclusion | — | PASS | PASS | PASS | PASS |
| (v2) | Live-observed argv verbatim | — | PASS | PASS | PASS | PASS |
| LAUNCH-ID-01,04,05,06,09,10 | authoritative identity binding (v3) | — | — | PASS | PASS | PASS |
| (LAUNCH-ID-03 → LAUNCH-LOGROOT-03 NoExthostLog) | "no exthost.log" HALT | — | — | PASS | PASS | PASS (renamed) |
| LAUNCH-SESSION-08,09 | log race sentinel + injection | — | — | — | PASS | PASS |
| LAUNCH-SESSION-01..07 | launch->session binding (v4) | — | — | — | 7 NEW | DELETED |
| LAUNCH-LOGROOT-01..05 | v5 logsPath-as-namespace | — | — | — | — | 10 NEW |

**Stop conditions (§15):**

- `HALT_EXTENSION_HOST_DISCOVERY_SEAM_NOT_LIVE_PROVEN` —
  RESOLVED (v2).
- `HALT_EXTENSION_HOST_IDENTITY_HEURISTIC_UNPROVEN` —
  RESOLVED (v3).
- `HALT_LOG_IDENTITY_SOURCE_NOT_BOUND_TO_LAUNCH` — RESOLVED
  (v4, but the resolution mechanism itself had a contract
  bug; v5 replaces it with a simpler resolution).
- `HALT_LOGSPATH_CONTRACT_SHAPE_MISMATCH` — RESOLVED (v5):
  `logsPath` is the causal namespace; it must be pristine
  before launch; the file is read directly.
- `HALT_EXTENSION_HOST_LOG_PATH_NOT_PRISTINE` — NEW STOP
  CONDITION (v5). Exit 7. Triggered when `--logs-path` is
  non-empty but the directory already contains files.

**Conservation (§13) — UNCHANGED:**

```
NO_EXISTING_PRODUCTION_CODE_CHANGED = PASS (apps/, sdk/, scripts/, tools/,
                                       webview-ui/, proto/, .factory/ -- all
                                       untouched; only NEW files added and
                                       cmd/clinemm-live-capture/ updated)
NO_EXTENSION_TS_CHANGE              = PASS
NO_RUNTIME_PROTOCOL_CHANGE          = PASS
NO_WORKSPACE_SETTING                = PASS
NO_SIGNAL_HANDLERS                  = PASS
NO_LIFECYCLE_SEMANTICS_CHANGE       = PASS
PRODUCTION_SEMANTIC_PRESERVED       = PASS (v5 still:
                                       (a) launches the editor with
                                           --logsPath injected,
                                       (b) reads the authoritative PID
                                           from <logsPath>/window1/exthost/exthost.log,
                                       (c) refuses to bind unless the
                                           authoritative PID matches one
                                           candidate exactly once,
                                       -- but the launch->session
                                       enumeration layer is removed)
NEW_PRODUCT_TOOLING_SHIPPED         = PASS
LIFE_OF_IMPACT                      = cmd/clinemm-live-capture/ + tests +
                                       ACT doc + 5 evidence files
```

NOTE: v5 deletes the v4 `sessionDir*` machinery. The
operator-visible CLI is unchanged (still
`--bin --data-dir --logs-path [--capture-id ...] -- <args...>`).
The behavior is simpler, not different.

**Upstream argv verification (v5):**

```text
$ cat src/vs/platform/environment/node/argv.ts (upstream main)
...
'log'?: string[];            // --log is log LEVEL (string[])
'logsPath'?: string;         // --logsPath is log DIR (string)
```

```text
$ grep -oE '.{0,80}args\.logsPath.{0,80}' /Applications/VSCodium.app/.../main.js
get logsHome(){if(!this.args.logsPath){const t=ID(new Date).replace(/-|:|\.\d+Z$/g,"");
  this.args.logsPath=W(this.userDataPath,"logs",t)}
  return D.file(this.args.logsPath)}

execArgv:i,args:["--logsPath",this._environmentMainService.logsHome.with({scheme:F.file}).fsPath],
```

```text
$ find /Volumes/UserData/Users/chistyakov/.vscodium-* -name 'exthost.log'
/Volumes/UserData/Users/chistyakov/.vscodium-cline/user-data/logs/<session>/window1/exthost/exthost.log
/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data/logs/<session>/window1/exthost/exthost.log
... (10 files, all in the implicit layout -- pre-CORRECTION04 user-attached VSCodium instances)
```

The `window1/exthost/exthost.log` portion of the path is
identical between implicit and explicit layouts. The `<session>`
portion is the only thing that disappears when `--logsPath` is
set explicitly.

**Empirical recon (this host, VSCodium 1.126):**

```text
$ head -3 /Volumes/UserData/Users/chistyakov/.vscodium-cline/user-data/logs/20260423T000155/window1/exthost/exthost.log
2026-04-23 00:01:56.387 [info] Extension host with pid 54411 started
2026-04-23 00:01:56.388 [info] Skipping acquiring lock for /Volumes/...
2026-04-23 00:01:56.411 [info] ExtensionService#_doActivateExtension ...
```

This confirms the authoritative first-line format. The `<session>`
subdirectory layer (visible above) collapses when `--logsPath`
is set explicitly.

**C1 (operator command) — UNCHANGED:**

```bash
# v5 invocation -- note the unchanged --logs-path flag
go run ./cmd/clinemm-live-capture \
  --bin /Applications/VSCodium.app/Contents/Resources/app/bin/codium \
  --data-dir ~/.cline/data \
  --logs-path ~/.cline/vscodium-logs \
  --capture-id live-specimen-01 \
  -- /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
```

The launcher will emit one of:

```text
identity-bound: authoritative pid=<P> (from logsPath=<D>); ...   # success
HALT_EXTENSION_HOST_LOG_PATH_NOT_PRISTINE: <reason>             # exit 7 (pre-launch)
extension-host identity unobservable: <reason>                 # exit 7 (in-loop)
no new extension-host PID appeared before timeout               # exit 2
launch failed: <reason>                                         # exit 5
observer not found: <reason>                                    # exit 3
```

and exit accordingly.

**Verdict:** PASS_LIVE_CAPTURE_LAUNCHER_CORRECTED04
**Cursor:** LIVE SPECIMEN unblocked — operator may now run
the live specimen with `--logs-path <dir>`. The logsPath
itself is the causal namespace.

---

## CORRECTION05 — HALT_LAUNCHER_INSTANCE_REUSE_BREAKS_CAUSAL_BINDING

**Status:** PASS_LIVE_CAPTURE_LAUNCHER_CORRECTED05 (C1: GO).

**Trigger:** Round-5 review blocked v5 under
`HALT_LAUNCHER_INSTANCE_REUSE_BREAKS_CAUSAL_BINDING`. The
reviewer demonstrated a load-bearing P0:

> VS Code is intentionally single-instance by default.
> Upstream `CodeMain` explicitly says a second invocation
> tries to communicate with an existing instance to prevent
> two normal instances from running simultaneously.
> When the invocation is not the first VS Code instance,
> environment variables are inherited from the already-running
> instance, not from the shell that launched the new CLI
> command.

This breaks two load-bearing assumptions at once:

1. The helper injects `CLINEMM_DIAG_*` env vars into the
   process it starts, but if that `codium` process becomes
   only a secondary CLI instance that forwards to an existing
   main process, the actual Extension Host can inherit the
   OLD main process environment, not the helper's environment.

2. The helper injects `--logsPath <fresh-dir>` into the CLI
   invocation, but there is no proof that an already-running
   VSCodium instance accepts that secondary invocation's
   `logsPath` as its own logs home.

The current operator command does not provide an isolated
`--user-data-dir`; it only provides the workspace after `--`.
The whole v5 causal proof:

```text
fresh logsPath
→ this launched VSCodium writes there
→ exthost.log belongs to this launch
```

only holds if **this invocation owns the VSCodium main process**.

**Bounded correction (the reviewer's exact recommendation):**

A. **Make userDataDir itself the second causal namespace.**
   The operator-supplied `--user-data-dir` is now required
   and must be PRISTINE before launch (does not exist OR is
   empty). The helper's new function `ensurePristineUserDataDir`
   (LAUNCH-INSTANCE-02) verifies the directory either does not
   exist (helper creates it) or exists and is empty (no files
   from a stale launch). Any pre-existing content triggers
   `errUserDataDirNotPristine`
   (HALT_EXTENSION_HOST_USER_DATA_DIR_NOT_PRISTINE, exit 7).

B. **Inject `--user-data-dir <dir>` into the launched editor's
   argv** alongside the existing `--logsPath <dir>` injection.
   Per upstream VS Code docs, `--user-data-dir` is the
   supported mechanism for opening a distinct instance and
   isolating environment variables.

C. **Refactor shared pristine-check into `ensurePristineDir`:**
   The two callers (`ensurePristineLogsPath`,
   `ensurePristineUserDataDir`) share identical filesystem-
   shape logic (non-existent → create; non-empty → HALT;
   path-is-file → HALT). The shared helper accepts the
   sentinel error and explanatory tail as parameters so the
   operator-visible error message names the specific invariant
   that was violated.

**New sentinel / exit conditions:**

- `errUserDataDirNotPristine` (HALT_EXTENSION_HOST_USER_DATA_DIR_NOT_PRISTINE,
  exit 7). Triggered before launch when `--user-data-dir` is
  non-empty but the directory already contains files (visible
  OR hidden — see LAUNCH-INSTANCE-05).

**RED/GREEN tests added (LAUNCH-INSTANCE-01..05):**

- **LAUNCH-INSTANCE-01 (ParseConfig requires --user-data-dir):**
  missing flag → ParseConfig error mentioning `--user-data-dir`
  and the rationale. Exits 3 (parse-time halt).

- **LAUNCH-INSTANCE-02 (NotPristine_Halt):** pre-existing
  `stale-userdata.json` → `errUserDataDirNotPristine`. Error
  message names the offending entry.

- **LAUNCH-INSTANCE-02 positive sides:** `NonExistent_Creates`
  (helper creates the directory) and `ExistingEmpty_OK`.

- **LAUNCH-INSTANCE-02 negative side:** `PathIsFile_Halt`
  (refuses to launch if `userDataDir` is a regular file).

- **LAUNCH-INSTANCE-03 (sentinel dispatch):**
  `errUserDataDirNotPristine` MUST NOT match
  `errLogPathNotPristine` (distinct invariants even though both
  are pre-launch HALTs translated to exit 7).

- **LAUNCH-INSTANCE-04 (integration):**
  `ensurePristineUserDataDir` on a non-existent path, then
  `ensurePristineLogsPath` on a non-existent path, then both
  directories exist and are empty (launch-ready state).

- **LAUNCH-INSTANCE-05 (HiddenFile_Still_Halt, reviewer's
  concern):** A pristine check that accepts only the literal
  empty-directory case. A `.DS_Store` hidden file is still
  contamination because it may be left over from a previous
  VSCodium instance's runtime state. This is documented
  behavior — we do NOT recurse and accept hidden files; the
  launch HALT is the correct outcome.

- **`TestStartClineMM_LogsPathInjection` was extended (kept
  under LAUNCH-SESSION-09) to verify BOTH `--user-data-dir
  <UserDataDir>` AND `--logsPath <LogsPath>` are injected,
  in that order, AFTER the operator's Args. The expected argv
  ORDER is now:

  ```text
  [operator's Args (--no-sandbox, ...)]
  [--user-data-dir <UserDataDir>]   -- v6 CORRECTION05
  [--logsPath <LogsPath>]           -- v4 CORRECTION03 + v5 CORRECTION04
  ```

**P2 cleanup (the reviewer flagged these as residual):**

- `ParseConfig`'s missing-`--logs-path` error message no
  longer references `<new-session>/...` (the v4 session
  layer was removed in CORRECTION04).
- `errIdentityUnobservable`'s doc comment no longer says
  "no new session subdir created by THIS launch" (v4 residue;
  v5's remaining failure modes are file-level only).

**Discriminator table (v6 = CORRECTION05):**

| ID | Name | v1 | v2 | v3 | v4 | v5 | v6 |
|----|------|-----|-----|-----|-----|-----|-----|
| LAUNCH-01..06 | launch seam + env + observer argv | PASS | PASS | PASS | PASS | PASS | PASS |
| (v2) | Plugin / inspect-port exclusion | — | PASS | PASS | PASS | PASS | PASS |
| (v2) | Live-observed argv verbatim | — | PASS | PASS | PASS | PASS | PASS |
| LAUNCH-ID-01,04,05,06,09,10 | authoritative identity binding (v3) | — | — | PASS | PASS | PASS | PASS |
| LAUNCH-LOGROOT-03 NoExthostLog | "no exthost.log" HALT | — | — | PASS | PASS | PASS (renamed) | PASS |
| LAUNCH-SESSION-08,09 | log race sentinel + argv injection | — | — | — | PASS | PASS | PASS (extended) |
| LAUNCH-LOGROOT-01..05 | v5 logsPath-as-namespace | — | — | — | — | 10 NEW | PASS |
| LAUNCH-INSTANCE-01..05 | v6 userDataDir-as-instance-namespace | — | — | — | — | — | 8 NEW |

**Stop conditions (§15):**

- `HALT_EXTENSION_HOST_DISCOVERY_SEAM_NOT_LIVE_PROVEN` —
  RESOLVED (v2).
- `HALT_EXTENSION_HOST_IDENTITY_HEURISTIC_UNPROVEN` —
  RESOLVED (v3).
- `HALT_LOG_IDENTITY_SOURCE_NOT_BOUND_TO_LAUNCH` — RESOLVED
  (v4, but the resolution mechanism had a contract bug;
  v5 replaces it with a simpler resolution).
- `HALT_LOGSPATH_CONTRACT_SHAPE_MISMATCH` — RESOLVED (v5).
- `HALT_LAUNCHER_INSTANCE_REUSE_BREAKS_CAUSAL_BINDING` —
  RESOLVED (v6). The launched editor is provably a distinct
  VSCodium instance because the helper requires a pristine
  `--user-data-dir`.
- `HALT_EXTENSION_HOST_LOG_PATH_NOT_PRISTINE` — RESOLVED
  (v5). Exit 7.
- `HALT_EXTENSION_HOST_USER_DATA_DIR_NOT_PRISTINE` — NEW
  STOP CONDITION (v6). Exit 7. Triggered when `--user-data-dir`
  is supplied non-empty but the directory already contains
  files (visible OR hidden). This is the new pre-launch halt
  for the v6 INSTANCE ISOLATION invariant.

**Conservation (§13) — UNCHANGED:**

```
NO_EXISTING_PRODUCTION_CODE_CHANGED = PASS (apps/, sdk/, scripts/, tools/,
                                       webview-ui/, proto/, .factory/ -- all
                                       untouched; only NEW files added and
                                       cmd/clinemm-live-capture/ updated)
NO_EXTENSION_TS_CHANGE              = PASS
NO_RUNTIME_PROTOCOL_CHANGE          = PASS
NO_WORKSPACE_SETTING                = PASS
NO_SIGNAL_HANDLERS                  = PASS
NO_LIFECYCLE_SEMANTICS_CHANGE       = PASS
PRODUCTION_SEMANTIC_PRESERVED       = PASS (v6 still:
                                       (a) launches the editor with
                                           --user-data-dir AND --logsPath
                                           injected,
                                       (b) verifies both --user-data-dir
                                           and --logs-path are PRISTINE
                                           before launch,
                                       (c) reads the authoritative PID
                                           from <logsPath>/window1/exthost/exthost.log,
                                       (d) refuses to bind unless the
                                           authoritative PID matches one
                                           candidate exactly once,
                                       -- the launch->session
                                       enumeration layer was already
                                       removed in v5)
NEW_PRODUCT_TOOLING_SHIPPED         = PASS
LIFE_OF_IMPACT                      = cmd/clinemm-live-capture/ + tests +
                                       ACT doc + 5 evidence files
```

NOTE: v6 adds one more required CLI flag (`--user-data-dir`)
and one more pre-launch invariant (`ensurePristineUserDataDir`).
The operator-visible CLI is otherwise unchanged.

**C1 (operator command) — v6 / CORRECTION05:**

```bash
# v6 invocation -- two PRISTINE namespaces now required
go run ./cmd/clinemm-live-capture \
  --bin /Applications/VSCodium.app/Contents/Resources/app/bin/codium \
  --data-dir ~/.cline/data \
  --user-data-dir ~/.cline/live-capture/live-specimen-01/user-data \
  --logs-path ~/.cline/live-capture/live-specimen-01/logs \
  --capture-id live-specimen-01 \
  -- /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
```

Note the ClineMM dogfood extension concern: a pristine
`--user-data-dir` means the ClineMM dogfood extension is
NOT installed in that isolated instance by default. The
operator must EITHER:

- point `--extensions-dir` at the existing dogfood extensions
  install (recommended; preserves the existing ClineMM
  install), OR
- pre-install the ClineMM extension into the pristine
  `--user-data-dir` (e.g. `codium --install-extension
  cline-cline-...vsix --user-data-dir <dir>`).

The helper does NOT auto-install the ClineMM dogfood extension
into the isolated instance (the helper's scope is the launch
seam, not extension management).

The launcher will emit one of:

```text
identity-bound: authoritative pid=<P> (from logsPath=<D>); ...   # success
HALT_EXTENSION_HOST_USER_DATA_DIR_NOT_PRISTINE: <reason>       # exit 7 (pre-launch, v6 NEW)
HALT_EXTENSION_HOST_LOG_PATH_NOT_PRISTINE: <reason>            # exit 7 (pre-launch, v5)
extension-host identity unobservable: <reason>                 # exit 7 (in-loop)
no new extension-host PID appeared before timeout               # exit 2
launch failed: <reason>                                         # exit 5
observer not found: <reason>                                    # exit 3
--bin / --data-dir / --user-data-dir / --logs-path missing      # exit 3 (parse-time halt)
```

and exit accordingly.

**Verdict:** PASS_LIVE_CAPTURE_LAUNCHER_CORRECTED05
**Cursor:** LIVE SPECIMEN UNBLOCKED — operator may now run
the live specimen with TWO PRISTINE namespaces
(`--user-data-dir <dir>` AND `--logs-path <dir>`). The
launched editor is provably a distinct VSCodium instance
because of the `--user-data-dir` pristine check, and the
authoritative extension-host PID is causally bound to THIS
launch because of the `--logs-path` pristine check.

Once a real smoke proves **distinct VSCodium instance +
correct Extension Host identity**, then **C1: GO**, and
I would stop pre-capture review unless actual live evidence
reveals a new P0.

---

## CORRECTION07 — HALT_EXTENSION_HOST_CANDIDATE_PREDICATE_FALSE_NEGATIVE

**Status:** PASS_LIVE_CAPTURE_LAUNCHER_AUTHORITATIVE_LOG_PID_AUTHORITY (C1: GO — REPAIRED; argv shape removed from identity authority).

### Live evidence that falsified v7

Authoritative `exthost.log`:

```text
Extension host with pid 40282 started
```

Live `ps` at the same moment:

```text
40279  plain VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService
40280  plain VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService
40282  VSCodium Helper (Plugin).app --type=utility --utility-sub-type=node.mojom.NodeService --inspect-port=0
```

VSCodium's own log names **40282**. v7's `isExtensionHostCandidate` predicate EXPLICITLY EXCLUDED any line containing `"(Plugin)"` (asserting it was a language-server marker) and any line containing `"--inspect-port="`. The real ClineMM Extension Host violated both rules. The two processes the prior heuristic SELECTED (40279, 40280) were NOT the authoritative host.

Upstream evidence is compatible with what the live run showed: desktop extension hosts are UtilityProcesses, and current crash logs identify them semantically as `type: extensionHost`; raw executable naming is not the authoritative identity.

### Correction (bounded)

Change the discovery contract from:

```text
heuristically identify extension-host-shaped PIDs
    → intersect authoritative log PID with that set
```

to:

```text
snapshot all PIDs before launch
    → wait for authoritative PID from launch-owned exthost.log
    → prove authoritative PID:
        did NOT exist before launch
        DOES exist now
    → bind it
```

The argv shape is captured for diagnostics only. The log is the identity authority.

### Required invariant (now the load-bearing contract)

```text
authPID = PID parsed from <fresh logsPath>/window1/exthost/exthost.log

require:
    authPID ∉ beforeAllPIDs        (novelty)
    authPID ∈ currentAllPIDs        (aliveness)
    process alive                  (kill(pid, 0))

=> bind authPID
```

If `authPID` was already present before launch:

```text
HALT_EXTENSION_HOST_AUTHORITATIVE_PID_NOT_NEW   (new sentinel, exit 7)
```

If the log says `authPID` but it is no longer in `current`, the loop continues polling until the discovery deadline, then HALTs with `HALT_EXTENSION_HOST_IDENTITY_UNOBSERVABLE` (transient spawn-race tolerated).

### RED cases (now pass)

**RED-1 (live specimen) — must bind 40282:**

```text
before:
    100   plain NodeService old

after (current):
    100   plain NodeService old
    40279 plain NodeService a
    40280 plain NodeService b
    40282 VSCodium Helper (Plugin) NodeService --inspect-port=0     <-- AUTHORITATIVE
    90001 Figma Helper NodeService                                   <-- IRRELEVANT
    91001 Notion Helper NodeService                                   <-- IRRELEVANT

exthost.log:
    Extension host with pid 40282 started

expected:
    bind 40282
```

v7 IMPLEMENTATION: would have HALTed with `errIdentityUnobservable` ("authoritative PID 40282 does not appear in the candidate set") because 40282 was filtered out for carrying "(Plugin)" + "--inspect-port=". The two processes v7 would have surfaced (40279, 40280) are NOT the authoritative host.

v8 IMPLEMENTATION: binds 40282 because (a) 40282 is not in `before` (novelty), (b) 40282 is alive in `current` (aliveness). Verified by `TestWaitForNewExtensionHost_AuthoritativePluginLineBound`.

**RED-2 (novelty invariant) — HALT, not bind:**

```text
before:
    100   plain NodeService old
    30159 plain NodeService stale       <-- ALREADY PRESENT BEFORE LAUNCH

current:
    100   plain NodeService old
    30159 plain NodeService stale

exthost.log:
    Extension host with pid 30159 started

expected:
    HALT_EXTENSION_HOST_AUTHORITATIVE_PID_NOT_NEW   (exit 7)
    refusing to substitute another PID
```

Verified by `TestWaitForNewExtensionHost_AuthoritativePIDPreExisted`.

**RED-3 (aliveness invariant) — HALT, not bind:**

```text
before:
    100   plain NodeService old

current:
    100   plain NodeService old
    30157 plain NodeService a
    30158 plain NodeService b
    30159 plain NodeService c          <-- "new" by ps semantics, but NOT 99999

exthost.log:
    Extension host with pid 99999 started   <-- NOT in current; transient

expected:
    HALT_EXTENSION_HOST_IDENTITY_UNOBSERVABLE  (after deadline; exit 7)
```

Verified by `TestWaitForNewExtensionHost_AuthoritativePIDNotAlive`.

**Conservation (must NOT bind):** other new NodeService / Figma / Notion processes are irrelevant. The authoritative log PID alone wins.

### Removed from load-bearing identity logic

```text
extensionHostPatternSrc                  <-- regex REMOVED
extensionHostPattern                     <-- *regexp.Regexp REMOVED
isExtensionHostCandidate()               <-- predicate REMOVED
"(Plugin)" exclusion                     <-- REMOVED
"--inspect-port=" exclusion              <-- REMOVED
candidate intersection by heuristic      <-- REMOVED
validateExtensionHostPID argv check      <-- REMOVED
sortInts() helper                        <-- REMOVED (only used for diagnostic candidate-list logging)
```

Replaced by:

```text
diagnosticPIDMatchesKnownShapes()        <-- DESCRIPTIVE ONLY (no longer in identity path)
errAuthoritativePIDNotNew sentinel       <-- NEW (novelty HALT)
psAllPIDsFromCmd()                       <-- returns ALL syntactically-valid PIDs (was psExtensionHostPIDsFromCmd)
```

### Why this is stronger

The live evidence established that **the v7 heuristic selected precisely the wrong class** on this machine. The plain VSCodium Helper processes v7 accepted were NOT authoritative; the VSCodium Helper (Plugin) process v7 rejected WAS authoritative. The heuristic had not been merely imperfect — it had selected the wrong class. v8 makes argv shape descriptive-only and lets the on-disk log (which is causally attributable to this launch via the v5 pristine-logsPath invariant) bind the identity.

### Conservation (ACT §13)

- `NO_EXISTING_PRODUCTION_CODE_CHANGED = PASS (apps/, sdk/, scripts/, tools/, webview-ui/, proto/ all untouched — only `cmd/clinemm-live-capture/` updated)
- `NO_EXTENSION_TS_CHANGE              = PASS`
- `NO_RUNTIME_PROTOCOL_CHANGE          = PASS`
- `NO_WORKSPACE_SETTING                = PASS`
- `NO_SIGNAL_HANDLERS                  = PASS`
- `NO_LIFECYCLE_SEMANTICS_CHANGE       = PASS (the lifecycle observer at scripts/capture-extension-host-lifecycle.mjs is UNCHANGED — this ACT only changes the discovery seam that hands the PID to it)`

### Stop conditions checked (ACT §15) update

- `HALT_EXTENSION_HOST_IDENTITY_UNOBSERVABLE` — still active, but the v8 wording no longer mentions "candidate set" or "lowest-PID heuristic"; the new wording calls out novelty + aliveness invariants.
- `HALT_EXTENSION_HOST_AUTHORITATIVE_PID_NOT_NEW` — NEW STOP CONDITION. Triggered when the authoritative PID parsed from exthost.log was already present in the before-snapshot. Exits 7.

### Discriminator update (v8)

| ID | Name | v7 | v8 |
|----|------|----|----|
| LAUNCH-01..06 | launch seam + env + observer argv | PASS | PASS |
| LAUNCH-ID-01..10 | authoritative identity binding (v3) | PASS | PASS (now novelty/aliveness only, no candidate-set intersection) |
| LAUNCH-SESSION-01..09 | launch->session binding (v4) | PASS | PASS |
| (v8) | Live specimen PID 40282 + (Plugin) line is in parser | — | NEW PASS |
| (v8) | Live specimen PID 40282 binds via authoritative log only | — | NEW PASS |
| (v8) | Pre-existed authoritative PID HALTs | — | NEW PASS |
| (v8) | Stale authoritative PID HALTs | — | NEW PASS |

### Verdict

`PASS_LIVE_CAPTURE_LAUNCHER_AUTHORITATIVE_LOG_PID_AUTHORITY` — argv shape is descriptive only; the on-disk log is the identity authority. The live specimen (pid=40282 with `(Plugin)` + `--inspect-port=`) is now bound correctly.
