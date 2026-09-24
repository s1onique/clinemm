// Phase implementations for clinemm-live-capture. Kept in a
// separate file (rather than main.go) so each phase stays under
// the ACT §10 ~150-220 LOC envelope and so the test file can
// keep `package main` and exercise each phase as a pure seam.
//
// ACT-CLINEMM-EXTENSION-HOST-LIVE-CAPTURE-LAUNCHER01

package main

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// ----- Phase A. snapshot -----

// extensionHostPIDs returns the set of ALL currently-running
// processes (pid -> command-line) on this host. ACT §4 Phase A.
//
// v8 CORRECTION07: previously this function filtered by the
// extension-host argv heuristic (regex + "(Plugin)" /
// "--inspect-port=" exclusions). That heuristic was LIVE-DISPROVEN
// on VSCodium 1.126 -- the real ClineMM Extension Host
// (pid=40282 in the live specimen) runs as
//
//	VSCodium Helper (Plugin).app --type=utility
//	    --utility-sub-type=node.mojom.NodeService
//
// and was EXCLUDED by the prior filter (it carries "(Plugin)").
// The other "extension-host-shaped" processes the prior heuristic
// selected (the plain VSCodium Helper without "(Plugin)") were
// NOT the authoritative extension host.
//
// The discovery loop's only invariants are now:
//
//	authPID = PID parsed from
//	  <logsPath>/window1/exthost/exthost.log
//	require:
//	  authPID not in beforeAllPIDs (novelty)
//	  authPID in currentAllPIDs (aliveness)
//	=> bind authPID
//
// argv shape is captured for diagnostics only. The authorita-
// tive identity source is the on-disk log, not ps argv shape.
func extensionHostPIDs() (map[int]string, error) {
	return psAllPIDsFromCmd(exec.Command("ps", "-axo", "pid=,command="))
}

// psSnapshotFn is a package-level function variable so tests can
// inject a deterministic ps source into waitForNewExtensionHost
// without touching the real /bin/ps. Production code MUST use
// extensionHostPIDs() directly.
var psSnapshotFn = extensionHostPIDs

// sessionListingFn is REMOVED in v5 (CORRECTION04). The v4
// launch->session binding layer assumed the implicit logs
// layout (<userData>/logs/<session>/window1/exthost/exthost.log)
// even after the reviewer demonstrated that explicit --logsPath
// uses logsPath DIRECTLY (no <session>/ subdir). CORRECTION04
// makes the operator-supplied logsPath itself the causal
// namespace; the file read is then
// <logsPath>/window1/exthost/exthost.log directly.

// readExthostLogFn is the package-level test seam for the
// file reader (authoritativePIDFromLog). Production code MUST
// use authoritativePIDFromLog directly. Tests override this to
// inject controlled log/write races (the file appears "later"
// than the directory).
var readExthostLogFn = readExthostLogPIDFromFile

// readExthostLogPIDFromFile is the production file reader.
// It opens <logsPath>/window1/exthost/exthost.log, reads the
// first line, and returns the PID. Returns errExthostLogRace
// when the file is absent or empty (the caller continues
// polling); any other error is a hard parse failure.
//
// v5 CORRECTION04: the path no longer includes a <session>
// subdirectory. Upstream `args.logsPath` (when set) is used
// directly as `logsHome` (verified in this host's VSCodium
// 1.126 main.js: `if(!this.args.logsPath){...}` and
// `return D.file(this.args.logsPath)`), and the exthost log
// is constructed by toResource('exthost') joined onto
// logsHome with window1/ prepended by the per-window logger
// service. Empirical recon on this host confirms:
//
//	<userData>/logs/<session>/window1/exthost/exthost.log
//
// for the IMPLICIT case, which collapses to
//
//	<logsPath>/window1/exthost/exthost.log
//
// for the EXPLICIT case (logsPath = args.logsPath).
func readExthostLogPIDFromFile(logsPath string) (int, error) {
	return authoritativePIDFromLog(logsPath)
}

// psAllPIDsFromCmd is the testable parser seam used by LAUNCH-04.
// It accepts an *exec.Cmd the caller already prepared.
//
// v8 CORRECTION07: the parser used to filter by
// isExtensionHostCandidate (regex + Plugin / inspect-port
// exclusions). That filter is REMOVED -- the prior heuristic was
// LIVE-DISPROVEN (see extensionHostPIDs doc). This function now
// returns ALL pid -> command-line pairs that parse cleanly, so
// the discovery loop's only identity invariants are novelty
// (not in beforeAllPIDs) and aliveness (kill(pid, 0)).
func psAllPIDsFromCmd(cmd *exec.Cmd) (map[int]string, error) {
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	result := map[int]string{}
	s := bufio.NewScanner(bytes.NewReader(out))
	// ps output lines can exceed bufio's default 64 KiB on Linux
	// with long kernel command lines; 1 MiB is comfortably safe.
	s.Buffer(make([]byte, 0, 1<<20), 1<<20)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		cmdline := strings.TrimSpace(strings.TrimPrefix(line, fields[0]))
		result[pid] = cmdline
	}
	if err := s.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// ----- Phase B. launch -----

// startClineMM execs the editor binary with the env invariants from
// ACT §4 Phase B:
//
//	CLINEMM_DIAG_TERMINATION_AUTHORITY=1                SET
//	CLINEMM_DIAG_TERMINATION_CAPTURE_ID=<capture-id>    SET  (v8 CORRECTION08, only when cfg.CaptureID != "")
//	CLINEMM_USER_DATA_DIR=<dir>                        SET  (v7 CORRECTION06)
//	CLINEMM_DIAG_CPU_PROFILE                           UNSET
//	CLINEMM_DIAG_ALLOCATION_PROFILE                    UNSET
//
// stdin/stdout/stderr are inherited so the editor behaves like a
// normal foreground application.
//
// v4 CORRECTION03 + v5 CORRECTION04: the launcher INJECTS
// `--logsPath <cfg.LogsPath>`
// into the launched editor's argv. This is the structural fix for
// the chronology-as-identity problem at the session-binding layer:
// without injection, the helper would read pre-existing session
// directories under LogsPath and could not prove which session
// belongs to THIS launch. Upstream VS Code / VSCodium 1.126 reads
// `args.logsPath` from argv and uses it for the logsHome computed
// in EnvironmentMainService (verified in the production main.js
// bundle: `if(!this.args.logsPath){...W(this.userDataPath,"logs",t)}`
// -- and `args.logsPath` is forwarded to all spawned subprocesses
// including sharedProcess and ptyHost). The wrapper does NOT
// own this flag -- it is the helper's responsibility.
//
// v7 CORRECTION06 (replaces v6 CORRECTION05's argv-injection
// strategy): the launcher DOES NOT inject `--user-data-dir
// <cfg.UserDataDir>` into argv. Instead, it SETS
// `CLINEMM_USER_DATA_DIR=<cfg.UserDataDir>` on the child
// environment. The operator's `codium-clinemm` wrapper reads
// this env var and emits `--user-data-dir "$DATA_DIR"` (and
// `--extensions-dir "$EXT_DIR"`) itself. Two reasons the
// wrapper owns this flag, not the helper:
//
//  1. The wrapper is the canonical seam: the wrapper preserves
//     production defaults (extensions at
//     `~/.vscodium-clinemm/extensions`, profile at
//     `CLINEMM_RUNTIME_PROFILE=dogfood`, `CLINEMM_PTAD=1`,
//     etc.). Having the helper also inject `--user-data-dir`
//     produces a DUPLICATE `--user-data-dir` argv in the
//     final exec, with last-wins semantics that depend on the
//     order of helper-args vs. wrapper-emitted args. The
//     wrapper-driven form is single-source-of-truth.
//
//  2. The forensic launcher path: a forensic replay wants to
//     override the user-data-dir WITHOUT giving up the
//     production-shaped extensions/profile/etc. Passing the
//     override as an env var lets the operator tell the
//     wrapper "use this fresh user-data, keep everything else
//     default" without rebuilding the wrapper.
//
// The pristine check on cfg.UserDataDir still happens in main()
// via ensurePristineUserDataDir BEFORE this function is called;
// the instance-isolation contract is preserved.
func startClineMM(cfg *Config) (*exec.Cmd, error) {
	// Build argv: editor binary, then the operator's remaining
	// args, then --logsPath (CAUSAL BINDING seam for the
	// discovery loop, v4 / v5 -- the wrapper does not own this
	// flag). NOTE: --user-data-dir is INTENTIONALLY NOT here;
	// the wrapper emits it via $CLINEMM_USER_DATA_DIR (see v7
	// CORRECTION06 above). ParseConfig rejects empty
	// cfg.UserDataDir / cfg.LogsPath before this point.
	args := append([]string{}, cfg.Args...)
	if cfg.LogsPath != "" {
		args = append(args, "--logsPath", cfg.LogsPath)
	}
	cmd := exec.Command(cfg.Bin, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	env := filteredEnv(
		os.Environ(),
		envCPUProfileRemove,
		envAllocProfileRemove,
	)
	// v7 CORRECTION06: append the wrapper's user-data-dir
	// override marker so the wrapper picks it up. We use a
	// final-append (vs. an os.Setenv on this process) so a
	// subsequent forensic launcher invocation on the same
	// parent shell is not affected.
	if cfg.UserDataDir != "" {
		env = append(env, envUserDataDirSet+"="+cfg.UserDataDir)
	}
	// v8 CORRECTION08 + v9 CORRECTION09: share the launcher's
	// capture ID with the in-process Node witness so both halves
	// of the termination-authority capture land under the SAME
	// `capture-<id>/` directory the analyzer composes. `cfg.CaptureID`
	// is the SINGLE authority for the effective capture ID; main()
	// always populates it (operator-supplied --capture-id, or the
	// default `live-YYYYMMDD-HHMMSS`). The `!= ""` guard is
	// defensive -- if it ever fires, the Node witness falls back
	// to its factory and the analyzer would not be able to
	// compose the two halves.
	if cfg.CaptureID != "" {
		env = append(env, envTerminationCaptureIdSet+"="+cfg.CaptureID)
	}
	env = append(env, envAuthority)
	cmd.Env = env

	if err := cmd.Start(); err != nil {
		return nil, err
	}
	fmt.Printf("CLINEMM_LAUNCHED pid=%d\n", cmd.Process.Pid)
	return cmd, nil
}

// filteredEnv returns env with any entries whose key matches one of
// the deny-list removed. Used by LAUNCH-05 to assert the env
// invariants without mutating the caller's slice. This is *not* a
// shell-based env mutation -- it's stdlib os.Environ() parsing.
func filteredEnv(env []string, deny ...string) []string {
	denySet := map[string]struct{}{}
	for _, k := range deny {
		denySet[k] = struct{}{}
	}
	out := make([]string, 0, len(env))
	for _, item := range env {
		key, _, ok := strings.Cut(item, "=")
		if !ok {
			continue
		}
		if _, blocked := denySet[key]; blocked {
			continue
		}
		out = append(out, item)
	}
	return out
}

// releaseChildOnExit ensures the launched editor does not become a
// zombie if the helper process exits while the observer is still
// running. This is NOT a ClineMM lifecycle semantics change; it is
// only plugin-restraint scope.
func releaseChildOnExit(child *exec.Cmd) {
	if child == nil {
		return
	}
	go func() { _ = child.Wait() }()
}

// ensurePristineLogsPath makes logsPath safe for causal identity
// binding under v5 (CORRECTION04). The helper's invariant is:
//
//	<logsPath>/window1/exthost/exthost.log
//
// is read by the discovery loop as the authoritative extension-
// host identity. For that file to be CAUSALLY attributable to
// THIS launch (rather than to a stale or concurrent editor),
// the directory under logsPath MUST be either:
//
//	(a) non-existent (we create it), or
//	(b) exist and be EMPTY (no files, no subdirs).
//
// Any pre-existing content under logsPath means we cannot
// prove which files came from our launch vs. from a stale
// session. We refuse to launch (HALT_EXTENSION_HOST_LOG_PATH
// _NOT_PRISTINE, exit 7) and require the operator to either
// point at a fresh directory OR delete the stale contents.
//
// This is structurally simpler than the v4 launch->session
// binding layer: the operator-supplied logsPath itself is the
// causal namespace.
func ensurePristineLogsPath(logsPath string) error {
	return ensurePristineDir(logsPath, errLogPathNotPristine,
		"refusing to launch because we cannot prove which files came from this launch vs. a stale session")
}

// ensurePristineUserDataDir makes userDataDir safe for instance
// isolation under v6 (CORRECTION05). The helper's invariant is:
//
//	<userDataDir>/...
//
// is read by the launched VSCodium as its user-data-dir. For
// the launched editor to be provably a DISTINCT instance (and
// not a secondary CLI invocation forwarded to an already-running
// VSCodium main process), userDataDir MUST be either:
//
//	(a) non-existent (we create it), or
//	(b) exist and be EMPTY (no files from a previous launch).
//
// Any pre-existing content under userDataDir means we cannot
// prove the launched editor is a distinct instance. We refuse
// to launch (HALT_EXTENSION_HOST_USER_DATA_DIR_NOT_PRISTINE,
// exit 7) and require the operator to either point at a fresh
// directory OR delete the stale contents.
//
// Note: a pristine user-data-dir means the ClineMM dogfood
// extension is NOT installed in that isolated instance by
// default. The operator must point --extensions-dir at the
// existing dogfood extensions install (or pre-install the
// ClineMM extension into the pristine user-data-dir).
func ensurePristineUserDataDir(userDataDir string) error {
	return ensurePristineDir(userDataDir, errUserDataDirNotPristine,
		"refusing to launch because a non-empty --user-data-dir may indicate an existing VSCodium instance that would forward this CLI invocation to its main process, breaking causal binding of the launched editor's extension host to THIS launch (see VS Code upstream docs: --user-data-dir is the supported mechanism for opening a distinct instance)")
}

// ensurePristineDir is the shared implementation behind
// ensurePristineLogsPath and ensurePristineUserDataDir. The
// sentinel error and the explanatory tail are injected by the
// caller so the operator-visible error message names the
// specific invariant that was violated. If `dir` is empty we
// return an error of the supplied sentinel type without
// touching the filesystem (caller invariant: an empty path
// means "no directory was supplied", which the parse layer
// should already have rejected).
//
// We always create the directory if it does not exist; that
// way the helper does not require the operator to mkdir first.
// We only HALT when the directory already exists and is non-
// empty (which is the only state we cannot prove is fresh).
func ensurePristineDir(dir string, sentinel error, tail string) error {
	if dir == "" {
		return fmt.Errorf("%w: %s", sentinel, "directory is empty")
	}
	info, err := os.Stat(dir)
	if err != nil {
		if os.IsNotExist(err) {
			// (a) does not exist: create it. MkdirAll is safe
			// even if a parallel mkdir already created it; we
			// then re-stat to confirm the result.
			if mkErr := os.MkdirAll(dir, 0o755); mkErr != nil {
				return fmt.Errorf("%w: mkdir %s: %v", sentinel, dir, mkErr)
			}
			return nil
		}
		return fmt.Errorf("%w: stat %s: %v", sentinel, dir, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("%w: %s exists but is not a directory", sentinel, dir)
	}
	// (b) exists: it must be empty.
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("%w: readdir %s: %v", sentinel, dir, err)
	}
	if len(entries) > 0 {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		return fmt.Errorf("%w: %s is not empty (%d entries: %v) -- %s",
			sentinel, dir, len(entries), names, tail)
	}
	return nil
}

// ----- Phase C. discover -----

// waitForNewExtensionHost polls ps every 200ms until at least one
// new extension-host PID appears, then resolves the authoritative
// extension-host PID from VSCodium's own session log.
//
// v5 (ACT §15 review correction04): the v4 launch->session
// binding layer (snapshot sessionsBefore, compute
// newSessions = sessionsNow - sessionsBefore, refuse unless
// len == 1) was internally inconsistent with the very main.js
// evidence v4 cited. When the operator passes --logsPath <dir>
// explicitly, VSCodium 1.126 uses <dir> DIRECTLY as logsHome
// (verified in production main.js:
//
//	get logsHome(){if(!this.args.logsPath){const t=ID(new Date).replace(/-|:|\.\d+Z$/g,"");
//	  this.args.logsPath=W(this.userDataPath,"logs",t)}
//	  return D.file(this.args.logsPath)}
//
// -- when args.logsPath is set, the <session>/ subdirectory
// synthesis is BYPASSED). The on-disk layout then collapses
// to:
//
//	<logsPath>/window1/exthost/exthost.log
//
// v5 takes the reviewer's recommended simplification: the
// operator-supplied logsPath ITSELF becomes the causal
// namespace. The helper:
//
//  1. ensures logsPath is PRISTINE (does not exist OR is
//     empty) BEFORE launching (ensurePristineLogsPath),
//  2. injects `--logsPath <logsPath>` into the launched
//     editor's argv (startClineMM),
//  3. polls ps for new extension-host PIDs while polling
//     <logsPath>/window1/exthost/exthost.log for the
//     authoritative PID,
//  4. intersects authoritative with the new-PID candidate set
//     EXACTLY ONCE.
//
// Authoritative source (unchanged from v3):
//
//	<logsPath>/window1/exthost/exthost.log,
//	first line verbatim:
//
//	  2026-09-17 17:46:58.272 [info] Extension host with pid 1408 started
//
// waitForNewExtensionHost polls ps every 200ms until at least one
// new PID appears, then resolves the authoritative extension-host
// PID from VSCodium's own session log and binds it under the
// novelty + aliveness invariants.
//
// v8 (ACT §15 review correction07): the v7 heuristic-based
// discovery intersected the authoritative log PID with a
// heuristic-filtered subset of new PIDs:
//
//	candidates := filter(current \ before, isExtensionHostCandidate)
//	intersect(authPID, candidates)
//
// That intersection was LIVE-DISPROVEN on VSCodium 1.126: the
// real ClineMM Extension Host (pid=40282) carries "(Plugin)" in
// argv and was excluded by isExtensionHostCandidate, while the
// plain VSCodium Helper processes (which the prior heuristic
// ACCEPTED) were NOT the authoritative host.
//
// v8 inverts the contract: argv shape is descriptive only, and
// identity binding is:
//
//	authPID = PID parsed from <logsPath>/window1/exthost/exthost.log
//	require:
//	  authPID not in before (novelty)
//	  authPID in current (aliveness)
//	=> bind authPID
//
// Other new processes (Figma, Notion, NodeService helpers,
// whatever) are irrelevant. The authoritative log PID alone wins.
//
// v5 (CORRECTION04) invariant remains: the operator-supplied
// logsPath itself is the causal namespace. <logsPath>/window1/
// exthost/exthost.log is parsed as the authoritative source
// (verified in VSCodium 1.126 main.js: explicit --logsPath uses
// the supplied directory directly as logsHome, bypassing the
// <session>/ subdirectory synthesis).
func waitForNewExtensionHost(before map[int]string, timeout time.Duration, logsPath string) (int, error) {
	if logsPath == "" {
		return 0, fmt.Errorf("%w: --logs-path is required",
			errIdentityUnobservable)
	}

	deadline := time.Now().Add(timeout)

	for {
		current, err := psSnapshotFn()
		if err != nil {
			return 0, fmt.Errorf("ps snapshot: %w", err)
		}

		// 1. Read authoritative PID from
		//    <logsPath>/window1/exthost/exthost.log.
		//    Tolerate file-not-yet-written race.
		authPID, err := readExthostLogFn(logsPath)
		if err != nil {
			if errors.Is(err, errExthostLogRace) {
				if time.Now().After(deadline) {
					return 0, fmt.Errorf("%w: <logsPath>/window1/exthost/exthost.log was not written before the timeout (the launched editor never reached log-init, or --logsPath was not honored)",
						errIdentityUnobservable)
				}
				time.Sleep(discoverInterval())
				continue
			}
			return 0, fmt.Errorf("%w: <logsPath>/window1/exthost/exthost.log: %v",
				errIdentityUnobservable, err)
		}

		// 2. Novelty: authPID MUST NOT have existed before launch.
		//    If the authoritative log names a PID that was
		//    already running when we snapshot, we cannot prove
		//    this is the launched editor's extension host (it
		//    may be a stale process left from a prior session).
		//    This is a HALT, not a silent fallback.
		if _, preExisted := before[authPID]; preExisted {
			return 0, fmt.Errorf(
				"%w: authoritative pid=%d (from <logsPath>/window1/exthost/exthost.log) was already present before launch (it appears in before-snapshot of %d PIDs) -- the launched editor's identity cannot be bound to this PID; refusing to substitute another PID",
				errAuthoritativePIDNotNew, authPID, len(before))
		}

		// 3. Aliveness: authPID MUST be alive now.
		if _, alive := current[authPID]; !alive {
			// Either a spawn-race (PID appeared briefly then
			// exited; transient) OR the launched editor never
			// actually started. We tolerate the former by
			// continuing to poll within the deadline.
			if time.Now().After(deadline) {
				return 0, fmt.Errorf(
					"%w: authoritative pid=%d (from logsPath=%s) is no longer alive (was never present in current ps snapshot) within the discovery window",
					errIdentityUnobservable, authPID, logsPath)
			}
			time.Sleep(discoverInterval())
			continue
		}

		// 4. Bind. The authoritative PID is the identity; the
		//    argv shape is captured for diagnostics only.
		authCmdline := current[authPID]
		diagnostic := "no-known-shape"
		if diagnosticPIDMatchesKnownShapes(authCmdline) {
			diagnostic = "matches-known-shape"
		}
		fmt.Fprintf(os.Stderr,
			"identity-bound: authoritative pid=%d (from logsPath=%s); argv-shape-diagnostic=%s; cmdline=%q\n",
			authPID, logsPath, diagnostic, authCmdline)
		return authPID, nil
	}
}

// lowestOf was REMOVED in v3 (CORRECTION02). The chronology-as-
// identity heuristic was the v2 fix; v3 requires the authoritative
// PID from VSCodium's own session log. v4 (CORRECTION03) takes
// this further: the chosen session MUST be causally attributable
// to THIS launch (newSessions = sessionsNow - sessionsBefore).
// Chronology is not identity at ANY layer.

// sortInts was REMOVED in v8 (CORRECTION07). v7's waitForNewExtensionHost
// returned a sorted candidate list for diagnostics; v8 returns
// only the authoritative PID plus the descriptive argv hint
// (no candidate-list logging needed). Pulling in the sort
// package for a side-effect-only diagnostic was not justified.

// exthostStartedLineRegex matches the first line of
// `<logsPath>/window1/exthost/exthost.log`,
//
//	2026-09-17 17:46:58.272 [info] Extension host with pid 1408 started
//
// capture group 1 is the PID. The line is exact; any drift in
// timestamp format or wording causes a parse failure and an
// HALT_EXTENSION_HOST_IDENTITY_UNOBSERVABLE stop.
var exthostStartedLineRegex = regexp.MustCompile(
	`^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \[info\] Extension host with pid (\d+) started$`,
)

// authoritativePIDFromLog reads
// <logsPath>/window1/exthost/exthost.log and returns the
// authoritative extension-host PID parsed from its first line.
//
// v5 CORRECTION04: the on-disk layout when --logsPath is set
// explicitly is <logsPath>/window1/exthost/exthost.log -- there
// is NO <session>/ subdirectory between logsPath and window1
// (verified in this host's VSCodium 1.126 main.js and against
// the empirical layout of all 10 pre-existing exthost.log
// files on this host, which collapse to the same shape once
// --logsPath is provided).
//
// The function returns errExthostLogRace when the file does
// not exist yet (or is empty). The caller treats this as a
// transient and continues polling until the file materialises
// or the deadline expires. Only malformed content AFTER the
// file exists is a hard parse failure.
func authoritativePIDFromLog(logsPath string) (int, error) {
	exthostLog := filepath.Join(logsPath, "window1", "exthost", "exthost.log")
	f, err := os.Open(exthostLog)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, fmt.Errorf("%w: %s", errExthostLogRace, exthostLog)
		}
		return 0, fmt.Errorf("open %s: %w", exthostLog, err)
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 1<<10), 1<<16)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return 0, fmt.Errorf("scan %s: %w", exthostLog, err)
		}
		// File exists but is empty. This is the same transient
		// as file-not-yet-written; the caller continues polling.
		return 0, fmt.Errorf("%w: empty %s", errExthostLogRace, exthostLog)
	}
	line := strings.TrimSpace(scanner.Text())
	pid, ok := parseExthostStartedLine(line)
	if !ok {
		// File exists and has content, but the content does
		// not match the expected exthost.log first-line
		// format. This is a HARD parse failure (format drift
		// or a wrong file) -- not a transient.
		return 0, fmt.Errorf("first line of %s did not match exthost-started pattern: %q", exthostLog, line)
	}
	return pid, nil
}

// errExthostLogRace is the transient sentinel returned by
// authoritativePIDFromLog when <logsPath>/window1/exthost/exthost.log
// has not yet been written (or is empty). The discovery loop
// treats this as a normal transient and continues polling
// until either the file materialises or the deadline expires.
//
// It is distinct from errIdentityUnobservable: the latter
// means the helper refuses to bind (HALT); the former means
// "not ready yet, try again."
var errExthostLogRace = errors.New("exthost.log not yet written (log/write race; transient)")

// parseExthostStartedLine extracts the PID from a single
// `Extension host with pid <N> started` line. Returns ok=false
// if the line doesn't match exactly.
func parseExthostStartedLine(line string) (int, bool) {
	m := exthostStartedLineRegex.FindStringSubmatch(line)
	if len(m) != 2 {
		return 0, false
	}
	pid, err := strconv.Atoi(m[1])
	if err != nil {
		return 0, false
	}
	return pid, true
}

// discoverInterval is a tiny seam so tests can shrink the 200ms
// poll cadence without sleeping the full duration. Production code
// reads it once per iteration; the constant is fixed.
func discoverInterval() time.Duration { return 200 * time.Millisecond }

// ----- Phase D. validate -----

// validateExtensionHostPID checks the new PID is alive
// (kill(pid, 0) -> no error) AND is still present in a fresh
// ps snapshot. ACT §5: invalid PID would lead the observer to
// record stale-PID evidence and emit
// extension_host_observed_alive=false downstream.
//
// v8 CORRECTION07: the prior implementation also re-checked the
// argv shape via isExtensionHostCandidate, rejecting any PID
// whose command line later changed shape. That check used the
// LIVE-DISPROVEN heuristic ("(Plugin)" or "--inspect-port=")
// and would have rejected the real ClineMM Extension Host
// (pid=40282 in the live specimen). Removed: argv shape is no
// longer part of identity authority.
func validateExtensionHostPID(pid int) error {
	if err := syscall.Kill(pid, 0); err != nil {
		return fmt.Errorf("kill(pid, 0): %w", err)
	}
	current, err := extensionHostPIDs()
	if err != nil {
		return fmt.Errorf("re-snapshot: %w", err)
	}
	if _, ok := current[pid]; !ok {
		return fmt.Errorf("pid disappeared between discovery and handoff")
	}
	return nil
}

// ----- Phase E. handoff -----

// captureDirectory is the canonical parent-lifecycle.json directory
// for the given data dir + capture id, mirroring
// scripts/capture-extension-host-lifecycle.mjs:resolveCaptureDir.
func captureDirectory(dataDir, captureID string) string {
	return filepath.Join(
		dataDir,
		"diagnostics",
		"termination-authority",
		"capture-"+captureID,
	)
}

// observerScriptPath finds scripts/capture-extension-host-lifecycle.mjs
// rooted at the discovered repo root, falling back to ./scripts
// relative to cwd. ACT §7 prefers repo-root discovery.
func observerScriptPath(repoRoot string) (string, error) {
	if repoRoot != "" {
		candidate := filepath.Join(
			repoRoot,
			"scripts",
			"capture-extension-host-lifecycle.mjs",
		)
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	if cwd, err := os.Getwd(); err == nil {
		alt := filepath.Join(cwd, "scripts", "capture-extension-host-lifecycle.mjs")
		if _, err := os.Stat(alt); err == nil {
			return alt, nil
		}
	}
	return "", errObserverScriptMissing
}

// errObserverScriptMissing is exported via the sentinel returned by
// observerScriptPath; the main loop translates it to exit code 3.
var errObserverScriptMissing = fmt.Errorf(
	"could not locate scripts/capture-extension-host-lifecycle.mjs " +
		"(cwd must be inside a clinemm checkout)",
)

// runObserver execs the existing lifecycle observer, returning its
// exit code or exitObserverFailed on a non-exit error.
//
// LAUNCH-06: argv exactness. The order and presence of these flags
// is the documented observer contract; do not silently reorder them.
func runObserver(cfg *Config, captureID string, pid int) int {
	observerPath, err := observerScriptPath(cfg.RepoRoot)
	if err != nil {
		fmt.Fprintf(os.Stderr, "observer not found: %v\n", err)
		return exitObserverMissing
	}

	args := []string{
		observerPath,
		"--capture-id", captureID,
		"--pid", strconv.Itoa(pid),
		"--cadence-ms", strconv.FormatInt(cfg.Cadence.Milliseconds(), 10),
		"--duration-ms", strconv.FormatInt(cfg.Duration.Milliseconds(), 10),
		"--data-dir", cfg.DataDir,
	}

	cmd := exec.Command("node", args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	fmt.Println("OBSERVER_STARTED")
	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return ee.ExitCode()
		}
		return exitObserverFailed
	}
	return exitOK
}

// ----- helpers -----

// discoverRepoRoot walks up from cwd looking for a directory that
// contains BOTH .factory/ and scripts/capture-extension-host-lifecycle.mjs;
// the pair uniquely identifies this repo among the operator's
// workspaces. Falls back to cwd so observerScriptPath can use the
// relative ./scripts lookup. ACT §7 permits this fallback.
func discoverRepoRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	dir := wd
	for i := 0; i < 12; i++ { // bounded: avoid infinite symlink loops
		if _, err1 := os.Stat(filepath.Join(dir, ".factory")); err1 == nil {
			if _, err2 := os.Stat(
				filepath.Join(dir, "scripts", "capture-extension-host-lifecycle.mjs"),
			); err2 == nil {
				return dir, nil
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return wd, nil
}
