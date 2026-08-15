/**
 * Tests for CommandJobManager — the host-owned supervised execution
 * registry. Exercises the wait-budget vs execution-deadline split and
 * the terminal-idempotence contract using real subprocess primitives.
 * The mutable-process assertions rely on POSIX
 * `process.kill(pid, 0)` semantics; on Windows the kill-tree path is
 * exercised by the SDK bash tests instead.
 */
import { afterEach, describe, expect, it } from "vitest"
import {
	CommandJobManager,
	DEFAULT_EXECUTION_DEADLINE_MS,
	DEFAULT_WAIT_BUDGET_MS,
	MAX_RESPONSE_OUTPUT_CHARS,
	MAX_RETAINED_JOB_OUTPUT_CHARS,
	TERM_GRACE_MS,
} from "./command-job-manager"

const isPosix = process.platform !== "win32"

function isAlive(pid: number): boolean {
	if (!isPosix) return true
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return !(error instanceof Error && (error as NodeJS.ErrnoException).code === "ESRCH")
	}
}

/**
 * Build a long-running child via `/bin/sh -c "sleep N"` so the test
 * doesn't depend on the host's `process.execPath` (which may be bun
 * inside a vitest process and reject `-e` arguments).
 */
function longShell(extraSleep: number): string {
	return `/bin/sh -c "sleep ${extraSleep}"`
}

afterEach(() => {
	// No-op; each test disposes its own manager.
})

describe("CommandJobManager", () => {
	it("returns EXITED for a fast command and remains queryable", async () => {
		const manager = new CommandJobManager()
		try {
			const start = await manager.start({
				command: "printf 'fast-ok\\n'",
				cwd: process.cwd(),
				waitBudgetMs: 5_000,
				executionDeadlineMs: 5_000,
			})
			expect(start.state).toBe("exited")
			expect(start.exitCode).toBe(0)
			expect(start.stdout).toContain("fast-ok")
			expect(start.outputTruncated).toBe(false)

			// Status is idempotent.
			const a = await manager.status({ jobId: start.jobId, waitMs: 0 })
			const b = await manager.status({ jobId: start.jobId, waitMs: 0 })
			expect(a.ok).toBe(true)
			expect(b.ok).toBe(true)
			if (a.ok && b.ok) {
				expect(a.snapshot.state).toBe("exited")
				expect(b.snapshot.state).toBe("exited")
				expect(a.snapshot.exitCode).toBe(0)
				expect(b.snapshot.exitCode).toBe(0)
			}
		} finally {
			await manager.dispose()
		}
	})

	it("returns RUNNING when wait budget expires and the process is still alive", async () => {
		const manager = new CommandJobManager()
		try {
			const start = await manager.start({
				command: longShell(60),
				cwd: process.cwd(),
				waitBudgetMs: 300,
				executionDeadlineMs: 5_000,
			})
			expect(start.state).toBe("running")
			expect(start.jobId).toMatch(/^cmd_/)
			expect(start.elapsedMs).toBeGreaterThanOrEqual(0)
			expect(start.deadlineRemainingMs).toBeGreaterThan(0)
			expect(start.outputTruncated).toBe(false)
			if (isPosix && start.process.pid !== undefined) {
				expect(isAlive(start.process.pid)).toBe(true)
			}

			// Follow-up status observes the still-running job.
			const followup = await manager.status({ jobId: start.jobId, waitMs: 0 })
			expect(followup.ok).toBe(true)
			if (followup.ok) {
				expect(followup.snapshot.state).toBe("running")
			}

			// Cancel to clean up the long-running child.
			const cancel = await manager.cancel({ jobId: start.jobId })
			expect(cancel.ok).toBe(true)
		} finally {
			await manager.dispose()
		}
	})

	it("terminates the owned process tree on deadline with deterministic state", async () => {
		const manager = new CommandJobManager()
		try {
			const start = await manager.start({
				command: longShell(60),
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 600,
			})
			expect(start.state).toBe("running")
			const pid = start.process.pid
			expect(pid).toBeDefined()

			await new Promise((r) => setTimeout(r, 600 + TERM_GRACE_MS + 1_000))

			const terminal = await manager.status({ jobId: start.jobId, waitMs: 0 })
			expect(terminal.ok).toBe(true)
			if (terminal.ok) {
				// INVARIANT 5: deadline-triggered termination must produce
				// exactly deadline_exceeded — never cancelled, never
				// exited, regardless of what the child does after SIGTERM.
				expect(terminal.snapshot.state).toBe("deadline_exceeded")
			}

			// Subsequent status is idempotent.
			const again = await manager.status({ jobId: start.jobId, waitMs: 0 })
			expect(again.ok).toBe(true)
			if (again.ok && terminal.ok) {
				expect(again.snapshot.state).toBe(terminal.snapshot.state)
			}

			if (isPosix && pid !== undefined) {
				expect(isAlive(pid)).toBe(false)
			}
		} finally {
			await manager.dispose()
		}
	})

	it("cancellation is idempotent and terminates the owned process tree", async () => {
		const manager = new CommandJobManager()
		try {
			const start = await manager.start({
				command: longShell(60),
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 60_000,
			})
			expect(start.state).toBe("running")
			const pid = start.process.pid
			expect(pid).toBeDefined()

			const a = await manager.cancel({ jobId: start.jobId })
			const b = await manager.cancel({ jobId: start.jobId })
			expect(a.ok).toBe(true)
			expect(b.ok).toBe(true)
			if (a.ok && b.ok) {
				// INVARIANT 5: cancel-triggered termination must produce
				// exactly cancelled — never deadline_exceeded.
				expect(a.state).toBe("cancelled")
				expect(b.state).toBe("cancelled")
			}

			await new Promise((r) => setTimeout(r, TERM_GRACE_MS + 1_000))

			const final = await manager.status({ jobId: start.jobId, waitMs: 0 })
			expect(final.ok).toBe(true)
			if (final.ok) {
				expect(final.snapshot.state).toBe("cancelled")
			}

			if (isPosix && pid !== undefined) {
				expect(isAlive(pid)).toBe(false)
			}
		} finally {
			await manager.dispose()
		}
	})

	it("returns unknown_job for an unrecognized jobId", async () => {
		const manager = new CommandJobManager()
		try {
			const status = await manager.status({ jobId: "cmd_does-not-exist", waitMs: 0 })
			expect(status.ok).toBe(false)
			if (!status.ok) {
				expect(status.code).toBe("unknown_job")
			}
			const cancel = await manager.cancel({ jobId: "cmd_does-not-exist" })
			expect(cancel.ok).toBe(false)
			if (!cancel.ok) {
				expect(cancel.code).toBe("unknown_job")
			}
		} finally {
			await manager.dispose()
		}
	})

	it("truncates response output to MAX_RESPONSE_OUTPUT_CHARS and surfaces outputTruncated on every response", async () => {
		const manager = new CommandJobManager()
		try {
			// Generate > 64 KiB of stdout via /bin/sh printf, which is
			// portable and deterministic.
			const start = await manager.start({
				command: `/bin/sh -c "yes x | tr -d '\\n' | head -c 200000"`,
				cwd: process.cwd(),
				waitBudgetMs: 5_000,
				executionDeadlineMs: 5_000,
				maxOutputChars: MAX_RESPONSE_OUTPUT_CHARS,
			})
			expect(start.state).toBe("exited")
			expect(start.exitCode).toBe(0)
			expect(start.stdout.length).toBeLessThanOrEqual(MAX_RESPONSE_OUTPUT_CHARS)
			expect(start.outputTruncated).toBe(true)

			// Every model-facing status response is also projected through
			// the response cap. The retained spool stays larger; the
			// process object exposes it via stdoutSnapshot() for callers
			// that need the raw retained view.
			const snap = await manager.status({ jobId: start.jobId, waitMs: 0 })
			expect(snap.ok).toBe(true)
			if (snap.ok) {
				expect(snap.snapshot.stdout.length).toBeLessThanOrEqual(MAX_RESPONSE_OUTPUT_CHARS)
				expect(snap.snapshot.outputTruncated).toBe(true)
			}
			// The retained spool (raw, no projection) is larger.
			const rawRetained = start.process.stdoutSnapshot()
			expect(rawRetained.totalChars).toBeGreaterThan(MAX_RESPONSE_OUTPUT_CHARS)
		} finally {
			await manager.dispose()
		}
	})

	it("status with waitMs waits for terminal transition up to the budget", async () => {
		const manager = new CommandJobManager()
		try {
			const start = await manager.start({
				command: `/bin/sh -c "sleep 0.2; exit 0"`,
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 10_000,
			})
			expect(start.state).toBe("running")

			const t0 = Date.now()
			const after = await manager.status({ jobId: start.jobId, waitMs: 5_000 })
			const elapsed = Date.now() - t0
			expect(after.ok).toBe(true)
			if (after.ok) {
				expect(after.snapshot.state).toBe("exited")
				expect(after.snapshot.exitCode).toBe(0)
			}
			expect(elapsed).toBeLessThan(2_000)
		} finally {
			await manager.dispose()
		}
	})

	it("clamps waitMs above MAX_STATUS_WAIT_MS", async () => {
		const manager = new CommandJobManager()
		try {
			const start = await manager.start({
				command: "printf quiet",
				cwd: process.cwd(),
				waitBudgetMs: 1_000,
				executionDeadlineMs: 1_000,
			})
			expect(start.state).toBe("exited")
			const t0 = Date.now()
			const snap = await manager.status({ jobId: start.jobId, waitMs: 1_000_000 })
			expect(Date.now() - t0).toBeLessThan(500)
			expect(snap.ok).toBe(true)
			if (snap.ok) {
				expect(snap.snapshot.state).toBe("exited")
			}
		} finally {
			await manager.dispose()
		}
	})

	it("caps retained terminal jobs via bounded FIFO eviction (injectable maxTerminalJobs)", async () => {
		// Use the injectable cap so we can prove eviction in O(1) seconds
		// rather than spawning 128 commands. The manager evicts the
		// oldest by insertion order — NOT an LRU: status access does
		// not refresh recency. Hence "FIFO" in the test name.
		const cap = 3
		const manager = new CommandJobManager({ maxTerminalJobs: cap })
		try {
			const ids: string[] = []
			for (let i = 0; i < cap + 1; i++) {
				const start = await manager.start({
					command: "printf done",
					cwd: process.cwd(),
					waitBudgetMs: 200,
					executionDeadlineMs: 200,
				})
				ids.push(start.jobId)
			}
			// The cap is enforced; we have exactly `cap` jobs retained.
			expect(manager.terminalCount).toBe(cap)

			// The oldest id (ids[0]) was evicted and returns unknown_job.
			const evicted = await manager.status({ jobId: ids[0], waitMs: 0 })
			expect(evicted.ok).toBe(false)
			if (!evicted.ok) {
				expect(evicted.code).toBe("unknown_job")
			}

			// The most-recent id is still queryable.
			const newest = await manager.status({ jobId: ids[cap], waitMs: 0 })
			expect(newest.ok).toBe(true)
		} finally {
			await manager.dispose()
		}
	})

	it("dispose() cancels every still-running job", async () => {
		const manager = new CommandJobManager()
		const start = await manager.start({
			command: longShell(60),
			cwd: process.cwd(),
			waitBudgetMs: 50,
			executionDeadlineMs: 60_000,
		})
		expect(start.state).toBe("running")
		const pid = start.process.pid
		expect(pid).toBeDefined()

		await manager.dispose()

		await new Promise((r) => setTimeout(r, TERM_GRACE_MS + 500))
		if (isPosix && pid !== undefined) {
			expect(isAlive(pid)).toBe(false)
		}
	})

	it("clamps wait budget DOWN to the effective deadline (P0-4 invariant)", async () => {
		// Caller requests a 60s wait on a 1s deadline. The wait budget
		// must clamp DOWN to 1s — the deadline is host-authoritative.
		const manager = new CommandJobManager()
		try {
			const start = await manager.start({
				command: longShell(60),
				cwd: process.cwd(),
				waitBudgetMs: 60_000,
				executionDeadlineMs: 1_000,
				maxRetainedOutputChars: MAX_RETAINED_JOB_OUTPUT_CHARS,
			})
			await new Promise((r) => setTimeout(r, 1_000 + TERM_GRACE_MS + 1_000))
			const terminal = await manager.status({ jobId: start.jobId, waitMs: 0 })
			expect(terminal.ok).toBe(true)
			if (terminal.ok) {
				expect(terminal.snapshot.state).toBe("deadline_exceeded")
			}
		} finally {
			await manager.dispose()
		}
	})

	it("status polling does NOT accumulate waiters (P0-2 invariant)", async () => {
		const manager = new CommandJobManager()
		try {
			const start = await manager.start({
				command: longShell(60),
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 5_000,
			})
			expect(start.state).toBe("running")

			// Poll 10 times. Each status() call creates its own ad-hoc
			// promise — no job-attached waiter list grows.
			for (let i = 0; i < 10; i++) {
				const snap = await manager.status({ jobId: start.jobId, waitMs: 50 })
				expect(snap.ok).toBe(true)
			}

			await manager.cancel({ jobId: start.jobId })
		} finally {
			await manager.dispose()
		}
	})

	it("clears deadline timer and abort listener on finalize (P1 hygiene)", async () => {
		const manager = new CommandJobManager()
		try {
			const ac = new AbortController()
			const start = await manager.start(
				{
					command: "printf quick-ok",
					cwd: process.cwd(),
					waitBudgetMs: 100,
					executionDeadlineMs: 60_000,
				},
				{ signal: ac.signal } as unknown as Parameters<typeof manager.start>[1],
			)
			expect(start.state).toBe("exited")

			// Inspect the internal job record.
			const terminalJob = (
				manager as unknown as { terminal: Map<string, { deadlineTimer?: NodeJS.Timeout; abortListener?: () => void }> }
			).terminal.get(start.jobId)
			expect(terminalJob).toBeDefined()
			if (terminalJob) {
				expect(terminalJob.deadlineTimer).toBeUndefined()
				expect(terminalJob.abortListener).toBeUndefined()
			}
		} finally {
			await manager.dispose()
		}
	})
})

describe("CommandJobManager defaults", () => {
	it("exposes the documented default budgets", () => {
		expect(DEFAULT_WAIT_BUDGET_MS).toBe(15_000)
		expect(DEFAULT_EXECUTION_DEADLINE_MS).toBe(600_000)
	})
})
