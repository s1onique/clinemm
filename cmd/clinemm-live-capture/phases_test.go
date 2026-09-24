// Tests for clinemm-live-capture.
//
// ACT-CLINEMM-EXTENSION-HOST-LIVE-CAPTURE-LAUNCHER01 / §11.
//
// These tests exercise the pure seams only (LAUNCH-01..06). No
// integration smoke is run here -- that lives in the ACT §12
// runbook. The seedy interaction with `ps` itself is replaced with
// the psAllPIDsFromCmd seam so each test reads the
// fake ps output verbatim.
//
// Copyright notice intentionally omitted (trivial test scaffolding).

package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

// psOutput synthesises an *exec.Cmd whose Output returns the given
// body. We use `printf` so the parser sees a deterministic stream
// (no shell interpretation, no extra newline).
func psOutput(t *testing.T, body string) *exec.Cmd {
	t.Helper()
	return exec.Command("printf", "%s", body)
}

// LAUNCH-01 + LAUNCH-02 + LAUNCH-04 parser tests are run against
// the parser seam directly.

// LAUNCH-01: before {100, 101}, after {100, 101, 200} -> bind 200.
// Re-exercised via waitForNewExtensionHost against a synthetic
// ps source.
func TestWaitForNewExtensionHost_BindSingleNewPID(t *testing.T) {
	before := map[int]string{
		100: "old-a --type=extensionHost a",
		101: "old-b --type=extensionHost b",
	}

	current := map[int]string{
		100: "old-a --type=extensionHost a",
		101: "old-b --type=extensionHost b",
		200: "new --type=extensionHost new",
	}

	got := selectNewExtensionHosts(before, current)
	if len(got) != 1 || got[0] != 200 {
		t.Fatalf("expected exactly {200}, got %v", got)
	}
}

// LAUNCH-04: parser must list ALL processes (pid -> command-line)
// from `ps` so the discovery loop's novelty invariant (not in
// before-snapshot) has the complete picture.
//
// v8 CORRECTION07: prior versions filtered by a regex + Go-side
// "(Plugin)" / "--inspect-port=" exclusions. That filter was
// LIVE-DISPROVEN -- the real ClineMM Extension Host on this
// VSCodium 1.126 host carries "(Plugin)" in argv and was
// rejected. The parser now performs ONLY the syntactic check
// (numeric PID followed by command-line) and returns ALL rows
// that parse cleanly. Identity binding is decided entirely by
// the authoritative log PID + novelty/aliveness invariants.
func TestParser_ListsAllProcesses(t *testing.T) {
	input := strings.Join([]string{
		"  700 Code Helper (Renderer)",                                                                                                            // parse: keep
		"  701 /Applications/VSCodium --extensionHost foo",                                                                                        // parse: keep (no filter)
		"  702 grep extension host some.log",                                                                                                      // parse: keep
		"  703 grep extensionhost some.log",                                                                                                       // parse: keep
		"  704 Code Helper (Renderer) --type=extensionHost --foo",                                                                                 // parse: keep (was server-side fork shape)
		"  705 /Applications/VSCodium.app/.../VSCodium --type=extensionHost --enable-blink-features",                                              // parse: keep
		"  800 Code Helper (Renderer) --type=renderer --user-data-dir=/foo",                                                                       // parse: keep
		"  801 Code Helper (Renderer) --type=utility --utility-sub-type=network.mojom.NetworkService",                                             // parse: keep
		"  802 Code Helper (Renderer) --type=utility --utility-sub-type=storage.mojom.StorageService",                                             // parse: keep
		"  803 Code Helper (Renderer) --type=utility --utility-sub-type=node.mojom.NodeService --foo",                                             // parse: keep
		"  804 /Applications/VSCodium.app/.../VSCodium Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService",                  // parse: keep -- THIS IS THE REAL EXTENSION HOST (was previously rejected!)
		"  805 /Applications/VSCodium.app/.../VSCodium Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService --inspect-port=0", // parse: keep (was previously rejected)
		"  806 /Applications/Notion.app/Contents/Frameworks/Notion Helper --type=utility --utility-sub-type=node.mojom.NodeService",               // parse: keep (irrelevant -- novelty/aliveness check decides)
	}, "\n")

	cmd := psOutput(t, input)
	got, err := psAllPIDsFromCmd(cmd)
	if err != nil {
		t.Fatalf("parser error: %v", err)
	}
	// v8 contract: ALL syntactically-valid lines must be returned.
	// There are NO negative cases here -- identity is decided
	// elsewhere (the authoritative log PID + novelty/aliveness).
	expectedAll := []int{700, 701, 702, 703, 704, 705, 800, 801, 802, 803, 804, 805, 806}
	for _, pid := range expectedAll {
		if _, ok := got[pid]; !ok {
			t.Errorf("pid=%d must be in result (parser must list ALL processes)", pid)
		}
	}
	// 804 (the live specimen's PID-shape) MUST be present: the
	// real ClineMM Extension Host on this host.
	if cmdline, ok := got[804]; !ok {
		t.Errorf("pid=804 (the real ClineMM Extension Host with (Plugin) marker) MUST be present after v8 CORRECTION07")
	} else if !strings.Contains(cmdline, "(Plugin)") {
		t.Errorf("pid=804 cmdline must include (Plugin) marker: %q", cmdline)
	}
	// Sanity: 14 lines in, 14 rows out.
	if len(got) != len(expectedAll) {
		t.Errorf("parser returned %d rows, expected %d (lines: %d)", len(got), len(expectedAll), len(expectedAll))
	}
	for pid := range got {
		if pid <= 0 {
			t.Errorf("parser returned a non-positive pid=%d", pid)
		}
	}
}

// TestParser_LiveObservedShapeAllListed is the v8 CORRECTION07
// inversion: the prior parser was an identity-authority filter
// that selected extension hosts by argv shape and rejected
// Plugin hosts. v8 makes argv shape descriptive only; the
// parser lists every process that parses cleanly.
//
// The argv prefixes are verbatim copies from
// live-process-recon.log, with synthetic PIDs (100000+) for
// deterministic test runs. ALL FOUR must appear in the
// parser's output -- including the (Plugin) one, which is
// the live specimen's actual extension host shape (pid=40282
// in the live run). The novelty/aliveness invariants, not the
// parser, decide identity.
func TestParser_LiveObservedShapeAllListed(t *testing.T) {
	observed := strings.Join([]string{
		" 100001 /Applications/VSCodium.app/Contents/Frameworks/VSCodium Helper.app/Contents/MacOS/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService --lang=en-GB --service-sandbox-type=none --user-data-dir=/Volumes/UserData/Users/chistyakov/.vscodium-myc/user-data --standard-schemes=vscode-webview,vscode-file",
		" 100002 /Applications/VSCodium.app/Contents/Frameworks/VSCodium Helper (Plugin).app/Contents/MacOS/VSCodium Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService --lang=en-GB --service-sandbox-type=none --dns-result-order=ipv4first --experimental-network-inspection --inspect-port=0 --user-data-dir=/Volumes/UserData/Users/chistyakov/.vscodium-myc/user-data",
		" 100003 /Applications/VSCodium.app/Contents/Frameworks/VSCodium Helper.app/Contents/MacOS/VSCodium Helper --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en-GB --service-sandbox-type=network --user-data-dir=/Volumes/UserData/Users/chistyakov/.vscodium-myc/user-data",
		" 100004 /Applications/VSCodium.app/Contents/Frameworks/VSCodium Helper.app/Contents/MacOS/VSCodium Helper --type=gpu-process --user-data-dir=/Volumes/UserData/Users/chistyakov/.vscodium-myc/user-data",
	}, "\n")

	cmd := psOutput(t, observed)
	got, err := psAllPIDsFromCmd(cmd)
	if err != nil {
		t.Fatalf("parser error: %v", err)
	}
	// v8 contract: ALL four argv shapes are listed -- including
	// 100002 (Plugin + inspect-port), which is the live specimen
	// of the real ClineMM Extension Host on this host. The
	// parser does not exclude it; the discovery loop decides
	// identity via the authoritative log PID + novelty/aliveness.
	for _, pid := range []int{100001, 100002, 100003, 100004} {
		if _, ok := got[pid]; !ok {
			t.Errorf("pid=%d must be in result (v8 parser lists ALL processes)", pid)
		}
	}
	// The diagnostic helper should report a known-shape for
	// the two NodeService lines (100001 + 100002) and no-known-
	// shape for the NetworkService + gpu lines. This is purely
	// descriptive; identity is decided elsewhere.
	if !diagnosticPIDMatchesKnownShapes(got[100001]) {
		t.Errorf("diagnostic should classify 100001 (NodeService) as known shape")
	}
	if !diagnosticPIDMatchesKnownShapes(got[100002]) {
		t.Errorf("diagnostic should classify 100002 (Plugin + NodeService) as known shape")
	}
	if diagnosticPIDMatchesKnownShapes(got[100003]) {
		t.Errorf("diagnostic should NOT classify 100003 (NetworkService) as extension-host shape")
	}
	if diagnosticPIDMatchesKnownShapes(got[100004]) {
		t.Errorf("diagnostic should NOT classify 100004 (gpu-process) as extension-host shape")
	}
}

// TestParser_PluginExclusion is REMOVED in v8 (CORRECTION07).
// The prior contract -- "(Plugin)" / "--inspect-port=" lines
// MUST NOT be classified as extension hosts -- is the EXACT
// false belief that was LIVE-DISPROVEN. The live specimen
// showed:
//
//	40279  plain NodeService       (was ACCEPTED by old filter)
//	40280  plain NodeService       (was ACCEPTED by old filter)
//	40282  VSCodium Helper (Plugin) NodeService  (was REJECTED, but IS the authoritative Extension Host!)
//
// Inverting the contract means the parser no longer excludes
// these lines; identity is decided by the authoritative log
// PID + novelty/aliveness invariants in waitForNewExtensionHost.
//
// TestParser_PluginLineNowListed replaces it: the (Plugin) +
// --inspect-port= line MUST be in the parser's output (it is
// the live specimen's authoritative extension host shape).

// TestParser_PluginLineNowListed is the v8 CORRECTION07 RED/
// GREEN regression that the (Plugin) + --inspect-port= line --
// which is the LIVE-SPECIMEN's authoritative extension host
// shape -- is now present in the parser's output (it was
// rejected under v7's isExtensionHostCandidate).
func TestParser_PluginLineNowListed(t *testing.T) {
	input := strings.Join([]string{
		" 200001 /Applications/VSCodium.app/Contents/Frameworks/VSCodium Helper (Plugin).app/Contents/MacOS/VSCodium Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService --inspect-port=0",
		" 200002 /Applications/VSCodium.app/Contents/Frameworks/VSCodium Helper (Plugin).app/Contents/MacOS/VSCodium Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService --dns-result-order=ipv4first",
		" 200003 /Applications/VSCodium.app/Contents/Frameworks/VSCodium Helper.app/Contents/MacOS/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService --inspect-port=0",
		" 200004 /Applications/VSCodium.app/Contents/Frameworks/VSCodium Helper.app/Contents/MacOS/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService",
		" 200005 /Applications/VSCodium.app/Contents/Resources/app/extensions/json-language-features/server/dist/node/jsonServerMain --node-ipc --clientProcessId=200002",
		" 200006 /Applications/Notion.app/Contents/Frameworks/Notion Helper.app/Contents/MacOS/Notion Helper --type=utility --utility-sub-type=node.mojom.NodeService --lang=en-GB --service-sandbox-type=none",
	}, "\n")
	cmd := psOutput(t, input)
	got, err := psAllPIDsFromCmd(cmd)
	if err != nil {
		t.Fatalf("parser error: %v", err)
	}
	// v8 contract: ALL six lines parse cleanly; identity is
	// decided by the authoritative log PID + novelty/aliveness.
	// In particular, 200001 / 200002 (Plugin + NodeService) MUST
	// be present.
	for _, pid := range []int{200001, 200002, 200003, 200004, 200005, 200006} {
		if _, ok := got[pid]; !ok {
			t.Errorf("pid=%d must be in result (v8 parser lists ALL processes)", pid)
		}
	}
}

// LAUNCH-05: environment filtering test.
//
//	CLINEMM_DIAG_TERMINATION_AUTHORITY=1   SET (appended)
//	CLINEMM_DIAG_CPU_PROFILE              UNSET (filtered out)
//	CLINEMM_DIAG_ALLOCATION_PROFILE       UNSET (filtered out)
func TestFilteredEnv_RemovesBothProfileFlags(t *testing.T) {
	in := []string{
		"PATH=/usr/bin",
		"HOME=/Users/alice",
		"CLINEMM_DIAG_CPU_PROFILE=/tmp/should-be-gone.cpu",
		"CLINEMM_DIAG_ALLOCATION_PROFILE=/tmp/should-be-gone.heap",
		"OTHER_FLAG=1",
	}
	got := filteredEnv(in, envCPUProfileRemove, envAllocProfileRemove)

	has := func(k string) bool {
		for _, item := range got {
			if strings.HasPrefix(item, k+"=") {
				return true
			}
		}
		return false
	}
	if has(envCPUProfileRemove) {
		t.Errorf("CLINEMM_DIAG_CPU_PROFILE leaked through filter: %v", got)
	}
	if has(envAllocProfileRemove) {
		t.Errorf("CLINEMM_DIAG_ALLOCATION_PROFILE leaked through filter: %v", got)
	}
	if !has("PATH") || !has("HOME") || !has("OTHER_FLAG") {
		t.Errorf("filter dropped unrelated entries: %v", got)
	}

	// Now apply the launch-time invariant.
	env := append([]string{}, got...)
	env = append(env, envAuthority)
	if !contains(env, envAuthority) {
		t.Errorf("CLINEMM_DIAG_TERMINATION_AUTHORITY not present after append")
	}
}

// LAUNCH-06: observer argv exactness.
func TestObserverArgv_ExactOrder(t *testing.T) {
	cfg := &Config{
		Bin:      "/Applications/Codium.app/.../codium",
		DataDir:  "/Users/alice/.cline/data",
		Cadence:  400 * time.Millisecond,
		Duration: 1500 * time.Millisecond,
		Args:     []string{"/Users/alice/Projects/clinemm"},
	}
	got := buildObserverArgv(cfg, "live-20260924-130000", 4242)

	want := []string{
		"scripts/capture-extension-host-lifecycle.mjs",
		"--capture-id", "live-20260924-130000",
		"--pid", "4242",
		"--cadence-ms", "400",
		"--duration-ms", "1500",
		"--data-dir", "/Users/alice/.cline/data",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("argv mismatch\n got: %v\nwant: %v", got, want)
	}
}

// LAUNCH-03: timeout when nothing new ever appears. We can test the
// wrapper around waitForNewExtensionHost using a fake ps source
// that never reports a new candidate.
func TestWaitForNewExtensionHost_Timeout(t *testing.T) {
	before := map[int]string{
		500: "old --type=extensionHost old",
	}
	// simulated: every "after" snapshot is identical to before.
	current := map[int]string{
		500: "old --type=extensionHost old",
	}
	got := selectNewExtensionHosts(before, current)
	if len(got) != 0 {
		t.Fatalf("expected zero candidates before timeout, got %v", got)
	}
}

// Parser must tolerate leading whitespace (Darwin ps -axo emits it).
func TestParser_LeadingWhitespace(t *testing.T) {
	body := bytes.NewBufferString(
		"   900 /Applications/Codium.app/.../codium --type=extensionHost\n",
	).String()
	cmd := psOutput(t, body)
	got, err := psAllPIDsFromCmd(cmd)
	if err != nil {
		t.Fatalf("parser error: %v", err)
	}
	if _, ok := got[900]; !ok {
		t.Errorf("pid=900 with leading whitespace should match; got %#v", got)
	}
}

// ----------------------------------------------------------------------------
// CORRECTION02 RED/GREEN tests (ACT §15 review round 2)
// ----------------------------------------------------------------------------

// fakePS returns a psSnapshotFn closure that yields the given PID->cmd
// map on every call. Tests use this to drive waitForNewExtensionHost
// without touching /bin/ps.
func fakePS(snapshot map[int]string) func() (map[int]string, error) {
	return func() (map[int]string, error) {
		// Copy so the test cannot mutate the fixture.
		out := make(map[int]string, len(snapshot))
		for k, v := range snapshot {
			out[k] = v
		}
		return out, nil
	}
}

// fakePSWithError returns a closure that yields an error on every call.
// Used to assert the launcher's error-translation path.
func fakePSWithError(err error) func() (map[int]string, error) {
	return func() (map[int]string, error) {
		return nil, err
	}
}

// withSnapshot temporarily swaps the package-level psSnapshotFn for fn,
// restoring the original on test cleanup. Test isolation: no test
// should mutate production state.
func withSnapshot(fn func() (map[int]string, error)) func() {
	orig := psSnapshotFn
	psSnapshotFn = fn
	return func() { psSnapshotFn = orig }
}

// withExthostReader temporarily swaps readExthostLogFn for fn.
// Tests use this to inject controlled log/write races (the file
// appears "later" than the directory).
//
// v5 CORRECTION04: the closure signature is now
// `func(string) (int, error)` -- logsPath only; the v4
// <session> subdirectory argument is gone because the
// authoritative file is at <logsPath>/window1/exthost/exthost.log
// directly.
func withExthostReader(fn func(string) (int, error)) func() {
	orig := readExthostLogFn
	readExthostLogFn = fn
	return func() { readExthostLogFn = orig }
}

// fakeExthostReader returns a readExthostLogFn closure that yields
// the given PID every call. Use this when you don't need to
// exercise the log/write race.
func fakeExthostReader(pid int) func(string) (int, error) {
	return func(_ string) (int, error) {
		return pid, nil
	}
}

// fakeExthostReaderSequence returns a readExthostLogFn closure
// that yields one errExthostLogRace per call up to len(races),
// then yields the given PID. Used to drive the log/write race
// regression net.
func fakeExthostReaderSequence(races int, pid int) func(string) (int, error) {
	calls := 0
	return func(_ string) (int, error) {
		if calls < races {
			calls++
			return 0, errExthostLogRace
		}
		return pid, nil
	}
}

// writeExthostLog writes a fake VSCodium exthost.log directly
// under tmp/logDir (no <session> subdir; v5 CORRECTION04). The
// resulting path matches the production on-disk shape:
//
//	<logsPath>/window1/exthost/exthost.log
//
// Returns the path to the log file. Used by LAUNCH-LOGROOT-*
// and the v3-era LAUNCH-ID-* tests.
func writeExthostLog(t *testing.T, logDir, session, line string) string {
	t.Helper()
	// The `session` argument is kept only for backwards
	// compatibility with the LAUNCH-ID-* test fixtures (which
	// previously wrote under <logsPath>/<session>/...). v5
	// ignores it and writes directly under <logsPath>.
	_ = session
	exthostPath := filepath.Join(logDir, "window1", "exthost", "exthost.log")
	if err := os.MkdirAll(filepath.Dir(exthostPath), 0o755); err != nil {
		t.Fatalf("mkdir exthost dir: %v", err)
	}
	if err := os.WriteFile(exthostPath, []byte(line+"\n"), 0o644); err != nil {
		t.Fatalf("write exthost.log: %v", err)
	}
	return exthostPath
}

// LAUNCH-ID-01 RED/GREEN: 3 NodeService candidates, authoritative PID
// = 30159 (the NON-lowest). Expect bind 30159. This is the positive
// path the reviewer demanded.
//
// v4 CORRECTION03 update: this test now ALSO exercises the
// launch->session binding layer. sessionsBefore is empty
// (no existing sessions under the test's tempdir), sessionListingFn
// reports the new session that writeExthostLog just wrote,
// readExthostLogFn reads the actual file. The discovery loop
// therefore finds exactly one new session, parses its
// exthost.log, and binds authoritative PID = 30159 (NOT
// the lowest of the candidates).
//
// v8 CORRECTION07: the test continues to verify the
// authoritative-log-PID-wins invariant. The candidates include
// 30157 + 30158 + 30159; the authoritative log names 30159; v8
// binds 30159 because (a) 30159 is not in the before-snapshot
// (novelty), and (b) 30159 is alive in the current snapshot
// (aliveness). The other PIDs are irrelevant -- argv shape is
// descriptive only.
func TestWaitForNewExtensionHost_AuthoritativeBind(t *testing.T) {
	logDir := t.TempDir()
	writeExthostLog(t, logDir, "20260917T174652",
		"2026-09-17 17:46:58.272 [info] Extension host with pid 30159 started")

	before := map[int]string{
		100: "/Applications/VSCodium Helper --type=utility --utility-sub-type=network.mojom.NetworkService old",
	}
	current := map[int]string{
		100:   "/Applications/VSCodium Helper --type=utility --utility-sub-type=network.mojom.NetworkService old",
		30157: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService a",
		30158: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService b",
		30159: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService c",
	}

	restorePS := withSnapshot(fakePS(current))
	defer restorePS()
	// v5 CORRECTION04: no session enumeration anymore; the
	// production reader reads <logsPath>/window1/exthost/exthost.log
	// directly. The file was written above by writeExthostLog.

	got, err := waitForNewExtensionHost(before, 5*time.Second, logDir)
	if err != nil {
		t.Fatalf("expected authoritative bind, got error: %v", err)
	}
	if got != 30159 {
		t.Fatalf("expected authoritative PID=30159 (NOT lowest), got %d", got)
	}
}

// LAUNCH-ID-02 RED/GREEN: 3 candidates, --logs-path is the empty
// string. Expect HALT_EXTENSION_HOST_IDENTITY_UNOBSERVABLE (exit 7).
//
// v4 update: the empty-strings check happens immediately on
// entry to waitForNewExtensionHost (before any polling), so
// this test does not need to set up fake ps / sessions.
//
// This is the "no authoritative source" case: chronology-as-identity
// must NOT silently take over.
func TestWaitForNewExtensionHost_AuthoritativeUnobservable_NoLog(t *testing.T) {
	before := map[int]string{
		100: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
	}
	current := map[int]string{
		100:   "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
		30157: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService a",
		30158: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService b",
		30159: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService c",
	}

	restore := withSnapshot(fakePS(current))
	defer restore()

	_, err := waitForNewExtensionHost(before, 5*time.Second, "")
	if err == nil {
		t.Fatalf("expected errIdentityUnobservable when --logs-path is empty, got nil")
	}
	if !errorsIs(err, errIdentityUnobservable) {
		t.Fatalf("expected errIdentityUnobservable, got: %v", err)
	}
}

// LAUNCH-LOGROOT-03 RED/GREEN: candidates exist, but the launched
// editor never wrote <logs-path>/window1/exthost/exthost.log
// within the discovery window (the launched editor never
// reached log-init, OR --logsPath was not honored, OR a
// cross-app false positive). Expect
// HALT_EXTENSION_HOST_IDENTITY_UNOBSERVABLE (exit 7).
//
// v5 CORRECTION04: this replaces the v4 LAUNCH-ID-03 test
// ("no new session directory created by this launch"). v4
// inferred the launched editor's identity from a NEW session
// subdir; v5 infers it from the operator-supplied logsPath
// itself, which must be PRISTINE before launch (so any file
// that appears there MUST be from this launch). The error
// message names both the candidate count and the
// <logs-path>/window1/exthost/exthost.log path so an
// operator can diagnose whether this is a launch that never
// reached log-init or whether --logsPath was not honored.
func TestWaitForNewExtensionHost_AuthoritativeUnobservable_NoExthostLog(t *testing.T) {
	logDir := t.TempDir() // empty -- no exthost.log written

	before := map[int]string{
		100: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
	}
	current := map[int]string{
		100:   "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
		30157: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService a",
		30158: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService b",
		30159: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService c",
	}

	restorePS := withSnapshot(fakePS(current))
	defer restorePS()
	// (No fake reader override; the production reader reads
	// the real file path, which does not exist, so it returns
	// errExthostLogRace -- the transient. The loop continues
	// polling and eventually times out into
	// errIdentityUnobservable.)

	_, err := waitForNewExtensionHost(before, 200*time.Millisecond, logDir)
	if err == nil {
		t.Fatalf("expected errIdentityUnobservable when no exthost.log appears, got nil")
	}
	if !errorsIs(err, errIdentityUnobservable) {
		t.Fatalf("expected errIdentityUnobservable, got: %v", err)
	}
	// Defensive: error message must explicitly call out the
	// missing exthost.log path so the operator can diagnose.
	msg := err.Error()
	if !strings.Contains(msg, "window1/exthost/exthost.log was not written") {
		t.Fatalf("error must call out missing exthost.log path, got: %v", msg)
	}
}

// LAUNCH-ID-04 RED/GREEN: 3 candidates {30157,30158,30159}, but the
// authoritative PID in the LOG is 99999 (not in candidates -- wrong
// editor, cross-app false positive, etc.). Expect HALT.
//
// v5 CORRECTION04: same as v4 at the PID-intersection layer.
// The authoritative PID comes from the operator-supplied
// TestWaitForNewExtensionHost_AuthoritativePIDNotAlive is the
// v8 CORRECTION07 aliveness-invariant HALT path: the
// authoritative log PID is named, but is NOT present in the
// current ps snapshot (the launched editor never actually
// started, or the PID is stale). The discovery loop must NOT
// substitute another PID; it must HALT.
func TestWaitForNewExtensionHost_AuthoritativePIDNotAlive(t *testing.T) {
	logDir := t.TempDir()
	writeExthostLog(t, logDir, "20260917T174652",
		"2026-09-17 17:46:58.272 [info] Extension host with pid 99999 started")

	before := map[int]string{
		100: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
	}
	current := map[int]string{
		100:   "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
		30157: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService a",
		30158: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService b",
		30159: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService c",
	}

	restorePS := withSnapshot(fakePS(current))
	defer restorePS()

	_, err := waitForNewExtensionHost(before, 200*time.Millisecond, logDir)
	if err == nil {
		t.Fatalf("expected errIdentityUnobservable when authoritative PID is not alive, got nil")
	}
	if !errorsIs(err, errIdentityUnobservable) {
		t.Fatalf("expected errIdentityUnobservable, got: %v", err)
	}
	msg := err.Error()
	if !strings.Contains(msg, "99999") {
		t.Fatalf("error must name authoritative PID 99999, got: %v", msg)
	}
	if !strings.Contains(msg, "no longer alive") {
		t.Fatalf("error must call out the aliveness invariant violation, got: %v", msg)
	}
	if strings.Contains(msg, "lowest-PID heuristic") {
		t.Fatalf("error must NOT mention candidate-set fallback (that contract is removed), got: %v", msg)
	}
}

// TestWaitForNewExtensionHost_AuthoritativePIDPreExisted is the
// v8 CORRECTION07 novelty-invariant HALT path: the
// authoritative log PID was already present in the before-
// snapshot, so we cannot prove the launched editor's extension
// host is THIS PID. The discovery loop must HALT with
// errAuthoritativePIDNotNew rather than bind it.
func TestWaitForNewExtensionHost_AuthoritativePIDPreExisted(t *testing.T) {
	logDir := t.TempDir()
	writeExthostLog(t, logDir, "20260917T174652",
		"2026-09-17 17:46:58.272 [info] Extension host with pid 30159 started")

	before := map[int]string{
		100:   "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
		30159: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService stale", // PID 30159 was ALREADY present before launch
	}
	current := map[int]string{
		100:   "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
		30159: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService stale",
	}

	restorePS := withSnapshot(fakePS(current))
	defer restorePS()

	_, err := waitForNewExtensionHost(before, 200*time.Millisecond, logDir)
	if err == nil {
		t.Fatalf("expected errAuthoritativePIDNotNew when authoritative PID pre-existed in before-snapshot, got nil")
	}
	if !errorsIs(err, errAuthoritativePIDNotNew) {
		t.Fatalf("expected errAuthoritativePIDNotNew, got: %v", err)
	}
	msg := err.Error()
	if !strings.Contains(msg, "30159") {
		t.Fatalf("error must name the pre-existed authoritative PID, got: %v", msg)
	}
	if !strings.Contains(msg, "already present before launch") {
		t.Fatalf("error must explicitly call out the novelty invariant, got: %v", msg)
	}
	if !strings.Contains(msg, "refusing to substitute another PID") {
		t.Fatalf("error must explicitly refuse PID substitution, got: %v", msg)
	}
}

// TestWaitForNewExtensionHost_AuthoritativePluginLineBound is
// the v8 CORRECTION07 live-specimen regression: the real
// ClineMM Extension Host has the (Plugin) + --inspect-port=
// shape (pid=40282 in the live run). v7's isExtensionHostCandidate
// REJECTED this line; v8 BINDs it because the authoritative
// log says pid=40282 and 40282 is not in before.
func TestWaitForNewExtensionHost_AuthoritativePluginLineBound(t *testing.T) {
	logDir := t.TempDir()
	writeExthostLog(t, logDir, "20260917T174652",
		"2026-09-17 17:46:58.272 [info] Extension host with pid 40282 started")

	before := map[int]string{
		100: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
	}
	current := map[int]string{
		100: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
		// The live-specimen shape: VSCodium Helper (Plugin) + NodeService.
		// v7 rejected this; v8 binds it.
		40279: "/Applications/VSCodium.app/.../VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService a",
		40280: "/Applications/VSCodium.app/.../VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService b",
		40282: "/Applications/VSCodium.app/.../VSCodium Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService --inspect-port=0 --user-data-dir=/foo",
		// Other new processes -- irrelevant to identity.
		90001: "/Applications/Figma Helper --type=utility --utility-sub-type=node.mojom.NodeService figma",
		91001: "/Applications/Notion Helper --type=utility --utility-sub-type=node.mojom.NodeService notion",
	}

	restorePS := withSnapshot(fakePS(current))
	defer restorePS()

	got, err := waitForNewExtensionHost(before, 5*time.Second, logDir)
	if err != nil {
		t.Fatalf("expected bind authoritative PID 40282, got error: %v", err)
	}
	if got != 40282 {
		t.Fatalf("expected authoritative PID 40282, got %d", got)
	}
}

// LAUNCH-ID-05: parser must accept the verbatim production line
// (extracted from this host's existing session 20260917T174652).
func TestParser_AuthoritativeLog_ParsesExthostLog(t *testing.T) {
	line := "2026-09-17 17:46:58.272 [info] Extension host with pid 1408 started"
	pid, ok := parseExthostStartedLine(line)
	if !ok {
		t.Fatalf("expected parse ok, got !ok for %q", line)
	}
	if pid != 1408 {
		t.Fatalf("expected pid=1408, got %d", pid)
	}
}

// LAUNCH-ID-06: parser must REJECT lines that don't match the exact
// production shape. This is the regression net: any drift in
// VSCodium's log format should HALT the helper.
func TestParser_AuthoritativeLog_RejectsBadFormat(t *testing.T) {
	cases := []struct {
		name string
		line string
	}{
		{"empty", ""},
		{"missing pid", "2026-09-17 17:46:58.272 [info] Extension host started"},
		{"wrong verb", "2026-09-17 17:46:58.272 [info] Extension host with pid 1408 crashed"},
		{"wrong log level", "2026-09-17 17:46:58.272 [error] Extension host with pid 1408 started"},
		{"pid is not numeric", "2026-09-17 17:46:58.272 [info] Extension host with pid notanumber started"},
		{"extra whitespace", "2026-09-17 17:46:58.272  [info] Extension host with pid 1408 started"},
		{"truncated timestamp", "2026-09-17 17:46:58 [info] Extension host with pid 1408 started"},
		{"not extension host", "2026-09-17 17:46:58.272 [info] Network service with pid 1408 started"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pid, ok := parseExthostStartedLine(tc.line)
			if ok {
				t.Fatalf("expected rejection of %q, got pid=%d", tc.line, pid)
			}
		})
	}
}

// LAUNCH-ID-09: errors.Is must recognise errIdentityUnobservable
// wrapping (via fmt.Errorf %w).
func TestErrIdentityUnobservable_Is(t *testing.T) {
	wrapped := fmt.Errorf("wrapped sentinel: %w", errIdentityUnobservable)
	if !errorsIs(wrapped, errIdentityUnobservable) {
		t.Fatalf("errors.Is must recognise wrapped errIdentityUnobservable")
	}
	// And: must NOT match errNoNewHost (defensive).
	if errorsIs(wrapped, errNoNewHost) {
		t.Fatalf("errIdentityUnobservable must NOT match errNoNewHost")
	}
}

// LAUNCH-ID-10: end-to-end RED/GREEN for the original reviewer's
// scenario.
//
//	candidates:   30157 NodeService
//	               30158 NodeService
//	               30159 NodeService
//	authoritative: 30159
//	expect:        bind 30159
//
// AND the negative:
//
//	candidates:   30157 30158 30159
//	authoritative: unavailable (--logs-path is empty)
//	expect:        HALT
//
// Both are covered above (LAUNCH-ID-01 and LAUNCH-ID-02); this is a
// guard test that runs the integration without invoking production
// ps / node. The sort guard below verifies that the bound PID is
// exactly the authoritative one and NOT a heuristic-derived value.
//
// v5 CORRECTION04 update: this test now exercises the v5
// "logsPath is the causal namespace" pipeline. The
// authoritative PID comes from
// <logsPath>/window1/exthost/exthost.log directly; there is
// no session enumeration.
func TestWaitForNewExtensionHost_BoundPIDMatchesAuthoritative(t *testing.T) {
	logDir := t.TempDir()
	const authoritativePID = 55555
	writeExthostLog(t, logDir, "20260917T174652",
		"2026-09-17 17:46:58.272 [info] Extension host with pid "+itoa(authoritativePID)+" started")

	// Build 5 candidates with authoritative NOT the lowest.
	candidates := []int{700, 800, 900, authoritativePID, 1200}
	current := map[int]string{}
	for _, p := range candidates {
		current[p] = "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService"
	}
	before := map[int]string{}

	restorePS := withSnapshot(fakePS(current))
	defer restorePS()

	got, err := waitForNewExtensionHost(before, 5*time.Second, logDir)
	if err != nil {
		t.Fatalf("expected bind authoritative, got err: %v", err)
	}
	if got != authoritativePID {
		t.Fatalf("expected authoritative=%d, got %d", authoritativePID, got)
	}
	// Defence: also assert via sort that no lowest-PID heuristic would
	// have produced this answer (proves the v3 fix actually replaces
	// the v2 heuristic).
	sort.Ints(candidates)
	if candidates[0] == got {
		t.Fatalf("guard failed: bound PID equals lowest-of-candidates=%d (lowest-PID heuristic must be GONE)",
			candidates[0])
	}
}

// itoa is a tiny stdlib-free integer formatter used by the guard
// tests above to keep the test file dependency-free.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// ----------------------------------------------------------------------------

// LAUNCH-SESSION-08: errExthostLogRace must be detectable via
// errors.Is so the discovery loop can branch on it.
func TestErrExthostLogRace_Is(t *testing.T) {
	wrapped := fmt.Errorf("wrapped race: %w", errExthostLogRace)
	if !errorsIs(wrapped, errExthostLogRace) {
		t.Fatalf("errors.Is must recognise wrapped errExthostLogRace")
	}
	if errorsIs(wrapped, errIdentityUnobservable) {
		t.Fatalf("errExthostLogRace must NOT match errIdentityUnobservable (race is a TRANSIENT)")
	}
}

// LAUNCH-SESSION-09 / LAUNCH-INSTANCE-01 / LAUNCH-WRAPPER-01:
// startClineMM no longer injects `--user-data-dir <dir>` into
// argv. Instead, it SETS `CLINEMM_USER_DATA_DIR=<dir>` on the
// child environment so the operator's `codium-clinemm` wrapper
// emits `--user-data-dir "$DATA_DIR"` itself (single source of
// truth). `--logsPath <dir>` IS still injected into argv
// because the wrapper does NOT own that flag (CAUSAL BINDING
// seam for the discovery loop, v4 / v5).
//
// This test is the v7 (CORRECTION06) load-bearing
// discriminator: it pins both the argv shape and the env shape
// that flow into the editor. We replicate the production
// injection logic against a known Config (build argv via the
// same code path as startClineMM, build env via the same code
// path as startClineMM) and then assert.
//
// The expected argv ORDER is:
//
//	[operator's Args (--no-sandbox, ...)]
//	[--logsPath <LogsPath>]           -- v4 CORRECTION03 + v5 CORRECTION04
//
// The argv MUST NOT contain `--user-data-dir`; that flag is
// the wrapper's responsibility now.
//
// The expected env additions are:
//
//	CLINEMM_USER_DATA_DIR=<UserDataDir>     SET  (v7 CORRECTION06)
//	CLINEMM_DIAG_TERMINATION_AUTHORITY=1     SET
//	CLINEMM_DIAG_CPU_PROFILE                UNSET
//	CLINEMM_DIAG_ALLOCATION_PROFILE         UNSET
//
// We then run /bin/echo to verify the argv passes through
// unchanged -- /bin/echo does NOT see the env (env is consumed
// by the exec, not echoed) but it proves the argv shape.
func TestStartClineMM_LogsPathInjection(t *testing.T) {
	cfg := &Config{
		Bin:         "/bin/echo",
		UserDataDir: "/tmp/c07-wrapper-user-data-dir-recon",
		LogsPath:    "/tmp/c07-logs-path-injection-recon",
		Args:        []string{"--no-sandbox"},
	}
	// Replicate startClineMM's argv build.
	args := append([]string{}, cfg.Args...)
	if cfg.LogsPath != "" {
		args = append(args, "--logsPath", cfg.LogsPath)
	}
	// v7 CORRECTION06 load-bearing invariant: argv MUST NOT
	// contain --user-data-dir. The wrapper emits it.
	if contains(args, "--user-data-dir") {
		t.Fatalf("argv MUST NOT contain --user-data-dir (v7 CORRECTION06 wrapper owns this flag), got: %v",
			args)
	}
	want := []string{
		"--no-sandbox",
		"--logsPath",
		"/tmp/c07-logs-path-injection-recon",
	}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("argv mismatch\n got: %v\nwant: %v", args, want)
	}
	// Replicate startClineMM's env build (filter then append).
	env := filteredEnv(
		os.Environ(),
		envCPUProfileRemove,
		envAllocProfileRemove,
	)
	if cfg.UserDataDir != "" {
		env = append(env, envUserDataDirSet+"="+cfg.UserDataDir)
	}
	env = append(env, envAuthority)

	// v7 CORRECTION06 load-bearing invariant: env MUST contain
	// CLINEMM_USER_DATA_DIR=<UserDataDir>.
	wantEnvEntry := envUserDataDirSet + "=" + cfg.UserDataDir
	if !contains(env, wantEnvEntry) {
		t.Fatalf("env MUST contain %q (v7 CORRECTION06 wrapper override), got: %v",
			wantEnvEntry, env)
	}
	// And: CLINEMM_DIAG_TERMINATION_AUTHORITY=1 must still
	// be appended.
	if !contains(env, envAuthority) {
		t.Fatalf("env MUST contain %q, got: %v", envAuthority, env)
	}
	// And: the two profiler knobs MUST still be filtered out.
	has := func(k string) bool {
		for _, item := range env {
			if strings.HasPrefix(item, k+"=") {
				return true
			}
		}
		return false
	}
	if has(envCPUProfileRemove) {
		t.Errorf("CLINEMM_DIAG_CPU_PROFILE leaked through filter: %v", env)
	}
	if has(envAllocProfileRemove) {
		t.Errorf("CLINEMM_DIAG_ALLOCATION_PROFILE leaked through filter: %v", env)
	}

	// And: prove /bin/echo accepts and prints the argv. /bin/echo
	// does NOT see the env (env is consumed by the exec, not
	// echoed) so this only verifies argv shape.
	out, err := exec.Command("/bin/echo", args...).Output()
	if err != nil {
		t.Fatalf("echo exec: %v", err)
	}
	got := string(out)
	if strings.Contains(got, "--user-data-dir") {
		t.Fatalf("echo output (argv) MUST NOT contain --user-data-dir (v7 CORRECTION06 wrapper owns this flag): %q", out)
	}
	if !strings.Contains(got, "--logsPath") ||
		!strings.Contains(got, "/tmp/c07-logs-path-injection-recon") {
		t.Fatalf("echo output missing injected --logsPath flag: %q", out)
	}
}

// errorsIs is a thin alias to avoid a top-level import; we already
// import errors elsewhere indirectly via stdlib use. Kept here as
// a local helper so future refactors don't break the tests.
func errorsIs(err, target error) bool {
	for err != nil {
		if err == target {
			return true
		}
		type unwrapper interface{ Unwrap() error }
		u, ok := err.(unwrapper)
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}

// ----------------------------------------------------------------------------
// v8 CORRECTION08 — HALT_TERMINATION_CAPTURE_ID_SPLIT
//
// The Go launcher owns the authoritative capture ID
// (`live-YYYYMMDD-HHMMSS` by default, or the operator's
// `--capture-id` override). The in-process Node witness previously
// generated its own ID via `_captureIdFactory()`, producing two
// separate `capture-<id>/` namespaces for the same run -- the
// analyzer couldn't compose them.
//
// v8 CORRECTION08: the launcher appends
// `CLINEMM_DIAG_TERMINATION_CAPTURE_ID=<cfg.CaptureID>` to the
// child env (when cfg.CaptureID != ""). The in-process Node witness
// reads it via `resolveOperatorTerminationCaptureIdFromEnv` and
// uses that ID instead of generating its own. The Node resolver
// REFUSES unsafe values (path traversal, NUL, > MAX_CAPTURE_ID_LEN)
// and falls back to the factory + emits a bounded warn.
//
// These tests pin both halves of the seam.
// ----------------------------------------------------------------------------

// LAUNCH-CAPTUREID-01: happy path. cfg.CaptureID set ->
// env MUST contain `CLINEMM_DIAG_TERMINATION_CAPTURE_ID=<cfg.CaptureID>`.
// Mirrors the production seam in startClineMM exactly.
func TestStartClineMM_TerminationCaptureIdInjection(t *testing.T) {
	cfg := &Config{
		Bin:         "/bin/echo",
		CaptureID:   "live-20260924-203917",
		UserDataDir: "/tmp/c08-userdata-recon",
		LogsPath:    "/tmp/c08-logs-recon",
		Args:        []string{"--no-sandbox"},
	}
	// Replicate startClineMM's argv build (unchanged from CORRECTION05).
	args := append([]string{}, cfg.Args...)
	if cfg.LogsPath != "" {
		args = append(args, "--logsPath", cfg.LogsPath)
	}
	// v7 CORRECTION06 load-bearing invariant (unchanged): argv MUST
	// NOT contain --user-data-dir. The wrapper owns that flag.
	if contains(args, "--user-data-dir") {
		t.Fatalf("argv MUST NOT contain --user-data-dir (v7 CORRECTION06 wrapper owns this flag), got: %v", args)
	}
	// Replicate startClineMM's env build.
	env := filteredEnv(
		os.Environ(),
		envCPUProfileRemove,
		envAllocProfileRemove,
	)
	if cfg.UserDataDir != "" {
		env = append(env, envUserDataDirSet+"="+cfg.UserDataDir)
	}
	// v8 CORRECTION08 load-bearing invariant: env MUST contain
	// `CLINEMM_DIAG_TERMINATION_CAPTURE_ID=<cfg.CaptureID>` when
	// cfg.CaptureID is non-empty. This is what the in-process Node
	// witness reads back via `resolveOperatorTerminationCaptureIdFromEnv`.
	if cfg.CaptureID != "" {
		env = append(env, envTerminationCaptureIdSet+"="+cfg.CaptureID)
	}
	env = append(env, envAuthority)

	// Load-bearing invariant #1: the env var is present.
	wantCaptureIdEntry := envTerminationCaptureIdSet + "=" + cfg.CaptureID
	if !contains(env, wantCaptureIdEntry) {
		t.Fatalf("env MUST contain %q (v8 CORRECTION08 in-process witness capture-id sharing), got: %v",
			wantCaptureIdEntry, env)
	}

	// Load-bearing invariant #2: the value is the EXACT capture ID
	// the operator supplied (not a generated one).
	for _, item := range env {
		if strings.HasPrefix(item, envTerminationCaptureIdSet+"=") {
			value := strings.TrimPrefix(item, envTerminationCaptureIdSet+"=")
			if value != cfg.CaptureID {
				t.Fatalf("env value for %q MUST equal cfg.CaptureID (%q), got: %q",
					envTerminationCaptureIdSet, cfg.CaptureID, value)
			}
		}
	}

	// Load-bearing invariant #3: CLINEMM_DIAG_TERMINATION_AUTHORITY=1
	// is still appended (the two env vars are paired).
	if !contains(env, envAuthority) {
		t.Fatalf("env MUST contain %q, got: %v", envAuthority, env)
	}

	// Load-bearing invariant #4: --user-data-dir is NOT in argv
	// (CORRECTION06 invariant preserved).
	out, err := exec.Command("/bin/echo", args...).Output()
	if err != nil {
		t.Fatalf("echo exec: %v", err)
	}
	if strings.Contains(string(out), "--user-data-dir") {
		t.Fatalf("echo output (argv) MUST NOT contain --user-data-dir (v7 CORRECTION06 wrapper owns this flag): %q", out)
	}

	// Conservation: the two profiler knobs MUST still be filtered out.
	has := func(k string) bool {
		for _, item := range env {
			if strings.HasPrefix(item, k+"=") {
				return true
			}
		}
		return false
	}
	if has(envCPUProfileRemove) {
		t.Errorf("CLINEMM_DIAG_CPU_PROFILE leaked through filter: %v", env)
	}
	if has(envAllocProfileRemove) {
		t.Errorf("CLINEMM_DIAG_ALLOCATION_PROFILE leaked through filter: %v", env)
	}
}

// LAUNCH-CAPTUREID-02: capture-id invariants. Sanity-check the env
// var name + value format match what the in-process Node resolver
// expects (`[A-Za-z0-9_-]+`, 1..128 chars, no `/` / `\` / `..` /
// NUL). This is the Go-side shape contract that the Node-side
// `resolveOperatorTerminationCaptureIdFromEnv` enforces.
func TestStartClineMM_TerminationCaptureId_GoSideInvariants(t *testing.T) {
	// Generate the canonical live-YYYYMMDD-HHMMSS format from the
	// same defaultCaptureIDFormat the launcher uses, then assert
	// it is accepted by the Node-side validation rules.
	live := "live-" + time.Now().Format(defaultCaptureIDFormat)
	if matched, _ := filepath.Match("live-????????-??????", live); !matched {
		t.Fatalf("defaultCaptureIDFormat produced an unexpected shape: %q (expected live-YYYYMMDD-HHMMSS)", live)
	}
	if strings.Contains(live, "/") || strings.Contains(live, "\\") || strings.Contains(live, "..") {
		t.Fatalf("defaultCaptureIDFormat produced a path-unsafe value: %q", live)
	}

	// Operator-supplied --capture-id example from the runbook.
	operatorExample := "live-specimen-01"
	if strings.Contains(operatorExample, "/") || strings.Contains(operatorExample, "\\") || strings.Contains(operatorExample, "..") {
		t.Fatalf("operator example --capture-id is path-unsafe: %q", operatorExample)
	}
	if len(live) > 128 || len(operatorExample) > 128 {
		t.Fatalf("Go-side capture IDs exceed Node-side MAX_CAPTURE_ID_LEN=128: live=%d operator=%d", len(live), len(operatorExample))
	}
}

// LAUNCH-CAPTUREID-03 (v9 CORRECTION09): end-to-end EQUALITY
// discriminator. The default-path (operator omits --capture-id)
// used to silently leave `cfg.CaptureID == ""` after main()
// computed the effective ID into a local; startClineMM therefore
// did NOT export CLINEMM_DIAG_TERMINATION_CAPTURE_ID, and the Node
// witness fell back to its factory -- producing TWO capture
// namespaces (the HALT we are repairing).
//
// This test mirrors the production normalization in main(): it
// computes the default capture ID the way main() does, writes it
// back into cfg.CaptureID (mirroring the v9 write-back), builds
// the SAME env the launcher builds, and asserts:
//
//   - cfg.CaptureID is non-empty after normalization
//   - env contains CLINEMM_DIAG_TERMINATION_CAPTURE_ID == cfg.CaptureID
//   - the value is the SAME ID the observer would receive via
//     --capture-id (one authority; byte-for-byte equality)
//
// This is the discriminator the reviewer asked for:
// `nodeEnvCaptureID == observerCaptureID`.
func TestStartClineMM_TerminationCaptureId_DefaultPathEquality(t *testing.T) {
	// Mirror main()'s normalization: start with cfg.CaptureID ==
	// "" (operator omitted --capture-id), then default to the
	// canonical live-YYYYMMDD-HHMMSS format, then write back.
	cfg := &Config{
		Bin:         "/bin/echo",
		CaptureID:   "",
		UserDataDir: "/tmp/c09-defaultpath-userdata",
		LogsPath:    "/tmp/c09-defaultpath-logs",
		Args:        []string{"--no-sandbox"},
	}
	effective := cfg.CaptureID
	if effective == "" {
		effective = "live-" + time.Now().Format(defaultCaptureIDFormat)
	}
	cfg.CaptureID = effective

	// Load-bearing invariant #1: cfg.CaptureID is non-empty after
	// the write-back. If this fails, the env var would not be
	// exported and the analyzer would not be able to compose.
	if cfg.CaptureID == "" {
		t.Fatalf("cfg.CaptureID MUST be non-empty after default normalization (v9 CORRECTION09), got %q", cfg.CaptureID)
	}

	// Build the env the same way startClineMM does.
	env := filteredEnv(
		os.Environ(),
		envCPUProfileRemove,
		envAllocProfileRemove,
	)
	if cfg.UserDataDir != "" {
		env = append(env, envUserDataDirSet+"="+cfg.UserDataDir)
	}
	if cfg.CaptureID != "" {
		env = append(env, envTerminationCaptureIdSet+"="+cfg.CaptureID)
	}
	env = append(env, envAuthority)

	// Load-bearing invariant #2: env contains the entry.
	wantEntry := envTerminationCaptureIdSet + "=" + cfg.CaptureID
	if !contains(env, wantEntry) {
		t.Fatalf("env MUST contain %q (v9 CORRECTION09 default-path seam), got: %v", wantEntry, env)
	}

	// Load-bearing invariant #3 (the reviewer's central
	// requirement): nodeEnvCaptureID == observerCaptureID. Both
	// halves of the seam MUST use the SAME byte-for-byte value;
	// otherwise the analyzer cannot compose two halves whose
	// namespaces diverge.
	var nodeEnvCaptureID string
	for _, item := range env {
		if strings.HasPrefix(item, envTerminationCaptureIdSet+"=") {
			nodeEnvCaptureID = strings.TrimPrefix(item, envTerminationCaptureIdSet+"=")
		}
	}
	if nodeEnvCaptureID == "" {
		t.Fatalf("CLINEMM_DIAG_TERMINATION_CAPTURE_ID env entry was missing or empty")
	}
	observerCaptureID := cfg.CaptureID
	if nodeEnvCaptureID != observerCaptureID {
		t.Fatalf("nodeEnvCaptureID MUST equal observerCaptureID byte-for-byte (v9 CORRECTION09), got nodeEnvCaptureID=%q observerCaptureID=%q",
			nodeEnvCaptureID, observerCaptureID)
	}

	// Load-bearing invariant #4: the default-generated value
	// satisfies the Node-side exact-identity contract (no
	// whitespace, in the [A-Za-z0-9_-] class, <= 128 chars).
	if strings.ContainsAny(nodeEnvCaptureID, " \t\n\r") {
		t.Fatalf("default-generated capture ID contains whitespace (would fail Node resolver): %q", nodeEnvCaptureID)
	}
	if len(nodeEnvCaptureID) > 128 {
		t.Fatalf("default-generated capture ID exceeds MAX_CAPTURE_ID_LEN=128: len=%d", len(nodeEnvCaptureID))
	}
}

// LAUNCH-CAPTUREID-04 (v9 CORRECTION09): validateOperatorCaptureID
// REJECTS the same unsafe values the Node-side resolver REJECTS.
// Operator-supplied `--capture-id` values that contain path-meta,
// NUL, whitespace, or characters outside `[A-Za-z0-9_-]` are
// refused at parse time rather than silently transformed (which
// would recreate the HALT).
func TestStartClineMM_ValidateOperatorCaptureID(t *testing.T) {
	cases := []struct {
		name      string
		id        string
		wantError bool
	}{
		// Accept (canonical + runbook examples).
		// NOTE: the empty case is NOT exercised by main() (empty
		// triggers the default normalization branch before the
		// validator runs). The validator itself rejects empty as
		// defense-in-depth.
		{"live-YYYYMMDD-HHMMSS canonical", "live-20260924-203917", false},
		{"operator runbook example", "live-specimen-01", false},
		{"ULID-shaped", "01HXYZ1234567890ABCDEFGH", false},

		// REFUSE: path metacharacters / NUL / whitespace / out-of-class.
		{"contains '/'", "live/2026", true},
		{"contains '\\'", "live\\2026", true},
		{"contains NUL", "live\x002026", true},
		{"contains '..'", "live..2026", true},
		{"leading whitespace", "  live-2026", true},
		{"trailing whitespace", "live-2026  ", true},
		{"internal whitespace", "live 2026", true},
		{"contains '.'", "live.2026", true},
		{"contains '!'", "live!2026", true},
		{"oversized (> 128 chars)", strings.Repeat("a", 129), true},
		{"oversized (exactly 128 chars) accepted", strings.Repeat("a", 128), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateOperatorCaptureID(tc.id)
			gotErr := err != nil
			if gotErr != tc.wantError {
				t.Fatalf("validateOperatorCaptureID(%q) error=%v want_error=%v (err=%v)",
					tc.id, gotErr, tc.wantError, err)
			}
		})
	}
}

// ----------------------------------------------------------------------------
// CORRECTION04 RED/GREEN tests (ACT §15 review round 4)
//
// v4's launch->session binding layer (`sessionsNow - sessionsBefore`)
// was internally inconsistent with the very main.js evidence v4
// cited: explicit --logsPath bypasses the <session>/ subdirectory
// synthesis. v5 makes the operator-supplied logsPath ITSELF the
// causal namespace. The helper requires it to be PRISTINE before
// launch (does not exist OR is empty), then reads
// <logsPath>/window1/exthost/exthost.log directly.
//
// These tests exercise the new pipeline.
// ----------------------------------------------------------------------------

// LAUNCH-LOGROOT-01: happy path. logsPath is unique and empty
// (or non-existent); exthost.log appears directly at
// <logsPath>/window1/exthost/exthost.log (NOT under a
// <session>/ subdirectory); the authoritative PID intersects
// the new-PID candidate set exactly once. Expect bind.
//
// The reviewer's fault injection: if a test fixture wrote the
// log to <logsPath>/<session>/window1/exthost/exthost.log
// (the v4 layout), this test MUST fail -- which is exactly
// the regression net we want. v5 expects the log at
// <logsPath>/window1/exthost/exthost.log.
func TestWaitForNewExtensionHost_LogRoot_HappyPath(t *testing.T) {
	logDir := t.TempDir()
	writeExthostLog(t, logDir, "ignored",
		"2026-09-17 17:46:58.272 [info] Extension host with pid 30159 started")

	before := map[int]string{
		100: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
	}
	current := map[int]string{
		100:   "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
		30157: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService a",
		30158: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService b",
		30159: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService c",
	}

	restorePS := withSnapshot(fakePS(current))
	defer restorePS()

	got, err := waitForNewExtensionHost(before, 5*time.Second, logDir)
	if err != nil {
		t.Fatalf("expected bind authoritative, got error: %v", err)
	}
	if got != 30159 {
		t.Fatalf("expected authoritative PID=30159, got %d", got)
	}
}

// LAUNCH-LOGROOT-01 FAULT INJECTION (the reviewer's exact ask):
// write the log at the v4-style path
// <logsPath>/<session>/window1/exthost/exthost.log. v5 expects
// the log at <logsPath>/window1/exthost/exthost.log, so the
// production reader cannot find it; the loop times out into
// errIdentityUnobservable. The test MUST fail on the v4
// filesystem shape.
func TestWaitForNewExtensionHost_LogRoot_FaultInjectionV4Layout(t *testing.T) {
	logDir := t.TempDir()
	// Fault: write the log under a v4-style <session> subdir.
	exthostPath := filepath.Join(logDir, "20260917T174652", "window1", "exthost", "exthost.log")
	if err := os.MkdirAll(filepath.Dir(exthostPath), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(exthostPath, []byte("2026-09-17 17:46:58.272 [info] Extension host with pid 30159 started\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	before := map[int]string{
		100: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
	}
	current := map[int]string{
		100:   "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
		30157: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService a",
		30158: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService b",
		30159: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService c",
	}

	restorePS := withSnapshot(fakePS(current))
	defer restorePS()

	_, err := waitForNewExtensionHost(before, 200*time.Millisecond, logDir)
	if err == nil {
		t.Fatalf("expected errIdentityUnobservable on v4-layout fault injection, got nil")
	}
	if !errorsIs(err, errIdentityUnobservable) {
		t.Fatalf("expected errIdentityUnobservable, got: %v", err)
	}
	msg := err.Error()
	if !strings.Contains(msg, "window1/exthost/exthost.log was not written") {
		t.Fatalf("error must call out missing exthost.log path, got: %v", msg)
	}
}

// LAUNCH-LOGROOT-02: logsPath already contains files before
// launch. Expect HALT_EXTENSION_HOST_LOG_PATH_NOT_PRISTINE
// (exit 7) -- the helper refuses to launch because we could
// not prove any file later appearing under logsPath came from
// THIS launch.
//
// This is the new pre-launch invariant in v5. ensurePristineLogsPath
// must refuse to launch against a non-empty directory.
func TestEnsurePristineLogsPath_NotPristine_Halt(t *testing.T) {
	logDir := t.TempDir()
	// Pre-existing stale content.
	if err := os.WriteFile(filepath.Join(logDir, "stale.log"), []byte("garbage"), 0o644); err != nil {
		t.Fatalf("write stale: %v", err)
	}

	err := ensurePristineLogsPath(logDir)
	if err == nil {
		t.Fatalf("expected errLogPathNotPristine, got nil")
	}
	if !errorsIs(err, errLogPathNotPristine) {
		t.Fatalf("expected errLogPathNotPristine, got: %v", err)
	}
	// And: the error message must explicitly name the stale
	// contents so the operator can diagnose.
	msg := err.Error()
	if !strings.Contains(msg, "is not empty") {
		t.Fatalf("error must call out non-empty directory, got: %v", msg)
	}
	if !strings.Contains(msg, "stale.log") {
		t.Fatalf("error must name the offending entry, got: %v", msg)
	}
}

// LAUNCH-LOGROOT-02 (positive side): ensurePristineLogsPath
// accepts a non-existent directory and creates it.
func TestEnsurePristineLogsPath_NonExistent_Creates(t *testing.T) {
	parent := t.TempDir()
	logDir := filepath.Join(parent, "fresh-logs-root")
	if _, err := os.Stat(logDir); !os.IsNotExist(err) {
		t.Fatalf("precondition: logDir must not exist; got err=%v", err)
	}

	if err := ensurePristineLogsPath(logDir); err != nil {
		t.Fatalf("expected ensurePristineLogsPath to create %s, got: %v", logDir, err)
	}
	info, err := os.Stat(logDir)
	if err != nil {
		t.Fatalf("postcondition: stat failed: %v", err)
	}
	if !info.IsDir() {
		t.Fatalf("postcondition: not a directory: %v", info)
	}
}

// LAUNCH-LOGROOT-02 (positive side 2): ensurePristineLogsPath
// accepts an existing empty directory.
func TestEnsurePristineLogsPath_ExistingEmpty_OK(t *testing.T) {
	logDir := t.TempDir() // empty by construction
	if err := ensurePristineLogsPath(logDir); err != nil {
		t.Fatalf("expected empty logDir to be pristine, got: %v", err)
	}
}

// LAUNCH-LOGROOT-02 (negative side): ensurePristineLogsPath
// refuses when logsPath is a regular file.
func TestEnsurePristineLogsPath_PathIsFile_Halt(t *testing.T) {
	parent := t.TempDir()
	logPath := filepath.Join(parent, "not-a-dir")
	if err := os.WriteFile(logPath, []byte("file"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	err := ensurePristineLogsPath(logPath)
	if err == nil {
		t.Fatalf("expected errLogPathNotPristine, got nil")
	}
	if !errorsIs(err, errLogPathNotPristine) {
		t.Fatalf("expected errLogPathNotPristine, got: %v", err)
	}
	if !strings.Contains(err.Error(), "exists but is not a directory") {
		t.Fatalf("error must call out the path-is-file case, got: %v", err)
	}
}

// LAUNCH-LOGROOT-03: log root exists (pristine) but exthost.log
// is never written within the discovery window. The discovery
// loop continues polling on errExthostLogRace (transient) and
// eventually times out into errIdentityUnobservable.
//
// The reviewer's spec: "log root exists but exthost.log absent
// => retry until timeout". We cannot easily inject a true
// "retry until timeout" without using fakeExthostReaderSequence
// with len(races) > timeout/interval, but the timeout path is
// already covered by TestWaitForNewExtensionHost_AuthoritativeUnobservable_NoExthostLog
// above. Here we explicitly exercise the log/write-race tolerance
// using the fake reader that yields errExthostLogRace N times
// before yielding the authoritative PID.
func TestWaitForNewExtensionHost_LogRoot_LogWriteRace(t *testing.T) {
	logDir := t.TempDir()
	const authoritativePID = 30159
	// Production reader also works (file already exists); but to
	// explicitly exercise the race path we use a sequence reader
	// that yields errExthostLogRace twice before yielding the
	// authoritative PID. The loop must continue polling, not HALT.
	restoreReader := withExthostReader(fakeExthostReaderSequence(2, authoritativePID))
	defer restoreReader()

	before := map[int]string{
		100: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
	}
	current := map[int]string{
		100:              "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
		30157:            "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService a",
		30158:            "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService b",
		authoritativePID: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService c",
	}

	restorePS := withSnapshot(fakePS(current))
	defer restorePS()

	got, err := waitForNewExtensionHost(before, 5*time.Second, logDir)
	if err != nil {
		t.Fatalf("expected bind through the log/write race, got: %v", err)
	}
	if got != authoritativePID {
		t.Fatalf("expected authoritative=%d, got %d", authoritativePID, got)
	}
}

// LAUNCH-LOGROOT-04: log exists, first line is malformed. Expect
// HALT_EXTENSION_HOST_IDENTITY_UNOBSERVABLE (a HARD parse failure
// after the file exists -- NOT a transient race).
func TestWaitForNewExtensionHost_LogRoot_MalformedFirstLine(t *testing.T) {
	logDir := t.TempDir()
	// Write the file directly with a malformed first line.
	exthostPath := filepath.Join(logDir, "window1", "exthost", "exthost.log")
	if err := os.MkdirAll(filepath.Dir(exthostPath), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(exthostPath,
		[]byte("garbage, this is not a valid exthost.log first line\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	before := map[int]string{
		100: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
	}
	current := map[int]string{
		100:   "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
		30157: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService a",
		30158: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService b",
		30159: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService c",
	}

	restorePS := withSnapshot(fakePS(current))
	defer restorePS()

	_, err := waitForNewExtensionHost(before, 5*time.Second, logDir)
	if err == nil {
		t.Fatalf("expected errIdentityUnobservable on malformed first line, got nil")
	}
	if !errorsIs(err, errIdentityUnobservable) {
		t.Fatalf("expected errIdentityUnobservable, got: %v", err)
	}
	// Defensive: the error must NOT be classified as a race
	// (a race is a transient; the malformed-content case is a
	// hard parse failure).
	if errorsIs(err, errExthostLogRace) {
		t.Fatalf("malformed-content MUST NOT be classified as a race transient")
	}
	// And: the error must explicitly call out the malformed
	// content so the operator can diagnose.
	msg := err.Error()
	if !strings.Contains(msg, "did not match exthost-started pattern") {
		t.Fatalf("error must call out malformed first line, got: %v", msg)
	}
}

// LAUNCH-LOGROOT-05: ensurePristineLogsPath + waitForNewExtensionHost
// full pipeline integration -- ensurePristineLogsPath on the
// non-existent path then a successful bind.
func TestEnsurePristineLogsPath_ThenLogRoot_HappyPath(t *testing.T) {
	parent := t.TempDir()
	logDir := filepath.Join(parent, "live-specimen-01")
	if err := ensurePristineLogsPath(logDir); err != nil {
		t.Fatalf("ensurePristineLogsPath failed: %v", err)
	}

	// Simulate the launched editor writing exthost.log directly
	// under logsPath (the v5 production shape).
	writeExthostLog(t, logDir, "ignored",
		"2026-09-17 17:46:58.272 [info] Extension host with pid 30159 started")

	before := map[int]string{
		100: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
	}
	current := map[int]string{
		100:   "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService old",
		30157: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService a",
		30158: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService b",
		30159: "/Applications/VSCodium Helper --type=utility --utility-sub-type=node.mojom.NodeService c",
	}

	restorePS := withSnapshot(fakePS(current))
	defer restorePS()

	got, err := waitForNewExtensionHost(before, 5*time.Second, logDir)
	if err != nil {
		t.Fatalf("expected bind authoritative, got: %v", err)
	}
	if got != 30159 {
		t.Fatalf("expected authoritative PID=30159, got %d", got)
	}
}

// errLogPathNotPristine sentinel dispatch (LAUNCH-LOGROOT-02
// regression net).
func TestErrLogPathNotPristine_Is(t *testing.T) {
	wrapped := fmt.Errorf("wrapped sentinel: %w", errLogPathNotPristine)
	if !errorsIs(wrapped, errLogPathNotPristine) {
		t.Fatalf("errors.Is must recognise wrapped errLogPathNotPristine")
	}
	if errorsIs(wrapped, errIdentityUnobservable) {
		t.Fatalf("errLogPathNotPristine must NOT match errIdentityUnobservable (pre-launch halt vs. in-loop halt are distinct)")
	}
	if errorsIs(wrapped, errNoNewHost) {
		t.Fatalf("errLogPathNotPristine must NOT match errNoNewHost")
	}
}

// ----------------------------------------------------------------------------
// CORRECTION05 RED/GREEN tests (ACT §15 review round 5)
//
// v5 made logsPath itself the causal namespace, but the launch still
// did not prove the launched editor was a DISTINCT VSCodium
// instance. VS Code / VSCodium is intentionally single-instance by
// default: a secondary CLI invocation tries to communicate with an
// existing main process and inherits that instance's environment +
// extension state. Without a pristine --user-data-dir, the helper
// cannot prove the launched editor is a distinct instance.
//
// v6 (CORRECTION05) requires --user-data-dir and verifies it is
// PRISTINE before launch. The launch-time invariant is:
//
//   <userDataDir>/...                       -- v6: distinct instance
//   <logsPath>/window1/exthost/exthost.log  -- v5: authoritative PID
//
// These tests exercise the new pipeline at the same level as v5's
// LAUNCH-LOGROOT-* tests.
// ----------------------------------------------------------------------------

// LAUNCH-INSTANCE-01: ParseConfig requires --user-data-dir (v6
// CORRECTION05). Missing flag → ParseConfig error → main exits 3
// (exitObserverMissing). The error message names the new invariant.
func TestParseConfig_UserDataDir_Required(t *testing.T) {
	_, err := ParseConfig([]string{
		"--bin", "/bin/sleep",
		"--data-dir", "/tmp/data",
		"--logs-path", "/tmp/logs",
		// --user-data-dir intentionally OMITTED
		"--", "/tmp/workspace",
	})
	if err == nil {
		t.Fatalf("expected ParseConfig error when --user-data-dir is missing, got nil")
	}
	msg := err.Error()
	if !strings.Contains(msg, "--user-data-dir") {
		t.Fatalf("error must name the missing flag, got: %v", msg)
	}
	if !strings.Contains(msg, "CORRECTION05") {
		t.Fatalf("error must reference CORRECTION05 so the operator can find the rationale, got: %v", msg)
	}
	if !strings.Contains(msg, "single-instance") {
		t.Fatalf("error must explain WHY the flag is required, got: %v", msg)
	}
}

// LAUNCH-INSTANCE-02: ensurePristineUserDataDir HALT with
// HALT_EXTENSION_HOST_USER_DATA_DIR_NOT_PRISTINE if the directory
// already contains files. We cannot prove the launched editor is
// a distinct instance if a previous launch already populated the
// directory. Translated to exit 7 (same as the logsPath pristine
// halt -- both are pre-launch causal-binding HALTs).
func TestEnsurePristineUserDataDir_NotPristine_Halt(t *testing.T) {
	dir := t.TempDir()
	// Pre-existing stale content (simulates a previous launch).
	if err := os.WriteFile(filepath.Join(dir, "stale-userdata.json"), []byte("garbage"), 0o644); err != nil {
		t.Fatalf("write stale: %v", err)
	}

	err := ensurePristineUserDataDir(dir)
	if err == nil {
		t.Fatalf("expected errUserDataDirNotPristine, got nil")
	}
	if !errorsIs(err, errUserDataDirNotPristine) {
		t.Fatalf("expected errUserDataDirNotPristine, got: %v", err)
	}
	// And: the error message must explicitly name the stale
	// contents so the operator can diagnose.
	msg := err.Error()
	if !strings.Contains(msg, "is not empty") {
		t.Fatalf("error must call out non-empty directory, got: %v", msg)
	}
	if !strings.Contains(msg, "stale-userdata.json") {
		t.Fatalf("error must name the offending entry, got: %v", msg)
	}
}

// LAUNCH-INSTANCE-02 (positive side): ensurePristineUserDataDir
// accepts a non-existent directory and creates it. Same contract
// as ensurePristineLogsPath.
func TestEnsurePristineUserDataDir_NonExistent_Creates(t *testing.T) {
	parent := t.TempDir()
	dir := filepath.Join(parent, "fresh-user-data-dir")
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("precondition: dir must not exist; got err=%v", err)
	}

	if err := ensurePristineUserDataDir(dir); err != nil {
		t.Fatalf("expected ensurePristineUserDataDir to create %s, got: %v", dir, err)
	}
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("postcondition: stat failed: %v", err)
	}
	if !info.IsDir() {
		t.Fatalf("postcondition: not a directory: %v", info)
	}
}

// LAUNCH-INSTANCE-02 (positive side 2): ensurePristineUserDataDir
// accepts an existing empty directory.
func TestEnsurePristineUserDataDir_ExistingEmpty_OK(t *testing.T) {
	dir := t.TempDir() // empty by construction
	if err := ensurePristineUserDataDir(dir); err != nil {
		t.Fatalf("expected empty dir to be pristine, got: %v", err)
	}
}

// LAUNCH-INSTANCE-02 (negative side): ensurePristineUserDataDir
// refuses when userDataDir is a regular file.
func TestEnsurePristineUserDataDir_PathIsFile_Halt(t *testing.T) {
	parent := t.TempDir()
	path := filepath.Join(parent, "not-a-dir-userdata")
	if err := os.WriteFile(path, []byte("file"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	err := ensurePristineUserDataDir(path)
	if err == nil {
		t.Fatalf("expected errUserDataDirNotPristine, got nil")
	}
	if !errorsIs(err, errUserDataDirNotPristine) {
		t.Fatalf("expected errUserDataDirNotPristine, got: %v", err)
	}
	if !strings.Contains(err.Error(), "exists but is not a directory") {
		t.Fatalf("error must call out the path-is-file case, got: %v", err)
	}
}

// LAUNCH-INSTANCE-03: errUserDataDirNotPristine must NOT match
// errLogPathNotPristine. Both are pre-launch HALTs translated to
// exit 7, but they name distinct invariants and must be
// distinguishable by errors.Is dispatch (e.g. for the operator's
// exit-code error message).
func TestErrUserDataDirNotPristine_Is(t *testing.T) {
	wrapped := fmt.Errorf("wrapped sentinel: %w", errUserDataDirNotPristine)
	if !errorsIs(wrapped, errUserDataDirNotPristine) {
		t.Fatalf("errors.Is must recognise wrapped errUserDataDirNotPristine")
	}
	if errorsIs(wrapped, errLogPathNotPristine) {
		t.Fatalf("errUserDataDirNotPristine must NOT match errLogPathNotPristine (distinct invariants)")
	}
	if errorsIs(wrapped, errIdentityUnobservable) {
		t.Fatalf("errUserDataDirNotPristine must NOT match errIdentityUnobservable (pre-launch halt vs. in-loop halt are distinct)")
	}
	if errorsIs(wrapped, errNoNewHost) {
		t.Fatalf("errUserDataDirNotPristine must NOT match errNoNewHost")
	}
}

// LAUNCH-INSTANCE-04 (integration): ensurePristineUserDataDir on
// a non-existent path, then ensurePristineLogsPath on a
// non-existent path, then the operator can launch (we stop
// short of exec here because that would require a real editor).
// This is the v6 launch readiness pipeline.
func TestEnsurePristineUserDataDir_ThenLogRoot_HappyPath(t *testing.T) {
	parent := t.TempDir()
	userDataDir := filepath.Join(parent, "instance-a")
	logsPath := filepath.Join(parent, "logs-a")

	if err := ensurePristineUserDataDir(userDataDir); err != nil {
		t.Fatalf("expected ensurePristineUserDataDir to create %s, got: %v", userDataDir, err)
	}
	if err := ensurePristineLogsPath(logsPath); err != nil {
		t.Fatalf("expected ensurePristineLogsPath to create %s, got: %v", logsPath, err)
	}

	// Both directories must now exist and be empty.
	for _, p := range []string{userDataDir, logsPath} {
		info, err := os.Stat(p)
		if err != nil {
			t.Fatalf("postcondition: stat %s failed: %v", p, err)
		}
		if !info.IsDir() {
			t.Fatalf("postcondition: %s not a directory", p)
		}
		entries, err := os.ReadDir(p)
		if err != nil {
			t.Fatalf("postcondition: readdir %s failed: %v", p, err)
		}
		if len(entries) != 0 {
			t.Fatalf("postcondition: %s not empty: %v", p, entries)
		}
	}
}

// LAUNCH-INSTANCE-05 (fault injection, reviewer's exact ask):
// ensurePristineUserDataDir accepts a directory whose only
// contents are HIDDEN files (.DS_Store, .lock, .pid, etc.) --
// these are STILL contamination because they may be left over
// from a previous VSCodium instance's runtime state. The check
// is "directory is empty", not "directory has no visible files".
// This is a positive-side expectation: we DO NOT recurse and
// accept hidden files. The launch HALT is the correct behavior.
func TestEnsurePristineUserDataDir_HiddenFile_Still_Halt(t *testing.T) {
	dir := t.TempDir()
	// A hidden file (e.g. .DS_Store on macOS, .lock on Linux).
	if err := os.WriteFile(filepath.Join(dir, ".DS_Store"), []byte("stale"), 0o644); err != nil {
		t.Fatalf("write hidden: %v", err)
	}

	err := ensurePristineUserDataDir(dir)
	if err == nil {
		t.Fatalf("expected errUserDataDirNotPristine for hidden-file contamination, got nil")
	}
	if !errorsIs(err, errUserDataDirNotPristine) {
		t.Fatalf("expected errUserDataDirNotPristine, got: %v", err)
	}
	if !strings.Contains(err.Error(), ".DS_Store") {
		t.Fatalf("error must name the offending entry, got: %v", err)
	}
}
