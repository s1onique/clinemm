/**
 * ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
 *
 * LIVE Darwin-kernel qualification for the POSIX-semaphore authority.
 *
 * Before this ACT, the generated Seatbelt profile carried NO
 * `(allow ipc-posix-sem)` rule, so Python's `multiprocessing.SemLock`
 * — the POSIX-semaphore-backed primitive — failed with
 * `PermissionError: [Errno 1] Operation not permitted` inside every
 * sandboxed command. Ansible's task executor forks `multiprocessing`
 * workers, so the whole Ansible task-execution path failed inside the
 * sandbox while the identical command succeeded in an ordinary terminal.
 *
 * These tests exercise the REAL `/usr/bin/sandbox-exec` binary on macOS
 * through the REAL production backend
 * (`SeatbeltSandboxBackendExperimental.prepare()`), which internally
 * calls the REAL production generator (`generateSeatbeltProfile()`).
 * No mock backend is used anywhere in this file.
 *
 * They run only on darwin AND only when the Seatbelt substrate is
 * actually available (`probeSeatbeltAvailability()`). On other
 * platforms the whole suite is SKIPPED — never silently reported as
 * passing.
 *
 * T2) The exact RED probe succeeds under the repaired production
 *     profile, and a real multiprocessing worker + queue round-trip
 *     succeeds (not just semaphore construction).
 * T3) The production command-execution path (`CommandJobManager.start()`
 *     is covered by the apps/vscode suite; here we assert the backend's
 *     prepared invocation executes a supervised command to a clean
 *     terminal state with the correct output).
 * T4) Security conservation at the KERNEL level: writes outside the
 *     authorized roots remain DENIED; authorized workspace writes still
 *     work; default network egress remains DENIED; the explicit network
 *     opt-in still ALLOWS; sensitive environment values remain
 *     sanitized; the SSH-agent authority remains opt-in; the host-helper
 *     socket authority remains gated on the network mode.
 *
 * ACT: ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
 */

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { CommandCapability, CommandInvocation } from "../types";
import { probeSeatbeltAvailability } from "./seatbelt-availability";
import { SeatbeltSandboxBackendExperimental } from "./seatbelt-backend";

const HAS_SUBSTRATE =
	process.platform === "darwin" && probeSeatbeltAvailability();

/**
 * The Python interpreter used for the live probes.
 *
 * The ACT requires "the same Python executable that launches the
 * installed Ansible". On a Nix-based host that is the ansible-core
 * interpreter (python 3.13 here); elsewhere we fall back to `python3`.
 * An ABSOLUTE path is used so the probe's sanitized environment cannot
 * silently select a different interpreter.
 */
function resolvePythonBin(): string {
	const candidates = [
		"/run/current-system/sw/bin/python3.13",
		"/usr/bin/python3",
		"/usr/local/bin/python3",
	];
	for (const c of candidates) {
		try {
			if (existsSync(c)) return c;
		} catch {
			// ignore
		}
	}
	return "python3";
}

const PYTHON_BIN = resolvePythonBin();

/** Run a prepared invocation and capture its terminal state. */
function runPrepared(prepared: {
	executable: string;
	args: readonly string[];
	cwd: string;
	env: Record<string, string>;
	envSemantics?: "overlay" | "complete";
}): { exitCode: number | null; stdout: string; stderr: string } {
	const semantics = prepared.envSemantics ?? "overlay";
	const env: Record<string, string> =
		semantics === "complete"
			? { ...prepared.env }
			: { ...(process.env as Record<string, string>), ...prepared.env };
	const result = spawnSync(prepared.executable, [...prepared.args], {
		cwd: prepared.cwd,
		env,
		stdio: ["pipe", "pipe", "pipe"],
		timeout: 60_000,
		encoding: "utf8",
	});
	return {
		exitCode: result.status,
		stdout: typeof result.stdout === "string" ? result.stdout : "",
		stderr: typeof result.stderr === "string" ? result.stderr : "",
	};
}

/** Build a capability + command for the given workspace root. */
function buildFixture(): { root: string; inside: string; outside: string } {
	const root = mkdtempSync(join(tmpdir(), "clinemm-posix-sem-test-"));
	const inside = join(root, "inside");
	const outside = join(root, "outside");
	mkdirSync(inside, { recursive: true });
	mkdirSync(outside, { recursive: true });
	return { root, inside, outside };
}

function cleanupFixture(root: string): void {
	try {
		rmSync(root, { recursive: true, force: true });
	} catch {
		// ignore
	}
}

/**
 * Prepare a REAL sandboxed invocation of the given python program.
 */
async function preparePython(
	inside: string,
	pythonCode: string,
	network: "deny" | "allow",
	environment: CommandCapability["environment"] = {
		mode: "sanitized",
		allow: [],
	},
): Promise<{
	prepared: Awaited<
		ReturnType<typeof SeatbeltSandboxBackendExperimental.prepare>
	>;
	profile: string;
}> {
	const cap: CommandCapability = {
		readonlyRoots: [],
		writableRoots: [inside],
		network,
		environment,
		cwd: inside,
	};
	const cmd: CommandInvocation = {
		executable: PYTHON_BIN,
		args: ["-c", pythonCode],
		cwd: inside,
		env: {},
	};
	const prepared = await SeatbeltSandboxBackendExperimental.prepare({
		capability: cap,
		command: cmd,
	});
	const profilePath = prepared.args[1] as string;
	const profile = readFileSync(profilePath, "utf8");
	return { prepared, profile };
}

/**
 * T2 — the EXACT RED probe from the ACT, run under the repaired
 * PRODUCTION profile on the Darwin kernel.
 */
const RED_PROBE = `
import multiprocessing as mp
import sys
print("PYTHON:", sys.executable)
s = mp.Semaphore(1)
s.acquire()
s.release()
print("POSIX_SEM_OK")
`;

describe.skipIf(!HAS_SUBSTRATE)(
	"ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01 — REAL Darwin substrate",
	() => {
		it("T2: the exact RED probe SUCCEEDS under the repaired production profile", async () => {
			const fixture = buildFixture();
			try {
				const { prepared, profile } = await preparePython(
					fixture.inside,
					RED_PROBE,
					"deny",
				);
				// The repaired production profile carries EXACTLY ONE
				// semaphore rule.
				expect(profile.split("(allow ipc-posix-sem)").length - 1).toBe(1);

				const r = runPrepared(prepared);
				expect(r.stdout).toContain("POSIX_SEM_OK");
				expect(r.stderr).not.toContain("Operation not permitted");
				expect(r.exitCode).toBe(0);

				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("T2b: a real multiprocessing worker + queue round-trip succeeds under the production profile", async () => {
			const fixture = buildFixture();
			try {
				const workerProgram = `
import multiprocessing as mp

def worker(q):
    q.put(("worker-ok", mp.current_process().name))

if __name__ == "__main__":
    ctx = mp.get_context("fork")
    q = ctx.Queue()
    procs = [ctx.Process(target=worker, args=(q,)) for _ in range(3)]
    for p in procs:
        p.start()
    results = [q.get(timeout=30) for _ in range(3)]
    for p in procs:
        p.join(timeout=30)
    codes = [p.exitcode for p in procs]
    print("QUEUE_RESULTS:", results)
    print("EXIT_CODES:", codes)
    assert all(c == 0 for c in codes), codes
    print("MP_WORKER_QUEUE_OK")
`;
				const { prepared } = await preparePython(
					fixture.inside,
					workerProgram,
					"deny",
				);
				const r = runPrepared(prepared);
				expect(r.stdout).toContain("MP_WORKER_QUEUE_OK");
				expect(r.stdout).toContain("QUEUE_RESULTS:");
				expect(r.stdout).toContain("worker-ok");
				expect(r.stderr).not.toContain("Operation not permitted");
				expect(r.exitCode).toBe(0);

				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("T3: the prepared production invocation reaches a clean terminal state with the correct output", async () => {
			const fixture = buildFixture();
			try {
				const { prepared } = await preparePython(
					fixture.inside,
					`print("TERMINAL_STATE_OK")`,
					"deny",
				);
				// The production launch mechanism is preserved: the
				// prepared executable is /usr/bin/sandbox-exec and the
				// profile is passed via `-f`.
				expect(prepared.executable).toBe("/usr/bin/sandbox-exec");
				expect(prepared.args[0]).toBe("-f");
				expect(prepared.args[2]).toBe(PYTHON_BIN);

				const r = runPrepared(prepared);
				expect(r.exitCode).toBe(0);
				expect(r.stdout).toContain("TERMINAL_STATE_OK");
				expect(r.stderr).toBe("");

				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("T4-a: writes OUTSIDE the authorized roots remain DENIED at the kernel level", async () => {
			const fixture = buildFixture();
			const sentinel = join(fixture.outside, "must-not-exist.txt");
			try {
				const { prepared } = await preparePython(
					fixture.inside,
					`
import sys
try:
    with open(${JSON.stringify(sentinel)}, "w") as f:
        f.write("leak")
    print("WRITE_UNEXPECTEDLY_ALLOWED")
    sys.exit(0)
except OSError as e:
    print("WRITE_DENIED errno=%d" % e.errno)
    sys.exit(7)
`,
					"deny",
				);
				const r = runPrepared(prepared);
				expect(r.stdout).toContain("WRITE_DENIED");
				expect(r.stdout).not.toContain("WRITE_UNEXPECTEDLY_ALLOWED");
				expect(r.exitCode).toBe(7);
				// The file must NOT exist on the host.
				expect(existsSync(sentinel)).toBe(false);

				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("T4-b: authorized workspace writes continue to WORK at the kernel level", async () => {
			const fixture = buildFixture();
			const target = join(fixture.inside, "authorized.txt");
			try {
				const { prepared } = await preparePython(
					fixture.inside,
					`
with open(${JSON.stringify(target)}, "w") as f:
    f.write("authorized-write-ok")
print("WRITE_OK")
`,
					"deny",
				);
				const r = runPrepared(prepared);
				expect(r.stdout).toContain("WRITE_OK");
				expect(r.exitCode).toBe(0);
				expect(existsSync(target)).toBe(true);
				expect(readFileSync(target, "utf8")).toContain("authorized-write-ok");

				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("T4-c: default network egress remains DENIED at the kernel level", async () => {
			const fixture = buildFixture();
			try {
				const { prepared } = await preparePython(
					fixture.inside,
					`
import socket, sys
s = socket.socket()
s.settimeout(5)
try:
    s.connect(("1.1.1.1", 53))
except OSError as e:
    print("NETWORK_DENIED errno=%d" % e.errno)
    sys.exit(7)
print("NETWORK_UNEXPECTEDLY_ALLOWED")
sys.exit(0)
`,
					"deny",
				);
				const r = runPrepared(prepared);
				expect(r.stdout).toContain("NETWORK_DENIED");
				expect(r.stdout).not.toContain("NETWORK_UNEXPECTEDLY_ALLOWED");
				expect(r.exitCode).toBe(7);

				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("T4-d: the explicit network opt-in still ALLOWS egress (behavior unchanged)", async () => {
			const fixture = buildFixture();
			try {
				const { prepared, profile } = await preparePython(
					fixture.inside,
					`
import socket, sys
s = socket.socket()
s.settimeout(5)
try:
    s.connect(("1.1.1.1", 53))
except OSError as e:
    print("NETWORK_ALLOW_FAILED errno=%d" % e.errno)
    sys.exit(1)
print("NETWORK_ALLOW_OK")
sys.exit(0)
`,
					"allow",
				);
				// The opt-in profile carries the allow rule and STILL
				// carries exactly one semaphore rule.
				expect(profile).toContain("(allow network*)");
				expect(profile).not.toContain("(deny network*)");
				expect(profile.split("(allow ipc-posix-sem)").length - 1).toBe(1);

				const r = runPrepared(prepared);
				expect(r.stdout).toContain("NETWORK_ALLOW_OK");
				expect(r.exitCode).toBe(0);

				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("T4-e: sensitive environment values remain sanitized", async () => {
			const fixture = buildFixture();
			const secret = "SHOULD-NOT-LEAK-9f2b1c";
			const names = [
				"AWS_SECRET_ACCESS_KEY",
				"AWS_ACCESS_KEY_ID",
				"OPENAI_API_KEY",
				"ANTHROPIC_API_KEY",
			];
			// CORRECTION (review C1 P1): the synthetic secrets MUST exist
			// in the parent environment BEFORE the backend materializes
			// the child environment. The backend reads `process.env` at
			// `prepare()` time (via `materializeEnvironment`), so
			// injecting the secrets AFTER `prepare()` would prove
			// nothing: the child env would have been built from a parent
			// env that never contained them.
			//
			// The secrets are therefore installed first, `prepare()` runs
			// second, the child is executed third, and the parent env is
			// restored last.
			const prev = names.map((k) => [k, process.env[k]] as const);
			for (const k of names) process.env[k] = secret;
			try {
				const { prepared } = await preparePython(
					fixture.inside,
					`
import os
for name in ("AWS_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
    print(name + "=[" + os.environ.get(name, "<unset>") + "]")
`,
					"deny",
					{ mode: "sanitized", allow: [] },
				);

				// PRE-CONDITION (proof that the test is meaningful): the
				// parent env MUST still carry the secrets (so the
				// sanitization had something to strip), and the
				// materialized child env MUST NOT carry the secret
				// VALUES.
				//
				// NOTE: the backend's defensive filter sets a blocked key
				// to the EMPTY STRING rather than deleting it (see
				// `materializeEnvironment`, the `SECRET_BLOCKLIST` loop).
				// So the assertion is on the VALUE, not on key absence.
				for (const name of names) {
					expect(process.env[name]).toBe(secret);
					expect(prepared.env[name]).not.toBe(secret);
					expect(prepared.env[name] ?? "").toBe("");
				}

				// The ACTUAL sandboxed child must observe the variables
				// with NO secret value.
				//
				// The backend's defensive `SECRET_BLOCKLIST` filter sets a
				// blocked key to the EMPTY STRING rather than removing
				// it, so the child observes `NAME=[]` — the variable is
				// present but carries no value. The load-bearing
				// assertion is that the SECRET VALUE is absent.
				const r = runPrepared(prepared);
				expect(r.stdout).not.toContain(secret);
				for (const name of names) {
					expect(r.stdout).toContain(`${name}=[]`);
				}
				expect(r.exitCode).toBe(0);

				await prepared.cleanup?.();
			} finally {
				for (const [k, v] of prev) {
					if (v === undefined) delete process.env[k];
					else process.env[k] = v;
				}
				cleanupFixture(fixture.root);
			}
		});

		it("T4-f: the SSH-agent authority remains opt-in (no AF_UNIX rule without the agent authority)", async () => {
			const fixture = buildFixture();
			try {
				const { prepared, profile } = await preparePython(
					fixture.inside,
					`print("OK")`,
					"deny",
				);
				// No ssh-agent / host-helper AF_UNIX authority was
				// requested, so the profile must NOT carry one.
				expect(profile).not.toContain("AF_UNIX");
				expect(profile).not.toContain("system-socket");
				// The semaphore rule is present and is the ONLY ipc rule.
				expect(profile.split("(allow ipc-posix-sem)").length - 1).toBe(1);
				expect(profile.match(/\(allow ipc-[a-z0-9-]+\)/g)).toEqual([
					"(allow ipc-posix-sem)",
				]);

				await prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});

		it("T4-g: the host-helper socket authority remains gated on the network mode", async () => {
			const fixture = buildFixture();
			try {
				const deny = await preparePython(fixture.inside, `print("OK")`, "deny");
				const allow = await preparePython(
					fixture.inside,
					`print("OK")`,
					"allow",
				);
				// network:deny  => NO host-helper AF_UNIX rule.
				expect(deny.profile).not.toContain("host-helper.sock");
				// network:allow => the host-helper AF_UNIX rule MAY be
				// present (the endpoint is resolved by the backend, not
				// by this ACT). Either way, the semaphore rule count is
				// 1 in both.
				expect(deny.profile.split("(allow ipc-posix-sem)").length - 1).toBe(1);
				expect(allow.profile.split("(allow ipc-posix-sem)").length - 1).toBe(1);

				await deny.prepared.cleanup?.();
				await allow.prepared.cleanup?.();
			} finally {
				cleanupFixture(fixture.root);
			}
		});
	},
);
