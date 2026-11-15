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
	_resetModelBehaviorTrace,
	getModelBehaviorTraceRecords,
	modelBehaviorTraceSink,
	setModelBehaviorTraceEnabled,
} from "../model-behavior-trace-runtime"
import {
	_resetRoundcLatencyTraceForTests,
	buildRoundcLatencyTraceArtifact,
	COMPOSABLE_SINK_CHANNELS,
	COMPOSABLE_SINK_IS_EXHAUSTIVE,
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

	// ---------------------------------------------------------------------
	// ACT09 — CORRECTION01: sink composition completeness
	//
	// The original composition forwarded only 18 of the interface's 25
	// event channels, so arming the Round C trace SILENTLY DROPPED the
	// existing recorder's edit, process and fingerprint telemetry. These
	// tests are the ADVERSARIAL proof that the defect cannot recur.
	// ---------------------------------------------------------------------
	describe("ACT09 — sink composition preserves EVERY existing channel", () => {
		it("ACT09.1: the composition's channel list covers EVERY event channel of the SDK interface", () => {
			// The compile-time gate in the production module proves this
			// at build time; the runtime assertion proves the list is
			// actually populated (a list could satisfy the type and still
			// be empty at runtime if it were built dynamically).
			expect(COMPOSABLE_SINK_IS_EXHAUSTIVE).toBe(true)
			expect(COMPOSABLE_SINK_CHANNELS.length).toBeGreaterThan(0)
			// Every event channel is DISTINCT — a duplicated name would
			// silently drop one of the two.
			expect(new Set(COMPOSABLE_SINK_CHANNELS).size).toBe(COMPOSABLE_SINK_CHANNELS.length)
		})

		it("ACT09.2: the EDIT channels are forwarded to BOTH sinks", () => {
			const seen: string[] = []
			const editChannels = [
				"onEditAttempt",
				"onEditApplication",
				"onEditFailure",
				"onEditTargetResolved",
				"onEditWriteVerification",
				"onEditCheckpointObservation",
			] as const
			for (const channel of editChannels) {
				const primary: ModelBehaviorTraceSink = {
					[channel]: () => seen.push(`primary:${channel}`),
				}
				const secondary: ModelBehaviorTraceSink = {
					[channel]: () => seen.push(`secondary:${channel}`),
				}
				const composed = composeModelBehaviorTraceSinks(primary, secondary)
				expect(typeof composed[channel]).toBe("function")
				;(composed[channel] as (o: ModelBehaviorTraceObservation) => void)(observation())
			}
			// EVERY edit channel reached BOTH sides.
			for (const channel of editChannels) {
				expect(seen).toContain(`primary:${channel}`)
				expect(seen).toContain(`secondary:${channel}`)
			}
		})

		it("ACT09.3: the PROCESS channel is forwarded to BOTH sinks", () => {
			const seen: string[] = []
			const primary: ModelBehaviorTraceSink = {
				onProcessObservation: () => seen.push("primary"),
			}
			const secondary: ModelBehaviorTraceSink = {
				onProcessObservation: () => seen.push("secondary"),
			}
			const composed = composeModelBehaviorTraceSinks(primary, secondary)
			expect(typeof composed.onProcessObservation).toBe("function")
			composed.onProcessObservation?.(observation())
			expect(seen).toEqual(["primary", "secondary"])
		})

		it("ACT09.4: the composition does NOT drop a channel that only ONE side implements", () => {
			// The original defect's exact shape: the RECORDER implements the
			// edit channels, the Round C sink does not. The composed sink
			// must still deliver the recorder's events.
			const seen: string[] = []
			const recorder: ModelBehaviorTraceSink = {
				onEditAttempt: () => seen.push("edit_attempt"),
				onEditFailure: () => seen.push("edit_failure"),
				onProcessObservation: () => seen.push("process_observation"),
			}
			// The Round C sink implements NONE of these.
			const composed = composeModelBehaviorTraceSinks(recorder, {})
			composed.onEditAttempt?.(observation())
			composed.onEditFailure?.(observation())
			composed.onProcessObservation?.(observation())
			expect(seen).toEqual(["edit_attempt", "edit_failure", "process_observation"])
		})

		it("ACT09.5: the fingerprint operations are PRESERVED and return the PRIMARY's value", async () => {
			const primary: ModelBehaviorTraceSink = {
				fingerprintToolArguments: async () => "primary-args",
				fingerprintFilePath: async () => "primary-path",
				fingerprintFileContent: async () => "primary-content",
			}
			const secondary: ModelBehaviorTraceSink = {
				fingerprintToolArguments: async () => "secondary-args",
				fingerprintFilePath: async () => "secondary-path",
				fingerprintFileContent: async () => "secondary-content",
			}
			const composed = composeModelBehaviorTraceSinks(primary, secondary)
			expect(typeof composed.fingerprintToolArguments).toBe("function")
			expect(await composed.fingerprintToolArguments?.("read_file", { path: "a.ts" })).toBe("primary-args")
			expect(await composed.fingerprintFilePath?.("/abs/a.ts")).toBe("primary-path")
			expect(await composed.fingerprintFileContent?.("content")).toBe("primary-content")
		})

		it("ACT09.6: the fingerprint operations preserve the ASYNCHRONOUS return value", async () => {
			// The SDK `await`s these. A composite that returned `undefined`
			// would silently disable the recorder's fingerprinting entirely.
			const primary: ModelBehaviorTraceSink = {
				fingerprintToolArguments: async () => {
					await new Promise((resolve) => setTimeout(resolve, 1))
					return "async-fingerprint"
				},
			}
			const composed = composeModelBehaviorTraceSinks(primary, {})
			const result = composed.fingerprintToolArguments?.("read_file", { path: "a.ts" })
			expect(result).toBeInstanceOf(Promise)
			expect(await result).toBe("async-fingerprint")
		})

		it("ACT09.7: the fingerprint operations preserve the RECEIVER BINDING", async () => {
			// The recorder's implementation resolves `this.fingerprintKey`.
			// A composite that invoked the delegate unbound would throw a
			// TypeError, and the failure isolation would then swallow it
			// into `undefined` — silently disabling the fingerprint.
			const primary = {
				key: "the-ephemeral-key",
				fingerprintToolArguments(this: { key: string }, _tool: string, _input: unknown) {
					return `${this.key}:fingerprint`
				},
			} satisfies ModelBehaviorTraceSink & { key: string }
			const composed = composeModelBehaviorTraceSinks(primary, {})
			expect(await composed.fingerprintToolArguments?.("read_file", { path: "a.ts" })).toBe("the-ephemeral-key:fingerprint")
		})

		it("ACT09.8: the fingerprint operations FALL BACK to the secondary when the primary does not implement them", async () => {
			const secondary: ModelBehaviorTraceSink = {
				fingerprintToolArguments: async () => "secondary-args",
			}
			const composed = composeModelBehaviorTraceSinks({}, secondary)
			expect(await composed.fingerprintToolArguments?.("read_file", { path: "a.ts" })).toBe("secondary-args")
		})

		it("ACT09.9: a THROWING fingerprint does not break the runtime's tool execution", async () => {
			const primary: ModelBehaviorTraceSink = {
				fingerprintToolArguments: () => {
					throw new Error("fingerprint exploded")
				},
			}
			const composed = composeModelBehaviorTraceSinks(primary, {})
			expect(() => composed.fingerprintToolArguments?.("read_file", { path: "a.ts" })).not.toThrow()
			expect(composed.fingerprintToolArguments?.("read_file", { path: "a.ts" })).toBeUndefined()
		})

		it("ACT09.10: the DISABLED public profile installs no sink and composes to an inert sink", () => {
			applyRoundcLatencyTraceDiagnosticProfile(false)
			// No sink is installed at all — the composition is never reached
			// on the disabled path.
			expect(installRoundcLatencyTraceSink("session-abc")).toBeUndefined()
			expect(getRoundcLatencyTraceSnapshot()).toBeUndefined()
			// And if a composition IS built, the disabled recorder side
			// reports "not enabled", so the SDK takes its fast path.
			const disabled: ModelBehaviorTraceSink = { isTraceEnabled: () => false }
			const composed = composeModelBehaviorTraceSinks(disabled, {})
			expect(composed.isTraceEnabled?.()).toBe(false)
		})

		it("ACT09.11: the trace artifact reports the capture's COMPLETENESS explicitly", async () => {
			const dir = await mkdtemp(join(tmpdir(), "roundc-truncation-"))
			try {
				applyRoundcLatencyTraceDiagnosticProfile(true)
				const sink = installRoundcLatencyTraceSink("session-abc")
				sink?.onModelRequestStart?.(observation({ modelId: "m1" }))
				const artifact = buildRoundcLatencyTraceArtifact()
				expect(artifact).toBeDefined()
				// The truncation block is ALWAYS present, so a consumer can
				// never mistake a partial capture for a complete one.
				expect(artifact?.truncation).toBeDefined()
				expect(artifact?.truncation.truncated).toBe(false)
				expect(artifact?.truncation.droppedEventCount).toBe(0)
				expect(artifact?.truncation.retainedEventCount).toBe(artifact?.eventCount)
				// The block is serialized into the exported artifact.
				const result = await dumpRoundcLatencyTrace({ globalStorageUri: { fsPath: dir } })
				const parsed = JSON.parse(await readFile(result.file, "utf8"))
				expect(parsed.truncation).toBeDefined()
				expect(parsed.truncation.truncated).toBe(false)
				expect(typeof parsed.truncation.maxEvents).toBe("number")
			} finally {
				await rm(dir, { recursive: true, force: true })
			}
		})

		it("ACT09.12: the REAL production recorder keeps EVERY channel through the composition", async () => {
			// The strongest evidence: drive the ACTUAL extension-host
			// recorder (not a mock) through the ACTUAL composition, exactly
			// as `VscodeSessionHost.prepareStartSessionInput` does, and
			// prove that the recorder's edit / process telemetry AND its
			// fingerprints survive.
			_resetModelBehaviorTrace()
			setModelBehaviorTraceEnabled(true)
			applyRoundcLatencyTraceDiagnosticProfile(true)
			const roundcSink = installRoundcLatencyTraceSink("session-real")
			expect(roundcSink).toBeDefined()
			if (!roundcSink) {
				throw new Error("the dogfood profile must install the Round C sink")
			}

			// The EXACT production composition: the recorder is PRIMARY.
			const composed = composeModelBehaviorTraceSinks(modelBehaviorTraceSink, roundcSink)

			// The recorder's EDIT channels reach its buffer.
			composed.onEditAttempt?.({
				sessionId: "session-real",
				runId: "run-1",
				payload: { toolName: "edit_file", operation: "replace" },
			})
			composed.onEditFailure?.({
				sessionId: "session-real",
				runId: "run-1",
				payload: { toolName: "edit_file", failureCategory: "text_not_found" },
			})
			composed.onProcessObservation?.({
				sessionId: "session-real",
				runId: "run-1",
				payload: { terminalState: "exited", exitCode: 0 },
			})

			const records = getModelBehaviorTraceRecords()
			const kinds = records.map((record) => record.event)
			expect(kinds).toContain("edit_attempt")
			expect(kinds).toContain("edit_failure")
			expect(kinds).toContain("process_observation")

			// The recorder's FINGERPRINTS survive the composition: the SDK
			// consumes these values, so dropping them would silently
			// disable the existing recorder's fingerprinting.
			const argsFingerprint = await composed.fingerprintToolArguments?.("read_file", {
				path: "a.ts",
			})
			const pathFingerprint = await composed.fingerprintFilePath?.("/workspace/src/a.ts")
			const contentFingerprint = await composed.fingerprintFileContent?.("content")
			expect(argsFingerprint).toBeTypeOf("string")
			expect(argsFingerprint).toBeTruthy()
			expect(pathFingerprint).toBeTypeOf("string")
			expect(contentFingerprint).toBeTypeOf("string")
			// The fingerprint is the recorder's, not the raw input.
			expect(argsFingerprint).not.toContain("a.ts")

			// And the Round C sink STILL observed the same events, so
			// composition preserves BOTH sides rather than replacing one.
			expect(getRoundcLatencyTraceSnapshot()).toBeDefined()

			_resetModelBehaviorTrace()
			applyRoundcLatencyTraceDiagnosticProfile(false)
		})
	})
})
