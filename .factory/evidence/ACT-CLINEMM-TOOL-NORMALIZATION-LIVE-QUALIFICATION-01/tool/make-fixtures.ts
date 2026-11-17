/**
 * ACT-CLINEMM-TOOL-NORMALIZATION-LIVE-QUALIFICATION-01 — CORRECTION01
 * adversarial fixture builder.
 *
 * Builds the adversarial fixture trees the analyzer witness drives:
 *
 *   FIXTURES/trace-missing-exec-end/         a trace with ONE tool_execution
 *                                             'end' event REMOVED
 *   FIXTURES/trace-missing-delivery-end/     a trace with ONE
 *                                             tool_result_delivered 'end'
 *                                             event REMOVED
 *   FIXTURES/trace-mismatched-names/         a trace where one delivery
 *                                             carries a DIFFERENT tool name
 *   FIXTURES/trace-reordered/                a trace whose event ORDER is
 *                                             permuted
 *   FIXTURES/captures-schema-drift/          two provider captures in ONE
 *                                             session with DIFFERENT
 *                                             run_commands schema hashes
 *   FIXTURES/captures-missing-strict/        a capture with NO
 *                                             strictJsonSchema field
 *
 * READ-ONLY with respect to the real artifacts: the real trace is only READ.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The trace the fixtures are DERIVED from. It lives OUTSIDE the repository and
 * is never committed. The fixtures themselves are portable: they contain only
 * synthetic event ids and tool names.
 */
const REAL_TRACE =
	process.env.CLINE_QUALIFY_TRACE ??
	"/Volumes/UserData/Users/chistyakov/Downloads/roundc-latency-trace(8).json";
const OUT = join(import.meta.dir, "fixtures");

function loadTrace(): {
	events: Array<Record<string, unknown>>;
} {
	const raw = JSON.parse(readFileSync(REAL_TRACE, "utf8")) as {
		events: Array<Record<string, unknown>>;
	};
	return raw;
}

/**
 * The analyzer reads ONLY the `schema_validation`, `tool_execution` and
 * `tool_result_delivered` boundaries. The fixtures therefore retain only those
 * events, with a REDUCED metadata projection (the tool-call id, the tool name,
 * the validity flag and the timing). This keeps the fixtures small and free of
 * any unrelated session metric while preserving every property the witness
 * depends on.
 */
const BOUNDARY_EVENT_KEYS = [
	"schema_validation",
	"tool_execution",
	"tool_result_delivered",
];

function reduceEvent(event: Record<string, unknown>): Record<string, unknown> {
	const metadata = (event.metadata ?? {}) as Record<string, unknown>;
	const reduced: Record<string, unknown> = {
		boundary: event.boundary,
		phase: event.phase,
		monotonicMs: event.monotonicMs,
	};
	const projected: Record<string, unknown> = {};
	for (const key of [
		"toolCallId",
		"toolName",
		"schemaValid",
		"outcome",
		"executionInvoked",
	]) {
		if (key in metadata) {
			projected[key] = metadata[key];
		}
	}
	reduced.metadata = projected;
	return reduced;
}

function writeTrace(name: string, events: Array<Record<string, unknown>>): void {
	const dir = join(OUT, name);
	mkdirSync(dir, { recursive: true });
	const kept = events
		.filter((e) =>
			BOUNDARY_EVENT_KEYS.includes(String(e.boundary ?? "")),
		)
		.map(reduceEvent);
	const payload = {
		schema: "cline.roundc-latency-trace.v1",
		sessionId: "1794892591345_7em4g",
		correlationId: "1794892591345_7em4g",
		captureProfile: "dogfood",
		identity: { runtimeProfile: "dogfood", extensionVersion: "FIXTURE" },
		eventCount: kept.length,
		stageCount: 0,
		unavailableCount: 0,
		integrityFailureCount: 0,
		wallClockMs: 0,
		overlapping: true,
		truncation: { truncated: false },
		events: kept,
		stages: [],
		unavailable: [],
		integrityFailures: [],
	};
	writeFileSync(
		join(dir, "roundc-latency-trace(8).json"),
		JSON.stringify(payload, null, 2),
	);
}

const base = loadTrace().events;

/** Remove the Nth event matching boundary+phase. */
function withoutNth(
	events: Array<Record<string, unknown>>,
	boundary: string,
	phase: string,
	nth: number,
): Array<Record<string, unknown>> {
	const out: Array<Record<string, unknown>> = [];
	let seen = 0;
	for (const e of events) {
		if (e.boundary === boundary && e.phase === phase) {
			seen += 1;
			if (seen === nth) {
				continue;
			}
		}
		out.push(e);
	}
	return out;
}

writeTrace("trace-missing-exec-end", withoutNth(base, "tool_execution", "end", 3));
writeTrace(
	"trace-missing-delivery-end",
	withoutNth(base, "tool_result_delivered", "end", 5),
);

/** Rename one delivery's tool name so it no longer matches its execution. */
const mismatched = base.map((e) => {
	if (
		e.boundary === "tool_result_delivered" &&
		e.phase === "start" &&
		(e.metadata as { toolCallId?: string })?.toolCallId ===
			"call_49d69844f70c4a3ca63305f5"
	) {
		const metadata = {
			...(e.metadata as Record<string, unknown>),
			toolName: "read_files",
		};
		return { ...e, metadata };
	}
	return e;
});
writeTrace("trace-mismatched-names", mismatched);

/** Reverse the event order — a valid event set with a different chronology. */
writeTrace("trace-reordered", [...base].reverse());

/* ------------------------------------------------------------------ */
/* Provider capture fixtures                                           */
/* ------------------------------------------------------------------ */

const CAPTURE_DIR = join(OUT, "captures-schema-drift");
const CAPTURE_DIR_MISSING = join(OUT, "captures-missing-strict");
mkdirSync(CAPTURE_DIR, { recursive: true });
mkdirSync(CAPTURE_DIR_MISSING, { recursive: true });

function capture(
	sessionId: string,
	runId: string,
	index: number,
	schema: unknown,
	strict: unknown,
): string {
	return JSON.stringify({
		timestamp: "2026-11-13T16:30:42.878Z",
		captureStage: "ai_sdk_prompt",
		mode: "full",
		correlation: {
			sessionId,
			runId,
			iteration: index,
			clientVersion: "4.1.16-5a1c485cb",
			providerId: "openai-compatible",
		},
		payload: {
			messages: [],
			tools: {
				run_commands: {
					description: "run commands",
					inputSchema: schema,
				},
			},
			providerOptions: {
				anthropic: {},
				openaiCompatible:
					strict === undefined ? {} : { strictJsonSchema: strict },
			},
		},
		attempt: 1,
	});
}

const SCHEMA_A = {
	jsonSchema: {
		type: "object",
		properties: { commands: { type: "array", items: { type: "string" } } },
		required: ["commands"],
		additionalProperties: false,
	},
};
const SCHEMA_B = {
	jsonSchema: {
		type: "object",
		properties: { commands: { type: "array", items: { type: "string" } } },
		required: ["commands"],
		additionalProperties: true,
	},
};

writeFileSync(
	join(CAPTURE_DIR, "cap_run_FIXTURE_1_a.provider-request.json"),
	capture("1794593797996_r48lj", "run_FIXTURE", 1, SCHEMA_A, false),
);
writeFileSync(
	join(CAPTURE_DIR, "cap_run_FIXTURE_2_b.provider-request.json"),
	capture("1794593797996_r48lj", "run_FIXTURE", 2, SCHEMA_B, false),
);

writeFileSync(
	join(CAPTURE_DIR_MISSING, "cap_run_FIXTURE_1_a.provider-request.json"),
	capture("1794593797996_r48lj", "run_FIXTURE", 1, SCHEMA_A, undefined),
);

process.stdout.write(
	`fixtures written to ${OUT}\n${existsSync(REAL_TRACE) ? "" : "WARNING: real trace missing"}\n`,
);
