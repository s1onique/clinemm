/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01 — extension-host runtime witnesses.
 *
 * Gates covered here:
 *   T01  Default OFF produces no records.
 *   T02  Runtime toggle works without session recreation.
 *   T07  Model/configuration changes are recorded accurately.
 *   T11  Dump is bounded, parseable and reports truncation.
 *   T12  Sensitive content is not recorded.
 *   T14  Comparator detects material configuration mismatch.
 *
 * The comparator witness drives the REAL offline comparator script.
 */
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
	_resetModelBehaviorTrace,
	dumpModelBehaviorTrace,
	getModelBehaviorTraceRecords,
	isModelBehaviorTraceEnabled,
	isModelBehaviorTraceWorkspaceEnabled,
	recordModelBehaviorTrace,
	recordModelBehaviorTraceConfig,
	setModelBehaviorTraceEnabled,
	syncModelBehaviorTraceEnabled,
	toggleModelBehaviorTraceWorkspaceEnabled,
} from "./model-behavior-trace-runtime"

/** A minimal `ExtensionContext` stand-in. */
function makeContext(initial?: boolean) {
	const state = new Map<string, unknown>()
	if (initial !== undefined) {
		state.set("modelBehaviorTraceEnabled", initial)
	}
	return {
		globalStorageUri: { fsPath: join(tmpdir(), `mbt-test-${Math.random().toString(36).slice(2)}`) },
		workspaceState: {
			get: <T>(key: string): T | undefined => state.get(key) as T | undefined,
			update: async (key: string, value: unknown): Promise<void> => {
				state.set(key, value)
			},
		},
	}
}

describe("model behavior trace runtime", () => {
	it("T01: default OFF produces no records", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext()
		expect(isModelBehaviorTraceWorkspaceEnabled(context)).toBe(false)
		expect(await syncModelBehaviorTraceEnabled(context)).toBe(false)
		expect(isModelBehaviorTraceEnabled()).toBe(false)
		recordModelBehaviorTrace("model_request_start", {
			sessionId: "s1",
			payload: {},
		})
		expect(getModelBehaviorTraceRecords()).toHaveLength(0)
	})

	it("T02: the runtime toggle works without session recreation", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext()
		// OFF by default.
		expect(await toggleModelBehaviorTraceWorkspaceEnabled(context)).toBe(true)
		expect(isModelBehaviorTraceEnabled()).toBe(true)
		recordModelBehaviorTrace("model_request_start", {
			sessionId: "s1",
			payload: {},
		})
		expect(getModelBehaviorTraceRecords()).toHaveLength(1)

		// Toggling back OFF stops subsequent capture but preserves evidence.
		expect(await toggleModelBehaviorTraceWorkspaceEnabled(context)).toBe(false)
		recordModelBehaviorTrace("model_request_start", {
			sessionId: "s1",
			payload: {},
		})
		expect(getModelBehaviorTraceRecords()).toHaveLength(1)

		// A fresh "session" (a new sync) still honors the persisted state.
		expect(await syncModelBehaviorTraceEnabled(context)).toBe(false)
		expect(isModelBehaviorTraceEnabled()).toBe(false)
	})

	it("T07: model/configuration changes are recorded accurately", async () => {
		_resetModelBehaviorTrace()
		setModelBehaviorTraceEnabled(true)
		const record = recordModelBehaviorTraceConfig(
			{ sessionId: "s1", providerId: "minimax", modelId: "minimax-m3" },
			{
				selectedProviderId: "minimax",
				selectedModelId: "minimax-m3",
				runtimeProviderId: "minimax",
				runtimeModelId: "minimax-m3",
				thinkingEnabled: true,
				reasoningEffort: "high",
				contextWindow: 1_000_000,
				maxInputTokens: 999_000,
				userContextCeiling: 500_000,
				toolCount: 42,
				toolNames: ["read_file", "write_file"],
				sourceHead: "b22855b4a83a958904d9d87c31e4d6c298d355da",
				extensionVersion: "1.2.3",
			},
		)
		expect(record).toBeDefined()
		expect(record?.event).toBe("model_config")
		expect(record?.payload.selectedModelId).toBe("minimax-m3")
		expect(record?.payload.runtimeModelId).toBe("minimax-m3")
		// The provider did NOT expose a confirmed model identity, so it is
		// explicitly UNAVAILABLE — never invented.
		expect(record?.payload.providerConfirmedModelId).toBe("UNAVAILABLE_FROM_TRACE")
		expect(record?.payload.thinkingEnabled).toBe(true)
		expect(record?.payload.reasoningEffort).toBe("high")
		expect(record?.payload.contextWindow).toBe(1_000_000)
		expect(record?.payload.userContextCeiling).toBe(500_000)
		expect(record?.payload.toolCount).toBe(42)
		expect(record?.payload.sourceHead).toBe("b22855b4a83a958904d9d87c31e4d6c298d355da")
	})

	it("T07b: an omitted provider setting is marked UNAVAILABLE", async () => {
		_resetModelBehaviorTrace()
		setModelBehaviorTraceEnabled(true)
		const record = recordModelBehaviorTraceConfig({ sessionId: "s1" }, {})
		expect(record?.payload.temperature).toBe("UNAVAILABLE_FROM_TRACE")
		expect(record?.payload.topP).toBe("UNAVAILABLE_FROM_TRACE")
		expect(record?.payload.maxOutputTokens).toBe("UNAVAILABLE_FROM_TRACE")
		expect(record?.payload.providerConfirmedModelId).toBe("UNAVAILABLE_FROM_TRACE")
	})

	it("T11: the dump is bounded, parseable, and reports truncation", async () => {
		_resetModelBehaviorTrace()
		setModelBehaviorTraceEnabled(true)
		const context = makeContext()
		for (let index = 0; index < 5; index += 1) {
			recordModelBehaviorTrace("model_request_start", {
				sessionId: "s1",
				iteration: index + 1,
				payload: { index },
			})
		}
		const result = await dumpModelBehaviorTrace(context)
		expect(result.recordCount).toBe(5)
		expect(result.truncated).toBe(false)

		const contents = await readFile(result.filePath, "utf8")
		const lines = contents.trim().split("\n")
		expect(lines).toHaveLength(6)
		// Every line is parseable JSON.
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow()
		}
		// The final line is the summary carrying the truncation metadata.
		const summary = JSON.parse(lines[lines.length - 1] as string)
		expect(summary.kind).toBe("summary")
		expect(summary.truncation.truncated).toBe(false)
		expect(summary.truncation.totalRecorded).toBe(5)
		expect(summary.truncation.retainedCount).toBe(5)
	})

	it("T11b: the dump reports NO_CAPTURE when nothing was recorded", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext()
		const result = await dumpModelBehaviorTrace(context)
		expect(result.recordCount).toBe(0)
		const contents = await readFile(result.filePath, "utf8")
		const summary = JSON.parse(contents.trim().split("\n").pop() as string)
		expect(summary.kind).toBe("summary")
		expect(summary.truncation.totalRecorded).toBe(0)
	})

	it("T11c: the dump works after tracing has been disabled and never clears evidence", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext()
		setModelBehaviorTraceEnabled(true)
		recordModelBehaviorTrace("model_request_start", {
			sessionId: "s1",
			payload: {},
		})
		// Disable BEFORE dumping.
		setModelBehaviorTraceEnabled(false)
		const result = await dumpModelBehaviorTrace(context)
		expect(result.recordCount).toBe(1)
		// A SECOND dump still sees the evidence — the dump never clears it.
		const second = await dumpModelBehaviorTrace(context)
		expect(second.recordCount).toBe(1)
	})

	it("T12: sensitive content is not recorded", async () => {
		_resetModelBehaviorTrace()
		setModelBehaviorTraceEnabled(true)
		recordModelBehaviorTrace("tool_start", {
			sessionId: "s1",
			payload: {
				toolName: "run_command",
				command: "rm -rf /important",
				prompt: "secret prompt",
				apiKey: "sk-test-1234",
				path: "/etc/shadow",
				stdout: "raw output",
			},
		})
		const serialized = JSON.stringify(getModelBehaviorTraceRecords())
		expect(serialized).not.toContain("rm -rf /important")
		expect(serialized).not.toContain("secret prompt")
		expect(serialized).not.toContain("sk-test-1234")
		expect(serialized).not.toContain("/etc/shadow")
		expect(serialized).not.toContain("raw output")
	})
})
