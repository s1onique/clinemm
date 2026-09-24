// clinemm-live-capture: tiny Go operator helper that launches
// ClineMM/VSCodium, identifies the newly created local Extension
// Host PID, and hands off to the existing lifecycle observer.
//
// # ACT-CLINEMM-EXTENSION-HOST-LIVE-CAPTURE-LAUNCHER01
//
// This program replaces the >50-line Bash wrapper the operator was
// previously running manually. It does NOT replace or duplicate the
// lifecycle observer at scripts/capture-extension-host-lifecycle.mjs;
// that observer remains the authoritative external witness. This
// program only owns the launch -> identify-new-PID -> exec-observer
// seam. Classification, sampling, restart detection, and analyzer
// logic all remain in the observer and the analyzer.
//
// Phases (per ACT §4):
//
//	A. snapshot: ps -axo pid=,command=  ->  before set
//	B. launch:   exec.Command(bin, args...) with filtered env
//	C. discover: poll ps every 200ms up to 20s for a NEW
//	             --type=extensionHost PID; bind it if exactly 1
//	D. validate: kill(pid, 0) + ps re-read must confirm
//	E. handoff:  exec node scripts/capture-extension-host-lifecycle.mjs
//	             with the validated PID + cadence + duration
//
// Exit semantics (per ACT §8, v5 = CORRECTION04, v6 = CORRECTION05):
//
//	0  observer completed successfully
//	2  no new Extension Host found
//	3  observer script missing / node unavailable / required
//	   CLI flag missing (--bin, --logs-path, --user-data-dir, --data-dir)
//	4  reserved
//	5  failed to launch ClineMM
//	6  observer failed
//	7  HALT_EXTENSION_HOST_IDENTITY_UNOBSERVABLE: --logs-path
//	   was missing, no exthost.log was written under
//	   <logs-path>/window1/exthost/ within the discovery
//	   window, the file was unparseable, the authoritative PID
//	   did not intersect the candidate set exactly once, or
//	   MORE THAN ONE candidate was bound by the authoritative
//	   PID. Also HALT_EXTENSION_HOST_LOG_PATH_NOT_PRISTINE:
//	   --logs-path was supplied non-empty but the directory
//	   already contained files (we could not prove the
//	   exthost.log that would appear there came from THIS
//	   launch). Also HALT_EXTENSION_HOST_USER_DATA_DIR_NOT_PRISTINE:
//	   --user-data-dir was supplied non-empty but the directory
//	   already contained files (we could not prove the launched
//	   editor is a distinct instance -- the ClineMM dogfood
//	   extension may be missing from a fresh user-data-dir, so
//	   this halt is informational; resolve by pointing
//	   --extensions-dir at the existing dogfood extensions
//	   install).
//	8  reserved (was v4 HALT_LOG_SESSION_AMBIGUOUS; removed in
//	   v5 because the v4 launch->session binding layer was
//	   internally inconsistent with the very main.js evidence
//	   it cited -- explicit --logsPath bypasses the
//	   <session>/ subdirectory synthesis, so the layer was
//	   dead code on the explicit path it was supposed to fix).
//
// Conservation (per ACT §13, v6 = CORRECTION05): adds one more
// required operator-supplied flag (--user-data-dir) and adds one
// more pre-launch invariant (ensurePristineUserDataDir) so the
// launched editor is provably a distinct VSCodium instance (not
// a secondary CLI invocation forwarded to an already-running
// VSCodium main process). Per upstream VS Code docs, --user-data-dir
// is the supported mechanism for opening a distinct instance and
// isolating environment variables. No production code, no
// extension.ts change, no runtime protocol change, no webview
// change, no workspace setting, no signal handlers, no lifecycle
// semantics change. Only cmd/clinemm-live-capture/ + tests + ACT
// evidence.
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

// Exit codes per ACT §8 (v4 = CORRECTION03).
const (
	exitOK              = 0
	exitNoHost          = 2
	exitObserverMissing = 3
	// exitAmbiguous REMOVED in v3 (CORRECTION02). The strict-
	// ambiguous exit was the wrong stop condition because
	// real VSCodium 1.126 launches always spawn 2-3
	// extension-host-shaped processes. Chronology-as-identity
	// was the wrong fix. Now we use VSCodium's own session log
	// for authoritative identity binding; failure to do so is
	// exitIdentityUnobservable.
	exitLaunchFailed         = 5
	exitObserverFailed       = 6
	exitIdentityUnobservable = 7
	// v5 CORRECTION04: exitLogSessionAmbiguous (8) is REMOVED.
	// The v4 launch->session binding layer
	// (`sessionsNow - sessionsBefore`) was internally
	// inconsistent with the very main.js evidence v4 cited:
	// explicit --logsPath bypasses the <session>/ subdirectory
	// synthesis, so v4's enumeration logic was dead code on
	// the explicit-logsPath path it was supposed to fix. v5
	// simplifies to "logsPath is the causal namespace; it must
	// be pristine before launch", eliminating the need for a
	// separate session-ambiguity stop condition entirely.
)

// Tunables; the spec pins these.
const (
	defaultDiscoverTimeout = 20 * time.Second
	defaultCadence         = 400 * time.Millisecond
	defaultDuration        = 60 * time.Second

	envAuthority          = "CLINEMM_DIAG_TERMINATION_AUTHORITY=1"
	envCPUProfileRemove   = "CLINEMM_DIAG_CPU_PROFILE"
	envAllocProfileRemove = "CLINEMM_DIAG_ALLOCATION_PROFILE"

	// envUserDataDirSet is the wrapper contract: the operator's
	// `codium-clinemm` wrapper reads $CLINEMM_USER_DATA_DIR (or
	// falls back to its built-in $DEFAULT_DATA_DIR) and emits
	// `--user-data-dir "$DATA_DIR"` itself. The Go helper must
	// NOT inject `--user-data-dir` directly into argv -- doing
	// so would (a) duplicate the flag the wrapper already emits
	// and (b) bypass the wrapper's forensic launcher override.
	// Instead, we SET this env var on the child so the wrapper
	// sees our desired user-data-dir and emits a single
	// `--user-data-dir` argv of its own. See phases.go startClineMM
	// for the v7 (CORRECTION06) seam description.
	envUserDataDirSet = "CLINEMM_USER_DATA_DIR"

	// v8 CORRECTION07: extensionHostPatternSrc / extensionHostPattern
	// / isExtensionHostCandidate are REMOVED from identity
	// authority. The prior heuristic asserted:
	//     "(Plugin)" => language server, never real Extension Host
	// That empirical rule was falsified LIVE on VSCodium 1.126
	// (see .factory/evidence/ACT-CLINEMM-EXTENSION-HOST-LIVE-CAPTURE-LAUNCHER01/live-process-recon.log):
	// the real ClineMM Extension Host runs as
	//     VSCodium Helper (Plugin).app --type=utility
	//         --utility-sub-type=node.mojom.NodeService
	// while other NodeService / Figma / Notion processes are
	// NOT the authoritative host. The argv shape is descriptive
	// only -- the authoritative PID now comes exclusively from
	// <logsPath>/window1/exthost/exthost.log, and the discovery
	// loop's only invariants are PID novelty (NOT in
	// beforeAllPIDs) + aliveness (kill(pid, 0)).
	//
	// We retain the literal `--type=extensionHost` substring
	// pattern only as a parser sanity check used in tests, not
	// as identity authority. See diagnosticPIDMatchesKnownShapes
	// for the descriptive-only diagnostic.

	// defaultCaptureIDFormat per ACT §6.
	defaultCaptureIDFormat = "20060102-150405"
)

// diagnosticPIDMatchesKnownShapes is a DESCRIPTIVE-ONLY helper.
// It returns true iff the pid's ps line matches one of the two
// argv shapes historically associated with VSCodium / VS Code
// utility processes (the helper deliberately does NOT narrow
// this further). Used only to attach a hint to diagnostics
// output; never used as identity authority.
//
// v8 CORRECTION07: this function is NOT consulted by the
// discovery loop's identity-binding path. The authoritative
// PID is the one named in
// <logsPath>/window1/exthost/exthost.log; novelty + aliveness
// are the only invariants.
func diagnosticPIDMatchesKnownShapes(cmdline string) bool {
	if strings.Contains(cmdline, "--type=extensionHost") {
		return true
	}
	if strings.Contains(cmdline, "--type=utility") &&
		strings.Contains(cmdline, "--utility-sub-type=node.mojom.NodeService") {
		return true
	}
	return false
}

// Config is the parsed operator-supplied contract.
type Config struct {
	Bin     string
	DataDir string
	// UserDataDir is the absolute directory the operator wants
	// VSCodium to use as its `--user-data-dir`. The helper
	// INJECTS `--user-data-dir <UserDataDir>` into the
	// launched editor's argv. In v6 (CORRECTION05) UserDataDir
	// is REQUIRED and MUST be PRISTINE (does not exist OR is
	// empty) so the launched editor is provably a distinct
	// VSCodium instance, not a secondary CLI invocation
	// forwarded to an already-running VSCodium main process.
	//
	// Per upstream VS Code docs (--user-data-dir is the
	// supported mechanism for opening a distinct instance
	// and isolating environment variables from any other
	// running VS Code instance). Without a pristine
	// --user-data-dir, the existing VSCodium main may accept
	// the CLI workspace-open request and reuse its own
	// Extension Host + state, breaking causal binding of the
	// launched editor's extension host to this launch.
	//
	// Note: a pristine user-data-dir means the ClineMM dogfood
	// extension is NOT installed in that isolated instance by
	// default. The operator must point --extensions-dir at the
	// existing dogfood extensions install (or pre-install the
	// ClineMM extension into the pristine user-data-dir). The
	// helper does NOT auto-install the ClineMM dogfood
	// extension into the isolated instance.
	UserDataDir string
	CaptureID   string
	// LogsPath is the absolute directory the operator wants
	// VSCodium to write its session log tree under. The helper
	// INJECTS --logsPath <LogsPath> into the launched editor
	// argv (v4 CORRECTION03 + v5 CORRECTION04). v5 makes the
	// LogsPath ITSELF the causal namespace: the helper
	// requires it to be PRISTINE (does not exist OR is empty)
	// before launch, then reads
	// <LogsPath>/window1/exthost/exthost.log directly. The v4
	// launch->session binding layer (`sessionsNow -
	// sessionsBefore`) was REMOVED because explicit --logsPath
	// bypasses the <session>/ subdirectory synthesis entirely.
	LogsPath string
	Cadence  time.Duration
	Duration time.Duration
	Timeout  time.Duration
	Args     []string
	RepoRoot string
}

// ParseConfig parses flags. Everything after the first `--` is
// collected as Args (ClineMM/VSCodium args).
//
// --logs-path is REQUIRED (v4 CORRECTION03 + v5 CORRECTION04).
// The launcher reads
// <LogsPath>/window1/exthost/exthost.log to resolve the
// authoritative extension-host PID; without it we would have
// no authoritative identity source. The launcher also INJECTS
// `--logsPath <LogsPath>` into the launched editor's argv so
// the editor's logsHome is the same LogsPath (verified in
// VSCodium 1.126 main.js: `if(!this.args.logsPath){...}
// return D.file(this.args.logsPath)`). v5 requires LogsPath to
// be PRISTINE before launch (does not exist OR is empty), so
// any file that later appears under it MUST be from this
// launch.
//
// IMPORTANT (upstream argv semantics, reviewer-corrected):
// `--log` is the upstream VS Code CLI option for log LEVEL
// (string[] of "component:level" entries), not for the log
// DIRECTORY. The actual log-directory option is `logsPath`
// (singular `logsPath`, type string). VSCodium 1.126 inherits
// this upstream definition. We expose the directory option as
// `--logs-path` (hyphenated) on our helper to disambiguate
// from upstream's `--log` and to make the injection site
// obvious.
func ParseConfig(argv []string) (*Config, error) {
	cfg := &Config{
		Cadence:  defaultCadence,
		Duration: defaultDuration,
		Timeout:  defaultDiscoverTimeout,
	}

	fs := flag.NewFlagSet("clinemm-live-capture", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	bin := fs.String("bin", "", "absolute path to the ClineMM/VSCodium binary (required)")
	dataDir := fs.String("data-dir", os.Getenv("CLINE_DATA_DIR"), "CLINE_DATA_DIR override")
	userDataDir := fs.String("user-data-dir", "", "absolute path to a PRISTINE directory for VSCodium's user-data-dir (REQUIRED; v6 CORRECTION05 instance-isolation contract preserved; v7 CORRECTION06 sets CLINEMM_USER_DATA_DIR on the child environment and the codium-clinemm wrapper emits --user-data-dir itself -- must NOT be empty OR contain files from a previous launch -- ensures the launched editor is a distinct instance, not a secondary CLI invocation forwarded to an already-running VSCodium main process)")
	captureID := fs.String("capture-id", "", "optional capture id override (default: live-YYYYMMDD-HHMMSS)")
	logsPath := fs.String("logs-path", "", "absolute path to a PRISTINE directory where VSCodium should write its session logs (REQUIRED; injected into the launched editor as --logsPath)")
	cadence := fs.Duration("cadence", defaultCadence, "observer polling cadence")
	duration := fs.Duration("duration", defaultDuration, "observation window length")
	timeout := fs.Duration("timeout", defaultDiscoverTimeout, "extension-host PID discovery timeout")

	if err := fs.Parse(argv); err != nil {
		return nil, err
	}

	if *bin == "" {
		return nil, errors.New("--bin is required")
	}
	if *dataDir == "" {
		return nil, errors.New("--data-dir (or CLINE_DATA_DIR) is required")
	}
	if *userDataDir == "" {
		return nil, errors.New("--user-data-dir <dir> is required (v6 CORRECTION05: VS Code / VSCodium is intentionally single-instance by default; without a pristine --user-data-dir the CLI invocation may forward to an already-running main process, which would inherit that instance's environment and extension state -- breaking causal binding of the launched editor's extension host to THIS launch)")
	}
	if *logsPath == "" {
		return nil, errors.New("--logs-path <dir> is required (v5 CORRECTION04: authoritative extension-host PID is resolved from <logs-path>/window1/exthost/exthost.log; the helper also injects --logsPath <dir> into the launched editor argv so the session log is causally bound to THIS launch)")
	}
	if *cadence <= 0 || *duration <= 0 || *timeout <= 0 {
		return nil, errors.New("--cadence, --duration, --timeout must all be > 0")
	}

	cfg.Bin = *bin
	cfg.DataDir = *dataDir
	cfg.UserDataDir = *userDataDir
	cfg.CaptureID = *captureID
	cfg.LogsPath = *logsPath
	cfg.Cadence = *cadence
	cfg.Duration = *duration
	cfg.Timeout = *timeout
	cfg.Args = fs.Args()

	repoRoot, err := discoverRepoRoot()
	if err != nil {
		return nil, fmt.Errorf("could not locate repo root: %w", err)
	}
	cfg.RepoRoot = repoRoot
	return cfg, nil
}

// Sentinel errors for errors.Is dispatch in main.
var (
	errNoNewHost = errors.New("no new extension host observed")
	// errIdentityUnobservable is the v3 stop condition. It is
	// triggered when waitForNewExtensionHost cannot resolve
	// the authoritative extension-host PID from
	// <logsPath>/window1/exthost/exthost.log (--logs-path
	// missing, exthost.log missing/unparseable after the
	// timeout, or the authoritative PID did not intersect
	// the candidate set exactly once). Translated to exit 7.
	//
	// v6 CORRECTION05: the historical wording here referenced
	// "no new session subdir created by THIS launch". That
	// wording is v4 residue; v5 (CORRECTION04) removed the
	// launch->session binding layer entirely (explicit
	// --logsPath bypasses the <session>/ subdirectory
	// synthesis). The remaining failure modes are file-level
	// only: file missing, file unparseable, authoritative
	// PID not in the candidate set.
	errIdentityUnobservable = errors.New("HALT_EXTENSION_HOST_IDENTITY_UNOBSERVABLE")
	// v5 CORRECTION04: errLogSessionAmbiguous (exit 8) is
	// REMOVED. The launch->session binding layer
	// (`sessionsNow - sessionsBefore`) was internally
	// inconsistent with the very main.js evidence v4 cited:
	// explicit --logsPath bypasses the <session>/ subdirectory
	// synthesis, so the layer was dead code on the explicit
	// path it was supposed to fix. v5 simplifies to "logsPath
	// is the causal namespace; it must be pristine before
	// launch", eliminating the need for a separate
	// session-ambiguity stop condition entirely.

	// errLogPathNotPristine (v5 CORRECTION04) is the new
	// pre-launch stop condition. The helper refuses to launch
	// if --logs-path is either empty OR points at a directory
	// that already contains files (since we could not prove
	// that any file appearing under it later came from our
	// launch). Translated to exit 7.
	errLogPathNotPristine = errors.New("HALT_EXTENSION_HOST_LOG_PATH_NOT_PRISTINE")

	// errUserDataDirNotPristine (v6 CORRECTION05) is the
	// pre-launch stop condition that prevents instance-reuse
	// risk. VS Code / VSCodium is intentionally single-instance
	// by default: a secondary CLI invocation tries to
	// communicate with an existing main process and inherits
	// its environment + extension state. Without a pristine
	// --user-data-dir, we cannot prove the launched editor is
	// a distinct instance; the existing VSCodium main may
	// accept the CLI workspace-open request and reuse its own
	// Extension Host + state, breaking causal binding of the
	// launched editor's extension host to THIS launch.
	//
	// Note: a pristine user-data-dir means the ClineMM dogfood
	// extension is NOT installed in that isolated instance by
	// default. This is a CONFIGURATION concern, not a HELPER
	// concern -- the helper halts informatively and tells the
	// operator to point --extensions-dir at the existing dogfood
	// extensions install (or pre-install the ClineMM extension
	// into the pristine user-data-dir).
	errUserDataDirNotPristine = errors.New("HALT_EXTENSION_HOST_USER_DATA_DIR_NOT_PRISTINE")

	// errAuthoritativePIDNotNew (v8 CORRECTION07) is the
	// post-launch stop condition that enforces the novelty
	// invariant. The authoritative PID parsed from
	// <logsPath>/window1/exthost/exthost.log was already
	// present in the BEFORE-LAUNCH snapshot, so we cannot
	// prove the launched editor's extension host is this
	// PID -- it may be a stale process left over from a
	// prior session (the launched editor might have failed
	// to start, or its PID might have collided with a stale
	// one). We HALT rather than substitute another PID.
	//
	// Translated to exit 7 alongside errIdentityUnobservable
	// (same severity class: identity cannot be bound from the
	// evidence on this host).
	errAuthoritativePIDNotNew = errors.New("HALT_EXTENSION_HOST_AUTHORITATIVE_PID_NOT_NEW")
)

func init() {
	// v8 CORRECTION07: init() previously compiled
	// extensionHostPattern via regexp.MustCompile. The
	// pattern is REMOVED from identity authority; only
	// diagnosticPIDMatchesKnownShapes remains and that uses
	// plain strings.Contains -- no regexp state needed.
}

func main() {
	cfg, err := ParseConfig(os.Args[1:])
	if err != nil {
		fmt.Fprintf(os.Stderr, "clinemm-live-capture: %v\n", err)
		fmt.Fprintln(os.Stderr, "usage: clinemm-live-capture --bin <path> --data-dir <path> --user-data-dir <dir> --logs-path <dir> [--capture-id <id>] [--cadence 400ms] [--duration 60s] [--timeout 20s] -- <codium-args...>")
		os.Exit(exitObserverMissing)
	}

	captureID := cfg.CaptureID
	if captureID == "" {
		captureID = "live-" + time.Now().Format(defaultCaptureIDFormat)
	}

	// Phase A1. snapshot of existing extension-host PIDs.
	before, err := extensionHostPIDs()
	if err != nil {
		fmt.Fprintf(os.Stderr, "snapshot failed: %v\n", err)
		os.Exit(exitLaunchFailed)
	}

	// Phase A2. (v6 CORRECTION05) ensure --user-data-dir is
	// PRISTINE. VS Code / VSCodium is intentionally
	// single-instance by default; a secondary CLI invocation
	// forwards the workspace-open request to an existing main
	// process and inherits that instance's environment + state.
	// For the launched editor to be provably a DISTINCT
	// instance (and for the authoritative extension-host PID
	// from <logsPath>/window1/exthost/exthost.log to be
	// causally bound to THIS launch), --user-data-dir MUST be
	// either non-existent (we create it) or already-empty (no
	// files from a previous launch). ensurePristineUserDataDir
	// handles both cases; failure means we HALT before
	// launching.
	if err := ensurePristineUserDataDir(cfg.UserDataDir); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(exitIdentityUnobservable)
	}

	// Phase A3. (v5 CORRECTION04) ensure --logs-path is PRISTINE.
	// The operator-supplied logsPath itself is the causal
	// namespace in v5 (v4's <session>/ subdirectory layer was
	// removed because explicit --logsPath bypasses it). For
	// <logsPath>/window1/exthost/exthost.log to be causally
	// attributable to THIS launch, logsPath MUST be either
	// non-existent (we create it) or already-empty (no files
	// from a stale session). ensurePristineLogsPath handles
	// both cases; failure means we HALT before launching.
	if err := ensurePristineLogsPath(cfg.LogsPath); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(exitIdentityUnobservable)
	}

	// Phase B. launch (v4 / v5 unchanged at this layer: --logsPath
	// is INJECTED into the launched editor's argv so the
	// editor's logsHome is the same logsPath; the editor
	// writes window1/exthost/exthost.log directly under it).
	child, err := startClineMM(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "launch failed: %v\n", err)
		os.Exit(exitLaunchFailed)
	}
	releaseChildOnExit(child)

	// Phase C. discover (v5: authoritative PID binding via the
	// pristine logsPath; no session enumeration. v8
	// CORRECTION07: novelty/aliveness invariants; no argv-shape
	// filtering).
	pid, err := waitForNewExtensionHost(before, cfg.Timeout, cfg.LogsPath)
	if err != nil {
		switch {
		case errors.Is(err, errNoNewHost):
			fmt.Fprintln(os.Stderr, "no new extension-host PID appeared before timeout")
			os.Exit(exitNoHost)
		case errors.Is(err, errIdentityUnobservable):
			fmt.Fprintf(os.Stderr, "extension-host identity unobservable: %v\n", err)
			os.Exit(exitIdentityUnobservable)
		case errors.Is(err, errAuthoritativePIDNotNew):
			// v8 CORRECTION07: same severity class as
			// errIdentityUnobservable (identity cannot be
			// bound from the evidence on this host).
			fmt.Fprintf(os.Stderr, "extension-host authoritative PID not new: %v\n", err)
			os.Exit(exitIdentityUnobservable)
		default:
			fmt.Fprintf(os.Stderr, "discovery failed: %v\n", err)
			os.Exit(exitLaunchFailed)
		}
	}

	fmt.Printf("EXTENSION_HOST pid=%d\n", pid)

	// Phase D. validate
	if err := validateExtensionHostPID(pid); err != nil {
		fmt.Fprintf(os.Stderr, "validation failed for pid=%d: %v\n", pid, err)
		os.Exit(exitNoHost)
	}

	// Phase E. handoff
	captureDir := captureDirectory(cfg.DataDir, captureID)
	fmt.Printf("CAPTURE_ID=%s\nCAPTURE_DIR=%s\n", captureID, captureDir)

	code := runObserver(cfg, captureID, pid)
	fmt.Printf("OBSERVER_EXIT=%d\n", code)
	os.Exit(code)
}
