// Test seams for clinemm-live-capture.
//
// ACT-CLINEMM-EXTENSION-HOST-LIVE-CAPTURE-LAUNCHER01 / §11.
//
// These functions intentionally expose only the pure logic so
// phases_test.go can exercise LAUNCH-01..06 without ever spawning
// ps or node. Production code MUST NOT call into this file.

package main

import (
	"strconv"
)

// selectNewExtensionHosts returns the PIDs in `current` that are
// not present in `before`. Order is not specified -- callers that
// need a stable iteration order should sort the result. The
// returned slice preserves first-wins ordering of the iteration
// over `current`.
func selectNewExtensionHosts(before, current map[int]string) []int {
	out := make([]int, 0, len(current))
	var anyCommand string
	for pid, command := range current {
		if _, existed := before[pid]; existed {
			continue
		}
		out = append(out, pid)
		anyCommand = command
	}
	// Note: anyCommand is captured for callers that need the
	// command of a single candidate, but the public seam returns
	// only PIDs so unit tests stay deterministic. Production code
	// in waitForNewExtensionHost re-reads the map after this.
	_ = anyCommand
	return out
}

// buildObserverArgv is the LAUNCH-06 test seam: it builds exactly
// the argv shape passed to `node scripts/capture-extension-host-lifecycle.mjs`
// without spawning a process. Order is the documented observer
// contract; do not silently reorder these flags.
func buildObserverArgv(cfg *Config, captureID string, pid int) []string {
	return []string{
		"scripts/capture-extension-host-lifecycle.mjs",
		"--capture-id", captureID,
		"--pid", strconv.Itoa(pid),
		"--cadence-ms", strconv.FormatInt(cfg.Cadence.Milliseconds(), 10),
		"--duration-ms", strconv.FormatInt(cfg.Duration.Milliseconds(), 10),
		"--data-dir", cfg.DataDir,
	}
}

// contains is a tiny helper used by the env invariant test to
// check that the launcher-appended envAuthority entry actually
// landed in the env slice.
func contains(haystack []string, needle string) bool {
	for _, item := range haystack {
		if item == needle {
			return true
		}
	}
	return false
}
