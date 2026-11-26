/**
 * ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01
 *
 * C1.1 — MiniMax R2 historical prefix-divergence discriminator.
 *
 * Reads the FROZEN Arm A captures (operator-local archive
 * `arm-a-r2-cache-discriminator.tar.gz`, sha256
 * 28d38cbe24d94bddbc02787304f55a735374e4771c266d5600fa1842cb363914) and
 * compares the actual WIRE request bodies for the parent request sequence
 * 78 -> 79 -> 80 -> 81.
 *
 * NO inference, NO network dispatch: frozen artifacts only.
 *
 * Usage: bun w2-prefix-discriminator.ts <extracted-root> [<out.json>]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface CaptureFile {
	readonly payload: {
		readonly url: string;
		readonly method: string;
		readonly body: string;
	};
	readonly correlation: Record<string, unknown>;
}

interface WireBody {
	readonly model?: string;
	readonly max_tokens?: number;
	readonly system?: unknown;
	readonly messages?: unknown;
	readonly tools?: unknown;
	readonly thinking?: unknown;
	readonly output_config?: unknown;
}

const CAPTURE_BY_ITERATION: Record<number, string> = {
	78: "cap_run__Jq4WUpj_78_27865d75fddd4182",
	79: "cap_run__Jq4WUpj_79_3befdd8362098a61",
	80: "cap_run__Jq4WUpj_80_4f2205f18ae8e313",
	81: "cap_run__Jq4WUpj_81_d3baa2adaea98cb4",
};

const SELECTOR_CAPTURE = "sel_jxe8l1tr";

function readCapture(root: string, stem: string, stage: string): CaptureFile {
	const path = join(
		root,
		"provider-request-captures",
		`${stem}.${stage}.1.provider-request.json`,
	);
	return JSON.parse(readFileSync(path, "utf8")) as CaptureFile;
}

/** Flatten the wire `system` field into one comparable string. */
function systemText(body: WireBody): string {
	const sys = body.system;
	if (typeof sys === "string") {
		return sys;
	}
	if (Array.isArray(sys)) {
		return sys
			.map((entry) => {
				if (typeof entry === "string") {
					return entry;
				}
				const record = entry as {
					type?: string;
					text?: string;
					cache_control?: unknown;
				};
				return `${record.type ?? "text"}${record.cache_control ? "[cache_control]" : ""}:${record.text ?? ""}`;
			})
			.join("\n");
	}
	return "";
}

/** Index of the first differing character, or -1 when identical. */
function firstDivergence(a: string, b: string): number {
	const max = Math.min(a.length, b.length);
	for (let i = 0; i < max; i++) {
		if (a[i] !== b[i]) {
			return i;
		}
	}
	return a.length === b.length ? -1 : max;
}

function commonPrefixLength(a: string, b: string): number {
	const max = Math.min(a.length, b.length);
	let i = 0;
	while (i < max && a[i] === b[i]) {
		i++;
	}
	return i;
}

/** Number of leading messages that are byte-identical (stable JSON). */
function commonMessagePrefix(a: unknown[], b: unknown[]): number {
	const max = Math.min(a.length, b.length);
	let i = 0;
	while (i < max && JSON.stringify(a[i]) === JSON.stringify(b[i])) {
		i++;
	}
	return i;
}

function sha256(text: string): string {
	return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function comparePair(
	a: { readonly body: WireBody; readonly capture: CaptureFile },
	b: { readonly body: WireBody; readonly capture: CaptureFile },
): Record<string, unknown> {
	const aSystem = systemText(a.body);
	const bSystem = systemText(b.body);
	const aMessages = Array.isArray(a.body.messages) ? a.body.messages : [];
	const bMessages = Array.isArray(b.body.messages) ? b.body.messages : [];
	const aTools = Array.isArray(a.body.tools) ? a.body.tools : [];
	const bTools = Array.isArray(b.body.tools) ? b.body.tools : [];
	const divergence = firstDivergence(aSystem, bSystem);
	return {
		from: a.capture.correlation.iteration,
		to: b.capture.correlation.iteration,
		systemEqual: divergence === -1,
		systemChars: {
			from: aSystem.length,
			to: bSystem.length,
			delta: bSystem.length - aSystem.length,
		},
		systemSha256: { from: sha256(aSystem), to: sha256(bSystem) },
		firstDivergentSystemChar: divergence,
		longestCommonSystemPrefixChars: commonPrefixLength(aSystem, bSystem),
		divergentSystemContext:
			divergence === -1
				? null
				: aSystem.slice(Math.max(0, divergence - 80), divergence + 80),
		toolsEqual: JSON.stringify(aTools) === JSON.stringify(bTools),
		toolCount: { from: aTools.length, to: bTools.length },
		toolsSha256: {
			from: sha256(JSON.stringify(aTools)),
			to: sha256(JSON.stringify(bTools)),
		},
		messagesEqual: JSON.stringify(aMessages) === JSON.stringify(bMessages),
		messageCount: { from: aMessages.length, to: bMessages.length },
		longestIdenticalLeadingMessageCount: commonMessagePrefix(
			aMessages,
			bMessages,
		),
		reasoningConfigEqual:
			JSON.stringify(a.body.thinking ?? null) ===
				JSON.stringify(b.body.thinking ?? null) &&
			JSON.stringify(a.body.output_config ?? null) ===
				JSON.stringify(b.body.output_config ?? null),
		generationLimit: { from: a.body.max_tokens, to: b.body.max_tokens },
		model: { from: a.body.model, to: b.body.model },
		endpoint: { from: a.capture.payload.url, to: b.capture.payload.url },
	};
}

const root = process.argv[2] ?? "/tmp/cpai-w2";
const outPath = process.argv[3];

const wires = new Map<number, { body: WireBody; capture: CaptureFile }>();
for (const [iteration, stem] of Object.entries(CAPTURE_BY_ITERATION)) {
	const capture = readCapture(root, stem, "wire_request");
	wires.set(Number(iteration), {
		capture,
		body: JSON.parse(capture.payload.body) as WireBody,
	});
}

const pairs = [
	[78, 79],
	[79, 80],
	[80, 81],
].map(([from, to]) => comparePair(wires.get(from)!, wires.get(to)!));

const selectorCapture = readCapture(root, SELECTOR_CAPTURE, "wire_request");
const selectorBody = JSON.parse(selectorCapture.payload.body) as WireBody;
const selectorMessages = Array.isArray(selectorBody.messages)
	? selectorBody.messages
	: [];
const parent80 = wires.get(80)!;

const report = {
	actId: "ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01",
	c1: "C1.1 MiniMax R2 historical prefix divergence",
	evidenceClass: "REAL_PRODUCTION_SEAM",
	captureArchive: {
		name: "arm-a-r2-cache-discriminator.tar.gz",
		sha256: "28d38cbe24d94bddbc02787304f55a735374e4771c266d5600fa1842cb363914",
		members: 12,
	},
	pairs,
	selector: {
		systemChars: systemText(selectorBody).length,
		messageCount: selectorMessages.length,
		toolCount: Array.isArray(selectorBody.tools)
			? selectorBody.tools.length
			: 0,
		model: selectorBody.model,
		endpoint: selectorCapture.payload.url,
		systemCommonPrefixCharsWithParent80: commonPrefixLength(
			systemText(selectorBody),
			systemText(parent80.body),
		),
		systemCommonPrefixCharsWithParent78: commonPrefixLength(
			systemText(selectorBody),
			systemText(wires.get(78)!.body),
		),
	},
	claims: {
		CLIENT_SIDE_PREFIX_DIVERGENCE: pairs.map((p) => ({
			from: p.from,
			to: p.to,
			firstDivergentSystemChar: p.firstDivergentSystemChar,
		})),
		DOCUMENTED_CACHE_COMPATIBILITY:
			"DOCUMENTED — from the frozen usage records in the archive; not re-derived here",
		OBSERVED_CACHE_DISCONTINUITY:
			"DOCUMENTED — the frozen captures record cache-read discontinuity at 79 -> 80; not re-derived here",
		SERVER_SIDE_CACHE_CAUSALITY: "LIVE_UNOBSERVABLE",
	},
};

const text = `${JSON.stringify(report, null, 2)}\n`;
if (outPath) {
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, text);
}
process.stdout.write(text);
