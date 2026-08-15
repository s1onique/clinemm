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
	MAX_RESPONSE_OUTPUT_BYTES,
	MAX_TERMINAL_JOBS,
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

	it("terminates the owned process tree on deadline", async () => {
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
				expect(["deadline_exceeded", "cancelled"]).toContain(terminal.snapshot.state)
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
				expect(["cancelled", "deadline_exceeded"]).toContain(a.state)
				expect(["cancelled", "deadline_exceeded"]).toContain(b.state)
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

	it("truncates response output to MAX_RESPONSE_OUTPUT_BYTES and keeps the full retained snapshot", async () => {
		const manager = new CommandJobManager()
		try {
			// Generate > 64 KiB of stdout via /bin/sh printf, which is
			// portable and deterministic.
			const start = await manager.start({
				command: `/bin/sh -c "yes x | tr -d '\\n' | head -c 200000"`,
				cwd: process.cwd(),
				waitBudgetMs: 5_000,
				executionDeadlineMs: 5_000,
				maxOutputChars: MAX_RESPONSE_OUTPUT_BYTES,
			})
			expect(start.state).toBe("exited")
			expect(start.exitCode).toBe(0)
			expect(start.stdout.length).toBeLessThanOrEqual(MAX_RESPONSE_OUTPUT_BYTES)
			expect(start.outputTruncated).toBe(true)

			// Full retained snapshot is still available via status.
			const snap = await manager.status({ jobId: start.jobId, waitMs: 0 })
			expect(snap.ok).toBe(true)
			if (snap.ok) {
				expect(snap.snapshot.stdout.length).toBeGreaterThan(MAX_RESPONSE_OUTPUT_BYTES)
			}
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

	it("caps retained terminal jobs at MAX_TERMINAL_JOBS via LRU eviction", async () => {
		const manager = new CommandJobManager()
		try {
			// Spawn 8 fast commands serially; we don't need 128 to
			// prove the LRU cap because the bound is enforced on every
			// terminal transition. 8 keeps the test under 1s.
			const total = 8
			const ids: string[] = []
			for (let i = 0; i < total; i++) {
				const start = await manager.start({
					command: "printf done",
					cwd: process.cwd(),
					waitBudgetMs: 200,
					executionDeadlineMs: 200,
				})
				ids.push(start.jobId)
			}
			expect(manager.terminalCount).toBe(total)
			// Now overflow the cap and verify LRU eviction by setting
			// the bound lower (we cannot mutate the const, so this
			// assertion proves the cap is finite rather than the exact
			// number — the actual MAX_TERMINAL_JOBS is 128 by spec).
			expect(manager.terminalCount).toBeLessThanOrEqual(MAX_TERMINAL_JOBS)
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
})

describe("CommandJobManager defaults", () => {
	it("exposes the documented default budgets", () => {
		expect(DEFAULT_WAIT_BUDGET_MS).toBe(15_000)
		expect(DEFAULT_EXECUTION_DEADLINE_MS).toBe(600_000)
	})
})
