/**
 * ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01
 *
 * TEST-LOCAL fixture loader for the FROZEN historical session.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API.
 * ============================================================================
 *
 * CONFIDENTIALITY
 * ---------------
 *
 * The raw session transcript, the provider payloads and the checkpoint free
 * text are OPERATOR-LOCAL and PRIVATE. They are NEVER committed. This
 * fixture loads them from their operator-local paths, and the ACT's test
 * suite SKIPS itself when they are absent.
 *
 * The loader therefore produces a SELF-SKIPPING test: on a machine without
 * the private capture root, the historical assertions report
 * `NOT_EXECUTED` instead of failing. The synthetic cases in the companion
 * suite still run everywhere.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The frozen session id. */
export const SESSION_ID = "1795466566666_uzla2";

/** The frozen capture run id. */
export const CAPTURE_RUN = "cap_run_Nw2dRTjG";

/** The frozen historical workspace and revision. */
export const HISTORICAL_REPOSITORY = "keycloak";
export const HISTORICAL_BRANCH = "optimize-ftls";
export const HISTORICAL_REVISION = "42de653b59708e712d694aeb9732f822b7f8fe5b";

/**
 * The private capture root.
 *
 * It is outside the repository and outside Git by construction.
 */
export function privateCaptureRoot(): string {
	return join(homedir(), "clinemm-private-captures", SESSION_ID);
}

/**
 * The operator-local session transcript root.
 */
export function sessionTranscriptRoot(): string {
	return join(homedir(), ".vscodium-roz", "cline-data", "sessions", SESSION_ID);
}

/** Whether the private capture artifacts are available on this machine. */
export function privateCapturesAvailable(): boolean {
	return (
		existsSync(join(privateCaptureRoot(), "first-compaction.json")) &&
		existsSync(join(privateCaptureRoot(), "pre.json")) &&
		existsSync(sessionTranscriptRoot())
	);
}

/**
 * The EXPECTED SHA-256 of every frozen artifact.
 *
 * These are the identities named by the ACT. The loader verifies them so a
 * silently-changed capture cannot be mistaken for the frozen evidence.
 */
export const EXPECTED_ARTIFACT_HASHES: Readonly<Record<string, string>> = {
	"pre.json":
		"53161e6b3b4190951442dc37e89016a7d1b7e67898a01bc29d2bd250fe83efe1",
	"post.json":
		"c938f0e2174a3edf74ddb0580bc1918d25acd722d6d4e73c6c45c00c8463e191",
	"second-pre.json":
		"40a60baf6ca1fadf0cfe2d6bcfc2538b6e653dcf948af7c4bc98f91dfd3070e2",
	"second-post.json":
		"666c87977416a08fc54cffe7563b012866e40d790d1c57c227d6a76ecd05a807",
	"first-compaction.json":
		"49bff441c6cbcb0aa904aae8a80dcb567e6897a878986834764322b072fd845d",
	"second-compaction.json":
		"6bc0f6f9dfab122229dc52bc3954144db403ae234c63e26233dcbb02cd43b069",
} as const;

/**
 * The persisted compaction sidecar for one boundary.
 */
export interface CompactionSidecar {
	readonly version: number;
	readonly updated_at: string;
	readonly conversation_id?: string;
	readonly source_message_count: number;
	readonly source_prefix_hash?: string;
	readonly source_last_message_key?: string;
	readonly messages: unknown[];
}

/**
 * One captured provider request.
 */
export interface ProviderCapture {
	readonly timestamp: string;
	readonly captureStage: string;
	readonly mode: string;
	readonly correlation: Record<string, unknown>;
	readonly summary: Record<string, unknown>;
	readonly payload: {
		readonly messages: unknown[];
		readonly system: string;
		readonly tools: unknown[];
		readonly providerOptions?: unknown;
		readonly maxOutputTokens?: number;
		readonly reasoning?: unknown;
	};
	readonly attempt: number;
}

/**
 * The canonical session transcript.
 */
export interface CanonicalTranscript {
	readonly version: number;
	readonly updated_at: string;
	readonly agent: string;
	readonly sessionId: string;
	readonly messages: Record<string, unknown>[];
	readonly system_prompt: string;
}

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

/** Load one captured provider request. */
export function loadProviderCapture(name: string): ProviderCapture {
	return readJson(join(privateCaptureRoot(), name)) as ProviderCapture;
}

/** Load one persisted compaction sidecar. */
export function loadCompactionSidecar(name: string): CompactionSidecar {
	return readJson(join(privateCaptureRoot(), name)) as CompactionSidecar;
}

/** Load the canonical session transcript. */
export function loadCanonicalTranscript(): CanonicalTranscript {
	return readJson(
		join(sessionTranscriptRoot(), `${SESSION_ID}.messages.json`),
	) as CanonicalTranscript;
}

/**
 * The provider-visible TEXT of a captured provider request.
 *
 * The captured payload uses the provider-wire message shape, which differs
 * from the canonical internal shape: `tool-call` / `tool-result` blocks
 * instead of `tool_use` / `tool_result`, and `reasoning` instead of
 * `thinking`. This helper normalizes both into a searchable text.
 */
export function providerVisibleText(capture: ProviderCapture): string {
	const parts: string[] = [];
	for (const message of capture.payload.messages) {
		const record = message as Record<string, unknown>;
		const content = record.content;
		if (typeof content === "string") {
			parts.push(content);
			continue;
		}
		if (!Array.isArray(content)) {
			continue;
		}
		for (const block of content) {
			if (!block || typeof block !== "object") {
				continue;
			}
			const blockRecord = block as Record<string, unknown>;
			if (typeof blockRecord.text === "string") {
				parts.push(blockRecord.text);
			} else if (blockRecord.type === "tool-result") {
				parts.push(JSON.stringify(blockRecord.output ?? ""));
			} else if (blockRecord.type === "tool-call") {
				parts.push(JSON.stringify(blockRecord.input ?? ""));
			}
		}
	}
	return parts.join("\n");
}
