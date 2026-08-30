// ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01 — observer
// implementation tests T1..T6.
//
// Skipped on non-darwin (no Seatbelt substrate).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
	type CommandCapability,
	type CommandInvocation,
	getSeatbeltDiagnosticObserver,
	probeSeatbeltAvailability,
	type SandboxBackendDiagnosticObserver,
	type SandboxPreparedInvocation,
	SANDBOX_EXEC_PATH,
	SeatbeltSandboxBackendExperimental,
	setSeatbeltDiagnosticObserver,
} from "@cline/core"

const HAS_SUBSTRATE =
	process.platform === "darwin" && probeSeatbeltAvailability()

function buildFixture(): { inside: string; outside: string; root: string } {
	const root = mkdtempSync(join(tmpdir(), "clinemm-observer-test-"))
	const inside = join(root, "inside")
	const outside = join(root, "outside")
	mkdirSync(inside, { recursive: true })
	mkdirSync(outside, { recursive: true })
	writeFileSync(join(inside, "read.txt"), "inside-readable\n")
	writeFileSync(join(outside, "secret.txt"), "TOP-SECRET\n")
	return { inside, outside, root }
}

function cleanupFixture(root: string): void {
	try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
}

describe.skipIf(!HAS_SUBSTRATE)(
	"ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01 — observer",
	() => {
		// Singleton observer slot MUST be reset between tests.
		afterEach(() => {
			setSeatbeltDiagnosticObserver(null)
		})

		it("T1: observer unset produces no callbacks and unchanged prepared invocation", async () => {
			setSeatbeltDiagnosticObserver(null)
			expect(getSeatbeltDiagnosticObserver()).toBeUndefined()

			const fixture = buildFixture()
			try {
				const cap: CommandCapability = {
					readonlyRoots: [fixture.inside],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				}
				const cmd: CommandInvocation = {
					executable: "/bin/echo",
					args: ["hello"],
					cwd: fixture.inside,
					env: {},
				}
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
					capability: cap,
					command: cmd,
				})
				expect(prepared.executable).toBe(SANDBOX_EXEC_PATH)
				expect(prepared.args[0]).toBe("-f")
				expect(prepared.args[2]).toBe("/bin/echo")
				expect(prepared.args[3]).toBe("hello")
				await prepared.cleanup?.()
			} finally {
				cleanupFixture(fixture.root)
			}
		})

		it("T2+T3+T4+T5: observer enabled captures all three seams in order", async () => {
			const calls: Array<{ name: string; ts: number }> = []
			const events: Array<Record<string, unknown>> = []

			const observer: SandboxBackendDiagnosticObserver = {
				onPrepareInput(input) {
					calls.push({ name: "onPrepareInput", ts: Date.now() })
					events.push({
						event: "onPrepareInput",
						capabilityNetwork: input.capability.network,
						commandExecutable: input.command.executable,
					})
				},
				onProfileWritten(info) {
					calls.push({ name: "onProfileWritten", ts: Date.now() })
					events.push({
						event: "onProfileWritten",
						profilePath: info.profilePath,
						sha256: info.sha256,
						networkRule: info.networkRule,
					})
				},
				onInvocationPrepared(info) {
					calls.push({ name: "onInvocationPrepared", ts: Date.now() })
					events.push({
						event: "onInvocationPrepared",
						executable: info.prepared.executable,
						args: info.prepared.args,
					})
				},
			}
			setSeatbeltDiagnosticObserver(observer)

			const fixture = buildFixture()
			try {
				const cap: CommandCapability = {
					readonlyRoots: [fixture.inside],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				}
				const cmd: CommandInvocation = {
					executable: "/bin/echo",
					args: ["hello"],
					cwd: fixture.inside,
					env: {},
				}
				const prepared: SandboxPreparedInvocation =
					await SeatbeltSandboxBackendExperimental.prepare({
						capability: cap,
						command: cmd,
					})

				// T5: callback ordering.
				expect(calls.map((c) => c.name)).toEqual([
					"onPrepareInput",
					"onProfileWritten",
					"onInvocationPrepared",
				])

				// T2: onPrepareInput sees the real capability.network.
				const prepareEvent = events.find((e) => e.event === "onPrepareInput")!
				expect(prepareEvent.capabilityNetwork).toBe("allow")
				expect(prepareEvent.commandExecutable).toBe("/bin/echo")

				// T3: onProfileWritten receives real path + sha256 + rule.
				const profileEvent = events.find((e) => e.event === "onProfileWritten")!
				const profilePath = profileEvent.profilePath as string
				expect(existsSync(profilePath)).toBe(true)
				const bytes = readFileSync(profilePath, "utf8")
				const onDiskSha = createHash("sha256").update(bytes, "utf8").digest("hex")
				expect(profileEvent.sha256).toBe(onDiskSha)
				expect(profileEvent.networkRule).toBe("(allow network*)")

				// T4: onInvocationPrepared references the exact profilePath.
				const invocationEvent = events.find((e) => e.event === "onInvocationPrepared")!
				expect(invocationEvent.executable).toBe(SANDBOX_EXEC_PATH)
				expect((invocationEvent.args as string[])[0]).toBe("-f")
				expect((invocationEvent.args as string[])[1]).toBe(profilePath)

				await prepared.cleanup?.()
			} finally {
				cleanupFixture(fixture.root)
			}
		})

		it("T5-deny: network=deny → extracted rule is '(deny network*)'", async () => {
			let capturedRule: string | undefined
			setSeatbeltDiagnosticObserver({
				onProfileWritten(info) {
					capturedRule = info.networkRule
				},
			})

			const fixture = buildFixture()
			try {
				const cap: CommandCapability = {
					readonlyRoots: [fixture.inside],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [],
					network: "deny",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				}
				const cmd: CommandInvocation = {
					executable: "/bin/echo",
					args: ["hello"],
					cwd: fixture.inside,
					env: {},
				}
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
					capability: cap,
					command: cmd,
				})
				expect(capturedRule).toBe("(deny network*)")
				await prepared.cleanup?.()
			} finally {
				cleanupFixture(fixture.root)
			}
		})

		it("T6: observer throws are best-effort ignored; command semantics preserved", async () => {
			setSeatbeltDiagnosticObserver({
				onPrepareInput() {
					throw new Error("simulated observer failure on prepare input")
				},
				onProfileWritten() {
					throw new Error("simulated observer failure on profile written")
				},
				onInvocationPrepared() {
					throw new Error("simulated observer failure on invocation prepared")
				},
			})

			const fixture = buildFixture()
			try {
				const cap: CommandCapability = {
					readonlyRoots: [fixture.inside],
					writableRoots: [fixture.inside],
					denyReadSubpaths: [],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture.inside,
				}
				const cmd: CommandInvocation = {
					executable: "/bin/echo",
					args: ["hello"],
					cwd: fixture.inside,
					env: {},
				}
				const prepared = await SeatbeltSandboxBackendExperimental.prepare({
					capability: cap,
					command: cmd,
				})
				expect(prepared.executable).toBe(SANDBOX_EXEC_PATH)
				expect(prepared.args[0]).toBe("-f")
				expect(prepared.args[2]).toBe("/bin/echo")
				expect(prepared.args[3]).toBe("hello")
				expect(existsSync(prepared.args[1] as string)).toBe(true)
				await prepared.cleanup?.()
			} finally {
				cleanupFixture(fixture.root)
			}
		})

		it("DISABLED semantic-delta: identical prepared invocation with and without observer", async () => {
			// Run 1: no observer.
			setSeatbeltDiagnosticObserver(null)
			const fixture1 = buildFixture()
			let prepared1: SandboxPreparedInvocation
			try {
				const cap: CommandCapability = {
					readonlyRoots: [fixture1.inside],
					writableRoots: [fixture1.inside],
					denyReadSubpaths: [],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture1.inside,
				}
				const cmd: CommandInvocation = {
					executable: "/bin/echo",
					args: ["hello"],
					cwd: fixture1.inside,
					env: {},
				}
				prepared1 = await SeatbeltSandboxBackendExperimental.prepare({
					capability: cap,
					command: cmd,
				})
			} finally {
				cleanupFixture(fixture1.root)
			}

			// Run 2: identical inputs, with an observer that records
			// but never mutates.
			const observerRecordings: string[] = []
			setSeatbeltDiagnosticObserver({
				onPrepareInput(input) {
					observerRecordings.push(input.command.executable)
				},
				onProfileWritten(info) {
					observerRecordings.push(info.profilePath)
				},
				onInvocationPrepared(info) {
					observerRecordings.push(info.prepared.executable)
				},
			})
			const fixture2 = buildFixture()
			let prepared2: SandboxPreparedInvocation
			try {
				const cap: CommandCapability = {
					readonlyRoots: [fixture2.inside],
					writableRoots: [fixture2.inside],
					denyReadSubpaths: [],
					network: "allow",
					environment: { mode: "inherit" },
					cwd: fixture2.inside,
				}
				const cmd: CommandInvocation = {
					executable: "/bin/echo",
					args: ["hello"],
					cwd: fixture2.inside,
					env: {},
				}
				prepared2 = await SeatbeltSandboxBackendExperimental.prepare({
					capability: cap,
					command: cmd,
				})
			} finally {
				cleanupFixture(fixture2.root)
			}

			// Compare structural fields. profilePath will differ
			// because the temp-dir suffix is randomized; the executor
			// reads prepared.args[1] anyway, so just assert both paths
			// exist.
			expect(prepared2.executable).toBe(prepared1.executable)
			expect(prepared2.args[0]).toBe(prepared1.args[0])
			expect(prepared2.args[2]).toBe(prepared1.args[2])
			expect(prepared2.args[3]).toBe(prepared1.args[3])
			expect(existsSync(prepared2.args[1] as string)).toBe(true)
			expect(existsSync(prepared1.args[1] as string)).toBe(true)
			// Observer did fire — three recordings.
			expect(observerRecordings).toEqual([
				"/bin/echo",
				expect.stringMatching(/profile-[\da-f]+\.sb$/) as unknown as string,
				SANDBOX_EXEC_PATH,
			])
			await prepared1.cleanup?.()
			await prepared2.cleanup?.()
		})
	},
)
