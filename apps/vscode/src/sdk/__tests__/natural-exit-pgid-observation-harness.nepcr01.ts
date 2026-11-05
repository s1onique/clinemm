/**
 * ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01 (NEPCR01) — TEST-ONLY
 * real-process observation harness.
 *
 * SCOPE / AUTHORITY
 * -----------------
 * This module is a READ-ONLY process-group observation utility. It is
 * deliberately SEPARATE from production state authority:
 *
 *   - It NEVER mutates process state (no signals are sent).
 *   - It NEVER writes to the production `CommandJobManager`'s job record.
 *   - The manager's own `finalize()` classification remains the ONLY
 *     authority for `managerTerminalState` / `containmentFailed`.
 *
 * It exists because the production seam (`defaultTerminalPostconditionProbe`)
 * collapses two distinct kernel facts into one errno:
 *
 *   process.kill(-pgid, 0)
 *     rc=0    -> group exists AND is signalable    -> "alive"
 *     EPERM   -> group exists BUT is not signalable -> also "alive"
 *     ESRCH   -> group does not exist              -> "gone"
 *
 * On a host that cannot signal the group (e.g. a macOS Seatbelt profile
 * with only `(allow signal (target self))`), the production probe returns
 * `eperm` for every LIVE group. The errno still discriminates alive-vs-gone
 * — EPERM means "exists", ESRCH means "does not exist" — so this harness
 * can report the kernel-truth liveness independently of whether the probe
 * was permitted to signal.
 *
 * PROCESS IDENTITY
 * ----------------
 * PGID reuse is a real hazard. A later observation of the same numeric
 * PGID does NOT prove the same process group is still there. To avoid
 * promoting reuse into causal identity, this harness records the original
 * PGID, the original leader PID, the process-group MEMBERSHIP observed at
 * each check (pid / ppid / pgid / stat / command), and the START IDENTITY
 * (pid + lstart) of every member.
 *
 * PLATFORM
 * --------
 * macOS `ps` is not directly executable under the ClineMM Seatbelt
 * profile (`/bin/ps` -> EPERM, `/usr/bin/ps` -> ENOENT), but `/bin/bash
 * -c 'ps ...'` IS permitted and yields the same `pid/ppid/pgid/stat`
 * columns. This harness therefore routes every `ps` invocation through
 * `/bin/bash -c`.
 */

import { execFileSync, spawn } from "node:child_process"

/**
 * Kernel-truth liveness of a process group, as observed READ-ONLY.
 *
 * - `alive`   — the group exists (rc=0 or EPERM on `-pgid`).
 * - `gone`    — the group does not exist (ESRCH on `-pgid`).
 * - `unknown` — the probe could not be performed at all.
 */
export type ObservedGroupLiveness = "alive" | "gone" | "unknown"

export type GroupProbeResult = {
	readonly liveness: ObservedGroupLiveness
	/** The raw errno the kernel reported, or null when rc=0. */
	readonly osErrorCode: string | null
}

export type ProcessMember = {
	readonly pid: number
	readonly ppid: number
	readonly pgid: number
	/** `ps` STAT column (e.g. `S`, `Z`, `R`). */
	readonly stat: string
	/** `ps` command column, truncated. */
	readonly command: string
	/**
	 * Process START IDENTITY (`ps` lstart). Together with the pid this
	 * is the identity tuple that makes PID-reuse detectable.
	 */
	readonly startIdentity: string
}

/**
 * Read-only process-group existence probe.
 *
 * Mirrors the production probe's syscall (`process.kill(-pgid, 0)`) but
 * reports the KERNEL TRUTH: EPERM means "the group exists" (the caller
 * merely lacks permission to signal it), ESRCH means "the group does not
 * exist".
 */
export function observeGroupLiveness(pgid: number): GroupProbeResult {
	try {
		process.kill(-pgid, 0)
		return { liveness: "alive", osErrorCode: null }
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code
		if (code === "ESRCH") return { liveness: "gone", osErrorCode: code }
		// EPERM (and any other errno): the group cannot be proven gone.
		// The production probe treats EPERM as "unproven"; this harness
		// treats it as "alive" because on POSIX a negative-pid kill
		// returns EPERM only when the target process group exists.
		if (code === "EPERM") return { liveness: "alive", osErrorCode: code }
		return { liveness: "unknown", osErrorCode: typeof code === "string" ? code : null }
	}
}

/**
 * SIGNAL-CAPABILITY OF THE SUBSTRATE.
 * ------------------------------------
 * ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01-CORRECTION01 (P0-1).
 *
 * An experiment can only claim "the termination request actually
 * terminated the owned process group" when the substrate is ABLE to
 * deliver a termination signal to that group. On a host whose sandbox
 * profile grants only `(allow signal (target self))`, EVERY signal aimed
 * at another process — including a group's leader — fails with EPERM,
 * so a group that later disappears may have disappeared on its own
 * (workload completion) rather than because the supervisor terminated
 * it.
 *
 * The distinction is decisive for the cancel/deadline CONTROLS: without
 * it, a control that ends "clean" after ~the workload's natural lifetime
 * is indistinguishable from a control that was genuinely terminated.
 *
 * This probe answers the question EMPIRICALLY, by attempting a real
 * signal against a REAL process group that the probe itself created.
 * It is destructive only of a process the probe owns (`sleep`), and it
 * is confined to a private group so it can never touch a production
 * owned group.
 */
export type SignalCapability =
	/** The substrate delivered a real signal to a foreign process group. */
	| "signal_capable"
	/** The substrate refused the signal (EPERM) — termination cannot be proven. */
	| "signal_denied"
	/** The probe could not be performed at all. */
	| "unknown"

let signalCapabilityCache: SignalCapability | undefined

/**
 * Determine, ONCE per process, whether this substrate can deliver a
 * termination signal to a process group it does not belong to.
 *
 * The probe spawns a detached `sleep` (its own process group), attempts
 * `process.kill(-pgid, "SIGTERM")`, and classifies:
 *
 *   - rc=0            -> the signal was delivered -> "signal_capable"
 *   - EPERM           -> the sandbox refused it          -> "signal_denied"
 *   - any other errno -> the probe is inconclusive        -> "unknown"
 *
 * The probe child is always reaped (the group is left to exit on its
 * own if the signal was refused), so it cannot leak.
 */
export function observeSignalCapability(): SignalCapability {
	if (signalCapabilityCache) return signalCapabilityCache
	try {
		const child = spawn("/bin/sh", ["-c", "sleep 2"], { detached: true, stdio: "ignore" })
		const pgid = child.pid
		if (typeof pgid !== "number") {
			signalCapabilityCache = "unknown"
			return signalCapabilityCache
		}
		// Give the child time to establish its own process group.
		const start = Date.now()
		while (Date.now() - start < 1_000) {
			// Busy-wait briefly; the child sets its own pgid synchronously
			// during spawn on POSIX with `detached: true`.
			try {
				process.kill(-pgid, 0)
				break
			} catch (e) {
				const code = (e as NodeJS.ErrnoException).code
				if (code === "ESRCH") {
					// The group is not observable yet (or is already gone).
					// Give it one more scheduling slice before deciding.
					if (Date.now() - start > 500) break
				}
				// EPERM means the group EXISTS but is not signalable.
			}
			break
		}
		try {
			process.kill(-pgid, "SIGTERM")
			signalCapabilityCache = "signal_capable"
		} catch (e) {
			const code = (e as NodeJS.ErrnoException).code
			signalCapabilityCache = code === "EPERM" ? "signal_denied" : "unknown"
		}
		// Never leave the probe child behind: reap it explicitly. When the
		// signal was refused, the child is still alive and MUST be killed
		// — but that kill may itself be refused, in which case the
		// `sleep 2` bounds its own lifetime.
		try {
			child.kill("SIGKILL")
		} catch {
			// Refused or already gone — the sleep self-terminates.
		}
		child.unref()
		return signalCapabilityCache
	} catch {
		signalCapabilityCache = "unknown"
		return signalCapabilityCache
	}
}

/**
 * Run `ps` through `/bin/bash -c`. The absolute `ps` binaries are not
 * executable under the ClineMM Seatbelt profile, but bash is, and bash
 * can exec `ps` from PATH.
 */
function runPs(psArgs: string): string {
	return execFileSync("/bin/bash", ["-c", `ps ${psArgs}`], {
		encoding: "utf8",
		timeout: 5_000,
		maxBuffer: 4 * 1024 * 1024,
	})
}

/**
 * List the members of a process group with full identity.
 *
 * Returns an empty array when the group has no members (the group is
 * gone) or when `ps` cannot be executed in this substrate. The caller
 * distinguishes the two by combining this with `observeGroupLiveness`.
 */
export function listGroupMembers(pgid: number): ProcessMember[] {
	// `ps` PADS its fixed-width columns, so a single combined
	// `pid,ppid,pgid,stat,lstart,command` query cannot be split on
	// whitespace (the `stat` column is padded, and may even be EMPTY,
	// so it runs into the first `lstart` token).
	//
	// Two queries avoid the ambiguity entirely:
	//
	//   1. `pid,ppid,pgid,stat` — only FIXED-WIDTH numeric columns
	//      plus the (possibly empty) `stat` token. The `stat` value is
	//      taken as the token AFTER the three numeric columns, which
	//      is unambiguous because all three numeric columns are
	//      required to be present.
	//   2. `lstart` and `args` are queried PER PID, where the output
	//      is a single value with no column padding to disambiguate.
	let raw: string
	try {
		raw = runPs(`-axo pid=,ppid=,pgid=,stat=`)
	} catch {
		return []
	}
	const members: ProcessMember[] = []
	for (const line of raw.split("\n")) {
		const trimmed = line.trim()
		if (!trimmed) continue
		const tokens = trimmed.split(/\s+/)
		if (tokens.length < 3) continue
		const pid = Number(tokens[0])
		const ppid = Number(tokens[1])
		const memberPgid = Number(tokens[2])
		if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !Number.isFinite(memberPgid)) continue
		if (memberPgid !== pgid) continue
		// The `stat` token is the 4th field when it is non-empty.
		// `ps` emits it as a single character (`S`, `R`, `Z`, …) but
		// it is legitimately EMPTY for some processes (the column is
		// then pure padding, so only 3 tokens survive the split).
		const stat = tokens.length > 3 ? tokens[3] : ""
		members.push({
			pid,
			ppid,
			pgid: memberPgid,
			stat,
			startIdentity: readProcessStartIdentity(pid) ?? "",
			command: readProcessCommand(pid),
		})
	}
	return members
}

/**
 * Read the command line of a single pid (empty when it is gone).
 */
function readProcessCommand(pid: number): string {
	try {
		return runPs(`-o args= -p ${pid}`).trim().slice(0, 120)
	} catch {
		return ""
	}
}

/**
 * Read the start identity of a single pid (undefined when it is gone).
 */
export function readProcessStartIdentity(pid: number): string | undefined {
	try {
		const raw = runPs(`-o lstart= -p ${pid}`)
		const value = raw.trim()
		return value.length > 0 ? value : undefined
	} catch {
		return undefined
	}
}

/**
 * A bounded, machine-readable snapshot of one observation boundary.
 */
export type GroupObservation = {
	readonly atMs: number
	readonly pgid: number
	readonly liveness: ObservedGroupLiveness
	readonly osErrorCode: string | null
	readonly members: readonly ProcessMember[]
	/**
	 * The START IDENTITY of the original group leader, when it is still
	 * observable. Used to detect PID/PGID reuse.
	 */
	readonly leaderStartIdentity: string | undefined
}

/**
 * Capture one read-only observation boundary for `pgid`.
 */
export function observeGroup(pgid: number, leaderPid?: number): GroupObservation {
	const probe = observeGroupLiveness(pgid)
	return {
		atMs: Date.now(),
		pgid,
		liveness: probe.liveness,
		osErrorCode: probe.osErrorCode,
		members: listGroupMembers(pgid),
		leaderStartIdentity: typeof leaderPid === "number" ? readProcessStartIdentity(leaderPid) : undefined,
	}
}

/**
 * Poll the group until it is observed gone, or the deadline elapses.
 *
 * The returned `observations` are the FULL bounded timeline; the caller
 * decides what to assert on. A deadline expiry does NOT fabricate a
 * "gone" verdict — the last observation is returned as-is.
 */
export async function observeGroupUntilGone(
	pgid: number,
	leaderPid: number | undefined,
	deadlineMs: number,
	pollMs = 50,
): Promise<{ readonly observations: GroupObservation[]; readonly gone: boolean }> {
	const observations: GroupObservation[] = []
	const startedAt = Date.now()
	for (;;) {
		const observation = observeGroup(pgid, leaderPid)
		observations.push(observation)
		if (observation.liveness === "gone") return { observations, gone: true }
		if (Date.now() - startedAt >= deadlineMs) return { observations, gone: false }
		await new Promise((r) => setTimeout(r, pollMs))
	}
}

/**
 * Extract the descendant PID that a shell reported on stdout.
 *
 * The shell writes `DESC=<pid>` before exiting so the stdout pipe is
 * already flushed when the supervisor's exit promise resolves.
 */
export function readDescendantPid(stdout: string): number | undefined {
	const m = /DESC=(\d+)/.exec(stdout)
	if (!m) return undefined
	const pid = Number(m[1])
	return Number.isFinite(pid) && pid > 0 ? pid : undefined
}
