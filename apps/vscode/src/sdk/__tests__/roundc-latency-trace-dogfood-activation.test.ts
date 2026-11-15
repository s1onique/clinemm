/**
 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01 — qualification suite.
 *
 * Gates covered here (the ACT's acceptance table):
 *
 *   | Gate                | Test ids          |
 *   |---------------------|-------------------|
 *   | Dogfood activation  | ACT01.x           |
 *   | Public profile      | ACT02.x           |
 *   | Runtime             | ACT03.x           |
 *   | Export              | ACT04.x           |
 *   | Privacy             | ACT05.x           |
 *   | Correlation         | ACT06.x           |
 *   | Failure isolation   | ACT07.x           |
 *   | Production wiring   | ACT08.x           |
 *
 * The suite drives the REAL production modules:
 *
 *   - `roundc-latency-trace-runtime.ts` (the sink registry, the composite
 *     and the dump adapter);
 *   - `dogfood-diagnostic-profile.ts` (the activation helper — the ONE
 *     activation path);
 *   - `vscode-session-host.ts` (the REAL SDK runtime construction seam,
 *     asserted structurally so a regression that removes the wiring is
 *     caught).
 *
 * The SDK's own `LatencyTraceSink` and `LatencyTracer` are the REAL
 * production classes (the HARNESS-01/02 ones), reached through the
 * trusted-internal `@cline/core/internal/latency-trace` entry point.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { ModelBehaviorTraceObservation, ModelBehaviorTraceSink } from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { applyRoundcLatencyTraceDiagnosticProfile } from "../dogfood-diagnostic-profile"
import {
	_resetRoundcLatencyTraceForTests,
	buildRoundcLatencyTraceArtifact,
	composeModelBehaviorTraceSinks,
	dumpRoundcLatencyTrace,
	getRoundcLatencyTraceSnapshot,
	installRoundcLatencyTraceSink,
	isRoundcLatencyTraceEnabled,
	ROUNDC_LATENCY_TRACE_DUMP_FILE,
} from "../roundc-latency-trace-runtime"

const SESSION_HOST_PATH = resolve(__dirname, "../vscode-session-host.ts")
const EXTENSION_PATH = resolve(__dirname, "../../extension.ts")
const REGISTRY_PATH = resolve(__dirname, "../../registry.ts")
const PACKAGE_JSON_PATH = resolve(__dirname, "../../../package.json")

/**
 * A minimal, privacy-safe observation payload.
 *
 * It carries allowlisted metadata ONLY, mirroring what the SDK's
 * production seams publish.
 */
function observation(payload: Record<string, unknown> = {}): ModelBehaviorTraceObservation {
	return {
		payload,
	} as unknown as ModelBehaviorTraceObservation
}

describe("ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01 — Round C latency trace activation", () => {
	beforeEach(() => {
		_resetRoundcLatencyTraceForTests()
	})

	afterEach(() => {
		_resetRoundcLatencyTraceForTests()
	})

	// ---------------------------------------------------------------------
	// ACT01 — Dogfood activation
	// ---------------------------------------------------------------------
	describe("ACT01 — dogfood activation", () => {
		it("ACT01.1: the activation helper arms the trace for the dogfood profile", () => {
			const result = applyRoundcLatencyTraceDiagnosticProfile(true)
			expect(result.enabled).toBe(true)
			expect(result.flipped).toBe(true)
			expect(isRoundcLatencyTraceEnabled()).toBe(true)
		})

		it("ACT01.2: the activation helper is idempotent (a second dogfood call does not re-flip)", () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			const second = applyRoundcLatencyTraceDiagnosticProfile(true)
			expect(second.enabled).toBe(true)
			expect(second.flipped).toBe(false)
			expect(isRoundcLatencyTraceEnabled()).toBe(true)
		})

		it("ACT01.3: arming makes the sink installable for a session", () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			const sink = installRoundcLatencyTraceSink("session-abc")
			expect(sink).toBeDefined()
			expect(typeof sink?.onModelRequestStart).toBe("function")
		})

		it("ACT01.4: the disarming path flips the trace back OFF and drops the live sink", () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			installRoundcLatencyTraceSink("session-abc")
			expect(getRoundcLatencyTraceSnapshot()).toBeDefined()
			const result = applyRoundcLatencyTraceDiagnosticProfile(false)
			expect(result.enabled).toBe(false)
			expect(result.flipped).toBe(true)
			expect(isRoundcLatencyTraceEnabled()).toBe(false)
			expect(getRoundcLatencyTraceSnapshot()).toBeUndefined()
		})
	})

	// ---------------------------------------------------------------------
	// ACT02 — Public profile
	// ---------------------------------------------------------------------
	describe("ACT02 — public profile stays OFF", () => {
		it("ACT02.1: the public profile leaves the trace disarmed", () => {
			const result = applyRoundcLatencyTraceDiagnosticProfile(false)
			expect(result.enabled).toBe(false)
			expect(result.flipped).toBe(false)
			expect(isRoundcLatencyTraceEnabled()).toBe(false)
		})

		it("ACT02.2: the public profile installs NO sink (zero state-semantic delta)", () => {
			applyRoundcLatencyTraceDiagnosticProfile(false)
			expect(installRoundcLatencyTraceSink("session-abc")).toBeUndefined()
			expect(getRoundcLatencyTraceSnapshot()).toBeUndefined()
			expect(buildRoundcLatencyTraceArtifact()).toBeUndefined()
		})

		it("ACT02.3: the public profile never records an artifact", async () => {
			const dir = await mkdtemp(join(tmpdir(), "roundc-public-"))
			try {
				applyRoundcLatencyTraceDiagnosticProfile(false)
				const result = await dumpRoundcLatencyTrace({ globalStorageUri: { fsPath: dir } })
				expect(result.captured).toBe(false)
				expect(result.eventCount).toBe(0)
				// The artifact still exists (so the operator can tell
				// "nothing captured" from "extension not running"), but it
				// carries no trace data.
				const raw = await readFile(result.file, "utf8")
				const parsed = JSON.parse(raw)
				expect(parsed.captured).toBe(false)
				expect(parsed.events).toBeUndefined()
			} finally {
				await rm(dir, { recursive: true, force: true })
			}
		})

		it("ACT02.4: the module defaults to OFF without any activation call at all", () => {
			expect(isRoundcLatencyTraceEnabled()).toBe(false)
			expect(installRoundcLatencyTraceSink("session-abc")).toBeUndefined()
		})
	})

	// ---------------------------------------------------------------------
	// ACT03 — Runtime wiring / boundaries
	// ---------------------------------------------------------------------
	describe("ACT03 — the real runtime boundaries are recorded", () => {
		it("ACT03.1: the installed sink records the production request boundaries", () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			const sink = installRoundcLatencyTraceSink("session-abc")
			expect(sink).toBeDefined()
			sink?.onModelRequestStart?.(observation({ modelId: "m1", providerId: "p1" }))
			sink?.onRequestPrepared?.(observation({ requestBytes: 120 }))
			sink?.onProviderRequestSubmitted?.(observation({ requestBytes: 120 }))
			sink?.onProviderRequestCompleted?.(observation({ outputTokens: 42 }))
			sink?.onModelRequestFinish?.(observation({ totalTokens: 162 }))
			const snapshot = getRoundcLatencyTraceSnapshot()
			expect(snapshot).toBeDefined()
			expect(snapshot?.trace.events.length).toBeGreaterThan(0)
			const boundaries = snapshot?.trace.events.map((e) => e.boundary) ?? []
			expect(boundaries).toContain("request_preparation")
			expect(boundaries).toContain("provider_submitted")
			expect(boundaries).toContain("provider_completed")
		})

		it("ACT03.2: the installed sink records the production tool boundaries", () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			const sink = installRoundcLatencyTraceSink("session-abc")
			sink?.onToolStart?.(observation({ toolName: "run_commands", toolCallId: "tc-1" }))
			sink?.onToolFinish?.(observation({ toolName: "run_commands", outcome: "success" }))
			const snapshot = getRoundcLatencyTraceSnapshot()
			const boundaries = snapshot?.trace.events.map((e) => e.boundary) ?? []
			expect(boundaries).toContain("tool_execution")
		})

		it("ACT03.3: the tool outcome is classified, never reported as a bare success", () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			const sink = installRoundcLatencyTraceSink("session-abc")
			sink?.onToolStart?.(observation({ toolName: "run_commands" }))
			sink?.onToolFinish?.(observation({ outcome: "error" }))
			const snapshot = getRoundcLatencyTraceSnapshot()
			const end = snapshot?.trace.events.find((e) => e.boundary === "tool_execution" && e.phase === "end")
			expect(end?.status).toBe("failed")
		})

		it("ACT03.4: the disabled path records NOTHING (zero state-semantic delta)", () => {
			applyRoundcLatencyTraceDiagnosticProfile(false)
			const sink = installRoundcLatencyTraceSink("session-abc")
			expect(sink).toBeUndefined()
			expect(getRoundcLatencyTraceSnapshot()).toBeUndefined()
		})
	})

	// ---------------------------------------------------------------------
	// ACT04 — Export
	// ---------------------------------------------------------------------
	describe("ACT04 — trace export", () => {
		let dir: string
		beforeEach(async () => {
			dir = await mkdtemp(join(tmpdir(), "roundc-dump-"))
		})
		afterEach(async () => {
			await rm(dir, { recursive: true, force: true })
		})

		it("ACT04.1: the dump writes a valid, bounded JSON artifact to the profile-isolated path", async () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			const sink = installRoundcLatencyTraceSink("session-abc")
			sink?.onModelRequestStart?.(observation({ modelId: "m1" }))
			const result = await dumpRoundcLatencyTrace({ globalStorageUri: { fsPath: dir } })
			expect(result.captured).toBe(true)
			expect(result.eventCount).toBeGreaterThan(0)
			expect(result.file).toBe(join(dir, ROUNDC_LATENCY_TRACE_DUMP_FILE))
			const parsed = JSON.parse(await readFile(result.file, "utf8"))
			expect(parsed.schema).toBe("cline.roundc-latency-trace.v1")
			expect(parsed.sessionId).toBe("session-abc")
			expect(parsed.captureProfile).toBe("dogfood")
			expect(Array.isArray(parsed.events)).toBe(true)
			expect(Array.isArray(parsed.stages)).toBe(true)
		})

		it("ACT04.2: the dump works WHILE the task is still running", async () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			const sink = installRoundcLatencyTraceSink("session-running")
			sink?.onModelRequestStart?.(observation({ modelId: "m1" }))
			// The request is still in flight — no finish event yet.
			const result = await dumpRoundcLatencyTrace({ globalStorageUri: { fsPath: dir } })
			expect(result.captured).toBe(true)
			const parsed = JSON.parse(await readFile(result.file, "utf8"))
			expect(parsed.eventCount).toBeGreaterThan(0)
		})

		it("ACT04.3: the dump does NOT clear the captured trace", async () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			installRoundcLatencyTraceSink("session-abc")
			await dumpRoundcLatencyTrace({ globalStorageUri: { fsPath: dir } })
			expect(getRoundcLatencyTraceSnapshot()).toBeDefined()
			const second = await dumpRoundcLatencyTrace({ globalStorageUri: { fsPath: dir } })
			expect(second.captured).toBe(true)
		})
	})

	// ---------------------------------------------------------------------
	// ACT05 — Privacy
	// ---------------------------------------------------------------------
	describe("ACT05 — privacy", () => {
		it("ACT05.1: non-allowlisted payload fields are DROPPED from the recorded metadata", () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			const sink = installRoundcLatencyTraceSink("session-abc")
			sink?.onModelRequestStart?.(
				observation({
					modelId: "m1",
					prompt: "SECRET PROMPT TEXT",
					command: "rm -rf /",
					apiKey: "sk-super-secret",
					toolResultContent: "TOP SECRET TOOL OUTPUT",
				}),
			)
			const snapshot = getRoundcLatencyTraceSnapshot()
			const serialized = JSON.stringify(snapshot?.trace.events ?? [])
			expect(serialized).not.toContain("SECRET PROMPT TEXT")
			expect(serialized).not.toContain("rm -rf /")
			expect(serialized).not.toContain("sk-super-secret")
			expect(serialized).not.toContain("TOP SECRET TOOL OUTPUT")
		})

		it("ACT05.2: the exported artifact carries no raw sensitive contents", async () => {
			const dir = await mkdtemp(join(tmpdir(), "roundc-privacy-"))
			try {
				applyRoundcLatencyTraceDiagnosticProfile(true)
				const sink = installRoundcLatencyTraceSink("session-abc")
				sink?.onToolStart?.(
					observation({
						toolName: "run_commands",
						command: "echo MY_SECRET_VALUE",
						input: { password: "hunter2" },
					}),
				)
				const result = await dumpRoundcLatencyTrace({ globalStorageUri: { fsPath: dir } })
				const raw = await readFile(result.file, "utf8")
				expect(raw).not.toContain("MY_SECRET_VALUE")
				expect(raw).not.toContain("hunter2")
				expect(raw).not.toContain("echo MY_SECRET_VALUE")
			} finally {
				await rm(dir, { recursive: true, force: true })
			}
		})

		it("ACT05.3: the artifact's top-level shape exposes only counts, ids and classifications", () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			installRoundcLatencyTraceSink("session-abc")
			const artifact = buildRoundcLatencyTraceArtifact()
			expect(artifact).toBeDefined()
			const keys = Object.keys(artifact ?? {})
			expect(keys).toContain("eventCount")
			expect(keys).toContain("stageCount")
			expect(keys).toContain("wallClockMs")
			expect(keys).toContain("sessionId")
			expect(keys).toContain("captureProfile")
			// No free-form text field and no content field.
			expect(keys).not.toContain("prompt")
			expect(keys).not.toContain("content")
			expect(keys).not.toContain("command")
			expect(keys).not.toContain("text")
		})

		it("ACT05.4: the skip reason is persisted only as a BOUNDED classification", () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			const sink = installRoundcLatencyTraceSink("session-abc")
			sink?.onToolFinish?.(
				observation({
					outcome: "skipped",
					executionInvoked: false,
					skipReason: "approval denied by operator for /etc/passwd",
				}),
			)
			const snapshot = getRoundcLatencyTraceSnapshot()
			const serialized = JSON.stringify(snapshot?.trace.events ?? [])
			expect(serialized).not.toContain("/etc/passwd")
			expect(serialized).not.toContain("approval denied by operator")
		})
	})

	// ---------------------------------------------------------------------
	// ACT06 — Correlation / lifecycle
	// ---------------------------------------------------------------------
	describe("ACT06 — correlation and lifecycle", () => {
		it("ACT06.1: the trace's correlation id is the REAL session id", () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			installRoundcLatencyTraceSink("session-real-123")
			const snapshot = getRoundcLatencyTraceSnapshot()
			expect(snapshot?.sessionId).toBe("session-real-123")
			expect(snapshot?.trace.correlationId).toBe("session-real-123")
		})

		it("ACT06.2: a NEW session REPLACES the previous one (no cross-task attribution)", () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			const first = installRoundcLatencyTraceSink("session-first")
			first?.onModelRequestStart?.(observation({ modelId: "m1" }))
			const second = installRoundcLatencyTraceSink("session-second")
			second?.onModelRequestStart?.(observation({ modelId: "m2" }))
			const snapshot = getRoundcLatencyTraceSnapshot()
			expect(snapshot?.sessionId).toBe("session-second")
			expect(snapshot?.trace.correlationId).toBe("session-second")
			// The FIRST session's event must NOT be present in the SECOND
			// session's trace.
			const serialized = JSON.stringify(snapshot?.trace.events ?? [])
			expect(serialized).not.toContain("session-first")
		})

		it("ACT06.3: the registry holds at most ONE live sink (bounded memory)", () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			for (let i = 0; i < 50; i++) {
				installRoundcLatencyTraceSink(`session-${i}`)
			}
			const snapshot = getRoundcLatencyTraceSnapshot()
			expect(snapshot?.sessionId).toBe("session-49")
			expect(snapshot?.trace.correlationId).toBe("session-49")
		})

		it("ACT06.4: a missing session id yields an explicit, non-fabricated correlation id", () => {
			applyRoundcLatencyTraceDiagnosticProfile(true)
			installRoundcLatencyTraceSink(undefined)
			const snapshot = getRoundcLatencyTraceSnapshot()
			expect(snapshot?.sessionId).toBe("roundc-unattributed-session")
		})
	})

	// ---------------------------------------------------------------------
	// ACT07 — Composite / failure isolation
	// ---------------------------------------------------------------------
	describe("ACT07 — sink composition and failure isolation", () => {
		it("ACT07.1: the composed sink fans an event out to BOTH sinks", () => {
			const seen: string[] = []
			const primary: ModelBehaviorTraceSink = {
				onModelRequestStart: () => seen.push("primary"),
			}
			const secondary: ModelBehaviorTraceSink = {
				onModelRequestStart: () => seen.push("secondary"),
			}
			const composed = composeModelBehaviorTraceSinks(primary, secondary)
			composed.onModelRequestStart?.(observation())
			expect(seen).toEqual(["primary", "secondary"])
		})

		it("ACT07.2: a throw in ONE sink does not break the OTHER", () => {
			const seen: string[] = []
			const primary: ModelBehaviorTraceSink = {
				onModelRequestStart: () => {
					throw new Error("primary exploded")
				},
			}
			const secondary: ModelBehaviorTraceSink = {
				onModelRequestStart: () => seen.push("secondary"),
			}
			const composed = composeModelBehaviorTraceSinks(primary, secondary)
			expect(() => composed.onModelRequestStart?.(observation())).not.toThrow()
			expect(seen).toEqual(["secondary"])
		})

		it("ACT07.3: a throw in ONE sink does not break the runtime's own dispatch", () => {
			const primary: ModelBehaviorTraceSink = {
				onToolStart: () => {
					throw new Error("primary exploded")
				},
			}
			const composed = composeModelBehaviorTraceSinks(primary, {})
			expect(() => composed.onToolStart?.(observation())).not.toThrow()
		})

		it("ACT07.4: the composed enable bit is the OR of both sides", () => {
			const off: ModelBehaviorTraceSink = { isTraceEnabled: () => false }
			const on: ModelBehaviorTraceSink = { isTraceEnabled: () => true }
			expect(composeModelBehaviorTraceSinks(off, off).isTraceEnabled?.()).toBe(false)
			expect(composeModelBehaviorTraceSinks(off, on).isTraceEnabled?.()).toBe(true)
			expect(composeModelBehaviorTraceSinks(on, off).isTraceEnabled?.()).toBe(true)
		})

		it("ACT07.5: a throwing enable bit does not break the composed enable bit", () => {
			const broken: ModelBehaviorTraceSink = {
				isTraceEnabled: () => {
					throw new Error("enable bit exploded")
				},
			}
			const off: ModelBehaviorTraceSink = { isTraceEnabled: () => false }
			expect(composeModelBehaviorTraceSinks(broken, off).isTraceEnabled?.()).toBe(false)
		})
	})

	// ---------------------------------------------------------------------
	// ACT08 — Production wiring (structural)
	// ---------------------------------------------------------------------
	describe("ACT08 — production wiring", () => {
		it("ACT08.1: the session host installs the Round C sink at the REAL runtime seam", async () => {
			const source = await readFile(SESSION_HOST_PATH, "utf8")
			expect(source).toContain("installRoundcLatencyTraceSink")
			expect(source).toContain("composeModelBehaviorTraceSinks")
			// The install must be derived from the session's OWN id, so the
			// trace correlates to the selected session.
			expect(source).toMatch(/installRoundcLatencyTraceSink\(inputWithRemoteConfig\.config\.sessionId\)/)
		})

		it("ACT08.2: the extension host arms the trace through the central dogfood profile", async () => {
			const source = await readFile(EXTENSION_PATH, "utf8")
			expect(source).toContain("applyRoundcLatencyTraceDiagnosticProfile")
			expect(source).toMatch(/applyRoundcLatencyTraceDiagnosticProfile\(isDogfoodRuntime\(process\.env\)\)/)
		})

		it("ACT08.3: the dump command is registered with the ACT's exact id and title", async () => {
			const registry = await readFile(REGISTRY_PATH, "utf8")
			expect(registry).toMatch(/DumpRoundcLatencyTrace:\s*`\$\{prefix\}\.debug\.dumpRoundcLatencyTrace`/)
			const pkg = await readFile(PACKAGE_JSON_PATH, "utf8")
			expect(pkg).toMatch(
				/"command":\s*"cline\.debug\.dumpRoundcLatencyTrace"[\s\S]*?"title":\s*"Cline Debug: Dump Round C Latency Trace"/,
			)
			const extension = await readFile(EXTENSION_PATH, "utf8")
			expect(extension).toMatch(/vscode\.commands\.registerCommand\(\s*commands\.DumpRoundcLatencyTrace/)
		})

		it("ACT08.4: NO new public configuration surface was introduced", async () => {
			const extension = await readFile(EXTENSION_PATH, "utf8")
			const registry = await readFile(REGISTRY_PATH, "utf8")
			// No new environment variable: the ONLY gate is the existing
			// dogfood runtime profile.
			expect(extension).not.toContain("CLINEMM_ROUNDC_LATENCY_TRACE")
			expect(registry).not.toContain("CLINEMM_ROUNDC_LATENCY_TRACE")
			// No toggle command: the dump is the ONLY operator surface.
			expect(registry).not.toContain("toggleRoundcLatencyTrace")
		})
	})
})
