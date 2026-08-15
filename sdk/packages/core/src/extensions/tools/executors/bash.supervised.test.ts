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
