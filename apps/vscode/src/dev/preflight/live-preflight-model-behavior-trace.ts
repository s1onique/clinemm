#!/usr/bin/env bun
/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-LIVE-PREFLIGHT01 — LIVE flight-recorder capture.
 *
 * PURPOSE
 * -------
 * Prove that the REAL model-behavior flight recorder captures a REAL model
 * run, and measure precisely which configuration dimensions the live capture
 * CAN and CANNOT establish. This script produces the evidence the
 * `PASS_LIVE_CAPTURE` / `CAPTURE_INSUFFICIENT` disposition is based on.
 *
 * WHAT IS REAL HERE (and what is not)
 * ------------------------------------
 * REAL:
 *   - `ModelBehaviorTraceRecorder` (@cline/shared) — the production bounded
 *     ring recorder, with its production limits, privacy sanitizer and
 *     ephemeral fingerprint key.
 *   - `AgentRuntime` (@cline/agents) — the production agent runtime, with the
 *     production model-request and tool-execution observation call sites.
 *   - The provider gateway (@cline/llms) against the REAL OpenRouter API.
 *   - The REAL MiniMax M3 and MiniMax M3.1 models.
 *   - The REAL tool executor (the tool is executed by the runtime).
 *   - `scripts/compare-model-behavior-traces.ts` — the real comparator.
 *
 * NOT REAL (and deliberately so):
 *   - The VS Code GUI host. The recorder's capture path lives entirely in the
 *     SDK (`apps/vscode/src/sdk/model-behavior-trace-runtime.ts` is a thin
 *     adapter over the SDK recorder), so driving the SDK directly exercises
 *     the SAME production capture code the GUI toggle arms. The GUI host is
 *     only the trigger and the file sink.
 *   - The `model_config` snapshot VALUES. In the GUI this is written by
 *     `cline-session-factory.ts` `buildSessionConfig()`. Here it is written
 *     through the SAME production adapter with the SAME values that
 *     `buildSessionConfig()` passes — including the values it passes as
 *     `undefined`. That is the point: the preflight must measure the REAL
 *     production gaps, not paper over them.
 *
 * USAGE
 * -----
 *   cd apps/vscode
 *   bun src/dev/preflight/live-preflight-model-behavior-trace.ts \
 *     --out /tmp/clinemm-preflight \
 *     --api-key "$OPENROUTER_API_KEY"
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { createAgentRuntime } from "@cline/agents"
import { createGateway } from "@cline/llms"
import { type ModelBehaviorTraceObservation, ModelBehaviorTraceRecorder } from "@cline/shared"
import { ExtensionRegistryInfo } from "../../registry"
// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R2): the
// canonical installed-bundle identity resolver. Reused as-is so the preflight
// records the SAME artifact identity the production host records.
import { resolveInstalledBundleIdentity } from "../../sdk/extension-host-allocation-profiler-runtime"

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`)
	if (index === -1) {
		return undefined
	}
	const value = process.argv[index + 1]
	return value && !value.startsWith("--") ? value : undefined
}

const OUT_DIR = arg("out") ?? "/tmp/clinemm-preflight"
const API_KEY = arg("api-key") ?? process.env.OPENROUTER_API_KEY ?? ""
const PROVIDER_ID = "openrouter"

/**
 * The REAL extension version, taken from the SAME production registry
 * constant that `buildSessionConfig()` uses
 * (`ExtensionRegistryInfo.version`).
 *
 * This is the one MATERIAL dimension the production path already
 * populates, so the preflight populates it too — the measurement must not
 * understate what production can supply.
 */
const EXTENSION_VERSION = ExtensionRegistryInfo.version

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R2): the
 * installed-bundle identity, resolved from the ACTUAL bundle bytes.
 *
 * The preflight runs from the repository, so `__dirname` is inside
 * `apps/vscode/src/dev/preflight`. The canonical resolver expects the
 * directory that HOLDS `extension.js` (`<extension-root>/dist`), so the
 * repository's `apps/vscode/dist` is passed.
 *
 * The SOURCE provenance and the ARTIFACT identity are separate facts: the
 * source head is informational, and the artifact digest describes the bytes
 * that actually ran.
 */
const BUNDLE_IDENTITY = resolveInstalledBundleIdentity(resolve(__dirname, "../../../dist"))

/** The two real models under comparison. */
const SUBJECTS = [
	{ label: "M3" as const, modelId: "minimax/minimax-m3" },
	{ label: "M3.1" as const, modelId: "minimax/minimax-m3.1-flash" },
]

/**
 * The bounded task both models are asked to perform.
 *
 * It is deliberately small but it DOES require the model to call a tool, so
 * the tool boundary is exercised for real. It is identical for both models.
 */
const TASK_PROMPT = [
	'Use the `read_probe` tool exactly once with the argument {"value": "alpha"}.',
	"After the tool returns, reply with exactly the word DONE and nothing else.",
].join(" ")

// ---------------------------------------------------------------------------
// The production tool.
//
// This is a REAL tool executed by the REAL runtime executor. Its argument
// is a trivial, non-sensitive string so the recorder's privacy sanitizer and
// the ephemeral fingerprint path are both exercised on real data.
// ---------------------------------------------------------------------------

const TOOL = {
	name: "read_probe",
	description: "Return a deterministic probe value for the given key.",
	inputSchema: {
		type: "object" as const,
		properties: { value: { type: "string" } },
		required: ["value"],
	},
	execute: async (input: Record<string, unknown>) => ({
		output: `probe:${String(input.value ?? "")}`,
	}),
}

// ---------------------------------------------------------------------------
// The sink adapter.
//
// This is the same shape as `apps/vscode/src/sdk/model-behavior-trace-runtime.ts`:
// the SDK hands over privacy-safe observations, the recorder owns the ring and
// the fingerprint key.
// ---------------------------------------------------------------------------

function createRecordingSink(recorder: ModelBehaviorTraceRecorder) {
	const record = (event: Parameters<ModelBehaviorTraceRecorder["record"]>[0]) => (o: ModelBehaviorTraceObservation) =>
		recorder.record(event, o, o.payload)
	return {
		isTraceEnabled: () => recorder.isEnabled(),
		fingerprintToolArguments: async (toolName: string, input: unknown) => {
			const result = await recorder.fingerprintArguments(toolName, input)
			return result?.fingerprint
		},
		// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3/R4):
		// the EFFECTIVE configuration channel. The REAL AgentRuntime emits it
		// at the model-request boundary, carrying the real session/run
		// identity and the effective tool schemas / reasoning policy / output
		// limit.
		onEffectiveModelConfig: record("effective_model_config"),
		onModelRequestStart: record("model_request_start"),
		onModelRequestFinish: record("model_request_finish"),
		onModelRequestError: record("model_request_error"),
		onModelRequestAbort: record("model_request_abort"),
		onToolStart: record("tool_start"),
		onToolFinish: record("tool_finish"),
		onLoopVerdict: record("loop_verdict"),
		onCompactionDiagnostics: record("compaction_diagnostics"),
		onCompactionCompleted: record("compaction_completed"),
		onRunTerminated: record("run_terminated"),
	}
}

// ---------------------------------------------------------------------------
// The model_config snapshot.
//
// IMPORTANT — this mirrors `apps/vscode/src/sdk/cline-session-factory.ts`
// `buildSessionConfig()` EXACTLY, including the fields it passes as
// `undefined` (which the adapter turns into `UNAVAILABLE_FROM_TRACE`).
// The preflight must measure the REAL production gaps, so the snapshot is
// NOT enriched with values the production path does not provide.
// ---------------------------------------------------------------------------

async function captureSubject(subject: (typeof SUBJECTS)[number]): Promise<{
	filePath: string
	recordCount: number
	truncation: unknown
	runId?: string
}> {
	const recorder = new ModelBehaviorTraceRecorder()
	recorder.setEnabled(true)

	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: PROVIDER_ID,
				apiKey: API_KEY,
			},
		],
	})

	const model = gateway.createAgentModel({
		providerId: PROVIDER_ID,
		modelId: subject.modelId,
	})

	const sessionId = `preflight-${subject.label}-${Date.now()}`

	// The production config snapshot, written through the SAME adapter the
	// VS Code host uses (`recordModelBehaviorTraceConfig`).
	//
	// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R2): the
	// installed-bundle identity is read from the ACTUAL bundle bytes via the
	// canonical `resolveInstalledBundleIdentity()` resolver, and the source
	// provenance is recorded as a SEPARATE fact (and is "unknown" whenever the
	// build did not come from a git working tree).
	recorder.record(
		"model_config",
		{ providerId: PROVIDER_ID, modelId: subject.modelId, sessionId },
		{
			selectedProviderId: PROVIDER_ID,
			selectedModelId: subject.modelId,
			runtimeProviderId: PROVIDER_ID,
			runtimeModelId: subject.modelId,
			providerConfirmedModelId: "UNAVAILABLE_FROM_TRACE",
			thinkingEnabled: "UNAVAILABLE_FROM_TRACE",
			reasoningEffort: "UNAVAILABLE_FROM_TRACE",
			temperature: "UNAVAILABLE_FROM_TRACE",
			topP: "UNAVAILABLE_FROM_TRACE",
			maxOutputTokens: "UNAVAILABLE_FROM_TRACE",
			contextWindow: "UNAVAILABLE_FROM_TRACE",
			maxInputTokens: "UNAVAILABLE_FROM_TRACE",
			userContextCeiling: "UNAVAILABLE_FROM_TRACE",
			// The toolset is NOT known at build time — it is established by
			// the EFFECTIVE model request, which the REAL AgentRuntime now
			// reports (see the `effective_model_config` channel above).
			toolCount: "UNAVAILABLE_FROM_TRACE",
			toolNames: [],
			sourceHead: BUNDLE_IDENTITY.sourceHead === "unknown" ? "UNAVAILABLE_FROM_TRACE" : BUNDLE_IDENTITY.sourceHead,
			extensionVersion: EXTENSION_VERSION,
			extensionBundleSha256:
				BUNDLE_IDENTITY.extensionBundleSha256 === "unknown"
					? "UNAVAILABLE_FROM_TRACE"
					: BUNDLE_IDENTITY.extensionBundleSha256,
			// The effective budget is resolved by the production compaction
			// policy at runtime and reported through the
			// `compaction_diagnostics` event, so it is not a build-time fact.
			effectiveMaxInputTokens: "UNAVAILABLE_FROM_TRACE",
			inputBudgetSource: "UNAVAILABLE_FROM_TRACE",
			userContextCeilingMode: "UNAVAILABLE_FROM_TRACE",
		},
		{ evidenceBoundary: "synthesized" },
	)

	const runtime = createAgentRuntime({
		model,
		tools: [TOOL] as never,
		systemPrompt: "You are a precise assistant. Follow the instruction exactly.",
		sessionId,
		modelBehaviorTraceSink: createRecordingSink(recorder) as never,
	})

	let runId: string | undefined
	try {
		const result = await runtime.run(TASK_PROMPT)
		runId = (result as { runId?: string }).runId
	} catch (error) {
		// A provider failure is itself evidence: it is recorded by the
		// runtime's error observation, so the trace is not empty.
		console.error(`[${subject.label}] runtime error:`, (error as Error).message)
	}

	const dump = recorder.dump()
	const filePath = join(OUT_DIR, `trace-${subject.label}.jsonl`)
	const lines = dump.records.map((record) => JSON.stringify(record))
	lines.push(
		JSON.stringify({
			kind: "summary",
			traceId: dump.traceId,
			dumpedAt: dump.dumpedAt,
			truncation: dump.truncation,
		}),
	)
	await writeFile(filePath, `${lines.join("\n")}\n`, "utf8")

	return {
		filePath,
		recordCount: dump.records.length,
		truncation: dump.truncation,
		runId,
	}
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	if (!API_KEY) {
		throw new Error("No API key: pass --api-key or set OPENROUTER_API_KEY.")
	}
	await mkdir(OUT_DIR, { recursive: true })

	const results: Record<string, unknown> = {}
	for (const subject of SUBJECTS) {
		console.log(`[preflight] capturing ${subject.label} (${subject.modelId})...`)
		const capture = await captureSubject(subject)
		console.log(`[preflight] ${subject.label}: ${capture.recordCount} records -> ${capture.filePath}`)
		results[subject.label] = capture
	}

	await writeFile(join(OUT_DIR, "capture-summary.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8")
	console.log("[preflight] done.")
}

await main()
