import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	formatShellProcessOutput,
	spawnSupervisableShellCommand,
} from "./bash";

describe("spawnSupervisableShellCommand", () => {
	it("returns a process that exits naturally without an internal timer killing it", async () => {
		const proc = spawnSupervisableShellCommand({
			executable: process.execPath,
			args: ["-e", "process.stdout.write('hello'); process.exit(0)"],
			cwd: process.cwd(),
			env: {},
		});
		const result = await proc.exit;
		expect(result.exitCode).toBe(0);
		// Natural exit; killTree is a no-op after natural exit.
		await proc.killTree();
		const formatted = formatShellProcessOutput(
			proc,
			result.exitCode,
			1024,
			true,
		);
		expect(formatted.ok).toBe(true);
		if (formatted.ok) {
			expect(formatted.output).toContain("hello");
		}
	});

	it("does NOT kill the child when the caller ignores it for longer than a typical bash-executor timeout", async () => {
		const proc = spawnSupervisableShellCommand({
			executable: process.execPath,
			args: ["-e", "setTimeout(() => process.exit(0), 800)"],
			cwd: process.cwd(),
			env: {},
		});
		// Wait 200ms — well past any 30s threshold for our test, but
		// no internal timer is active, so the process is still alive.
		await new Promise((r) => setTimeout(r, 200));
		if (proc.pid !== undefined && process.platform !== "win32") {
			let alive = true;
			try {
				process.kill(proc.pid, 0);
			} catch {
				alive = false;
			}
			expect(alive).toBe(true);
		}
		const result = await proc.exit;
		expect(result.exitCode).toBe(0);
	});

	it("killTree() terminates the owned process tree", async () => {
		const proc = spawnSupervisableShellCommand({
			executable: process.execPath,
			args: ["-e", "setInterval(() => {}, 200)"],
			cwd: process.cwd(),
			env: {},
		});
		const pid = proc.pid;
		expect(pid).toBeDefined();
		await proc.killTree();
		// Wait briefly for the OS to reap.
		await new Promise((r) => setTimeout(r, 100));
		if (pid !== undefined && process.platform !== "win32") {
			let alive = true;
			try {
				process.kill(pid, 0);
			} catch {
				alive = false;
			}
			expect(alive).toBe(false);
		}
	});

	it("killTree() is idempotent", async () => {
		const proc = spawnSupervisableShellCommand({
			executable: process.execPath,
			args: ["-e", "setInterval(() => {}, 200)"],
			cwd: process.cwd(),
			env: {},
		});
		await proc.killTree();
		await proc.killTree();
		await proc.killTree();
		// No assertion needed beyond the call completing without throwing.
	});
});

describe("terminateTree (CORRECTION03: process-tree supervision)", () => {
	const probeAlive = (pid: number): boolean => {
		try {
			process.kill(pid, 0);
			return true;
		} catch (err: unknown) {
			return (err as NodeJS.ErrnoException).code === "EPERM";
		}
	};

	it("gracefully terminates a cooperative tree (no SIGKILL needed)", async () => {
		const proc = spawnSupervisableShellCommand({
			executable: process.execPath,
			args: [
				"-e",
				`process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 200);`,
			],
			cwd: process.cwd(),
			env: {},
		});
		const pid = proc.pid;
		expect(pid).toBeDefined();
		const result = await proc.terminateTree({
			gracefulSignal: "SIGTERM",
			graceMs: 2_000,
		});
		expect(result.treeTerminated).toBe(true);
		expect(result.escalatedToKill).toBe(false);
		if (pid !== undefined) {
			await new Promise((r) => setTimeout(r, 50));
			expect(probeAlive(pid)).toBe(false);
		}
	});

	it("kills a SIGTERM-IGNORING descendant in the owned PG (CORRECTION03 P0)", async () => {
		// POSIX fixture: spawn a shell that starts a child which
		// ignores SIGTERM and sleeps long enough to outlive the
		// grace window. The child records its own PID into a
		// file we can probe afterwards. Without terminateTree,
		// the shell would exit on SIGTERM and the descendant
		// would survive indefinitely. With it, the SIGKILL
		// escalation kills the whole PG.
		const tempDir = await mkdtemp(join(tmpdir(), "tbce-tree-"));
		const childPidPath = join(tempDir, "child.pid");
		try {
			const proc = spawnSupervisableShellCommand({
				executable: "/bin/sh",
				args: [
					"-c",
					`/bin/sh -c 'echo $$ > "${childPidPath}"; trap "" TERM; sleep 30' & wait`,
				],
				cwd: process.cwd(),
				env: {},
			});
			let childPid: number | undefined;
			await expect
				.poll(
					() =>
						readFile(childPidPath, "utf8")
							.then(Number)
							.catch(() => undefined),
					{
						timeout: 5_000,
					},
				)
				.toBeDefined();
			childPid = await readFile(childPidPath, "utf8").then(Number);
			expect(childPid).toBeGreaterThan(0);
			expect(probeAlive(childPid)).toBe(true);
			const result = await proc.terminateTree({
				gracefulSignal: "SIGTERM",
				graceMs: 1_000,
			});
			expect(result.treeTerminated).toBe(true);
			expect(result.escalatedToKill).toBe(true);
			await new Promise((r) => setTimeout(r, 100));
			expect(probeAlive(childPid)).toBe(false);
			if (proc.pid !== undefined) {
				expect(probeAlive(proc.pid)).toBe(false);
			}
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it("is idempotent (concurrent terminateTree shares a single flow)", async () => {
		const proc = spawnSupervisableShellCommand({
			executable: process.execPath,
			args: ["-e", "setInterval(() => {}, 200)"],
			cwd: process.cwd(),
			env: {},
		});
		const a = proc.terminateTree({ gracefulSignal: "SIGTERM", graceMs: 1_000 });
		const b = proc.terminateTree({ gracefulSignal: "SIGTERM", graceMs: 1_000 });
		const [ra, rb] = await Promise.all([a, b]);
		expect(ra).toEqual(rb);
		expect(ra.treeTerminated).toBe(true);
	});
});
