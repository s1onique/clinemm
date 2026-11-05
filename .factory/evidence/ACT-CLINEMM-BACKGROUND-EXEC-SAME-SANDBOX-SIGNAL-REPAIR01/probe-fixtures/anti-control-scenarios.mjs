#!/usr/bin/env node
/**
 * Process-free anti-control scenarios for
 * ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01.
 * Marker: CLINEMM_REPAIR01_ANTI_CONTROL_SCENARIOS
 *
 * PURPOSE
 * -------
 * The review required PROCESS-FREE anti-controls proving that an unsafe
 * signal target NEVER results in a destructive signal.  These scenarios
 * describe SYNTHETIC process-table states.  They never spawn, observe, or
 * signal a real process: the identity observation is injected and every
 * signal attempt is recorded by a recorder sink.
 *
 * REQUIRED SCENARIOS
 * ------------------
 *   stale-pid              the recorded PID now belongs to a DIFFERENT
 *                          process (argv/start-identity changed) — the
 *                          classic PID-reuse hazard.
 *   missing-identity       the observed identity is incomplete (argv could
 *                          not be read) — an unreadable field must block.
 *   expired-target         the target has exited (kernel ESRCH) — absence
 *                          must be established by ESRCH, and no signal may
 *                          be delivered.
 *   changed-argv           the target's argv changed since capture.
 *   unreadable-metadata    every process-table observation FAILED (ps
 *                          unavailable/timed out) — a failed observation must
 *                          never be turned into "absent" or "verified".
 *   changed-start-identity the target's process start identity changed
 *                          (same argv, different incarnation).
 *   changed-uid            the target's uid changed.
 *   changed-pgid           the target's process group changed — the PGID
 *                          ownership hazard.
 *   eperm-target           the target exists but is not signalable (EPERM).
 *   healthy                CONTROL: identity fully matches — this is the
 *                          only scenario permitted to deliver a signal, and
 *                          it proves the anti-controls are not vacuous.
 *
 * Every scenario declares `expectSignal: false` except `healthy`.
 */
export const ANTI_CONTROL_MARKER = "CLINEMM_REPAIR01_ANTI_CONTROL_SCENARIOS"

/** The identity a synthetic target is captured with. */
export const CANONICAL_IDENTITY = {
	argv: "/opt/homebrew/bin/node /tmp/clinemm-foreign-target-fixture.mjs /tmp/foreign.log",
	uid: "501",
	startIdentity: "Thu Nov  5 22:00:00 2026",
	pgid: 4242,
}

/** Kernel liveness states a synthetic observation may report. */
function liveness(state, errnoCode = null) {
	return { state, errnoCode, delivered: false }
}

/**
 * Build a synthetic observation from an override map.  A field explicitly
 * set to `null` means "unreadable".  A field set to `undefined` means
 * "inherit the canonical value".
 */
function observation(overrides = {}) {
	const argv = "argv" in overrides ? overrides.argv : CANONICAL_IDENTITY.argv
	const startIdentity =
		"startIdentity" in overrides ? overrides.startIdentity : CANONICAL_IDENTITY.startIdentity
	const uid = "uid" in overrides ? overrides.uid : CANONICAL_IDENTITY.uid
	const pgid = "pgid" in overrides ? overrides.pgid : CANONICAL_IDENTITY.pgid
	const live = "liveness" in overrides ? overrides.liveness : liveness("alive")
	return {
		pid: 4242,
		argv,
		startIdentity,
		uid,
		pgid,
		liveness: live,
		complete:
			argv !== null &&
			startIdentity !== null &&
			uid !== null &&
			pgid !== null &&
			live.state !== "unknown",
	}
}

/**
 * The scenario table.  `expect` documents the required outcome:
 *   `signalAllowed` — whether the fail-closed gate may permit a signal.
 *   `expectSignal`  — whether a destructive signal may actually be sent.
 */
export const ANTI_CONTROL_SCENARIOS = {
	"stale-pid": {
		description:
			"The recorded PID was reused by an unrelated process: different argv and different start identity.",
		expect: { signalAllowed: false, expectSignal: false, reasonContains: "identity-mismatch" },
		observed: () =>
			observation({
				argv: "/usr/bin/some-unrelated-daemon --serve",
				startIdentity: "Thu Nov  5 22:30:00 2026",
			}),
	},
	"missing-identity": {
		description: "The argv could not be read: the identity is incomplete and must block.",
		expect: { signalAllowed: false, expectSignal: false, reasonContains: "identity-incomplete" },
		observed: () => observation({ argv: null }),
	},
	"expired-target": {
		description:
			"The target has already exited: the kernel reports ESRCH, so the target is absent and nothing may be signalled.",
		expect: { signalAllowed: false, expectSignal: false, reasonContains: "target-absent" },
		observed: () => observation({ liveness: liveness("gone", "ESRCH") }),
	},
	"changed-argv": {
		description: "The target's argv changed since it was captured.",
		expect: { signalAllowed: false, expectSignal: false, reasonContains: "argv:changed" },
		observed: () => observation({ argv: "/opt/homebrew/bin/node /tmp/some-other-fixture.mjs" }),
	},
	"unreadable-metadata": {
		description:
			"Every process-table observation FAILED (ps unavailable or timed out): a failed observation carries no information and must never authorize a signal.",
		expect: { signalAllowed: false, expectSignal: false, reasonContains: "identity-incomplete" },
		observed: () =>
			observation({
				argv: null,
				startIdentity: null,
				uid: null,
				pgid: null,
				liveness: liveness("unknown", null),
			}),
	},
	"changed-start-identity": {
		description:
			"Same argv, but a different process incarnation: the start identity moved, so the recorded target is gone.",
		expect: { signalAllowed: false, expectSignal: false, reasonContains: "startIdentity:changed" },
		observed: () => observation({ startIdentity: "Thu Nov  5 22:45:00 2026" }),
	},
	"changed-uid": {
		description: "The target's uid changed.",
		expect: { signalAllowed: false, expectSignal: false, reasonContains: "uid:changed" },
		observed: () => observation({ uid: "0" }),
	},
	"changed-pgid": {
		description:
			"The target's process group changed: the recorded group id may have been reused, so the group-directed signal must be refused.",
		expect: { signalAllowed: false, expectSignal: false, reasonContains: "pgid:changed" },
		observed: () => observation({ pgid: 7777 }),
	},
	"eperm-target": {
		description:
			"The target exists but is not signalable (EPERM): it is present, so it must never be classified as absent, and no destructive signal may be attempted.",
		expect: { signalAllowed: false, expectSignal: false, reasonContains: "target-unsignalable" },
		observed: () => observation({ liveness: liveness("alive", "EPERM") }),
	},
	healthy: {
		description:
			"CONTROL: the identity matches completely.  This is the only scenario permitted to deliver a signal, which proves the anti-controls are not vacuous.",
		expect: { signalAllowed: true, expectSignal: true, reasonContains: "identity-verified" },
		observed: () => observation(),
	},
}

/**
 * Build an anti-control run context for a scenario name.
 *
 * Returns:
 *   - `observe`       — the injected identity observer.
 *   - `expected`      — the identity the operator captured.
 *   - `signalRecorder`— a recorder with `.calls` and `.deliver(pid, signal)`.
 *   - `scenario`      — the scenario descriptor.
 */
export function buildAntiControl(name) {
	const scenario = ANTI_CONTROL_SCENARIOS[name]
	if (!scenario) {
		throw new Error(
			`unknown anti-control scenario: ${name} (known: ${Object.keys(ANTI_CONTROL_SCENARIOS).join(", ")})`,
		)
	}
	const signalRecorder = {
		calls: [],
		deliver(pid, signal) {
			this.calls.push({ pid, signal })
		},
	}
	return {
		scenario,
		expected: { ...CANONICAL_IDENTITY },
		observe: scenario.observed,
		signalRecorder,
	}
}
