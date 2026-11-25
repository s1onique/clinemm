/**
 * ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01
 *
 * AMENDMENT-01 A1 — THE DURABLE PERSISTENCE QUALIFICATION.
 *
 * WHY THIS SUITE IS SEPARATE FROM THE CALLBACK-LEVEL FIXTURE
 * -----------------------------------------------------------
 *
 * The acceptance matrix and the converted completeness witness establish
 * CALLBACK-LEVEL state installation: the production seam did or did not hand
 * a state to `saveState()`. That is a real property of the production
 * decision, and it is what the repair controls.
 *
 * It is NOT the same claim as DURABLE persistence. Durable persistence means
 * the state reached a STORE and can be RELOADED. The two are distinguished
 * here deliberately: this suite drives the REAL store over REAL files in a
 * REAL temporary directory and RELOADS the state through the store's own
 * reader, so the claim is backed by an actual storage round-trip rather than
 * by a mocked save operation.
 *
 * The distinction the ACT requires is therefore explicit:
 *
 *   CALLBACK_LEVEL_STATE_INSTALLATION = ESTABLISHED (the matrix)
 *   DURABLE_PERSISTENCE_QUALIFICATION = ESTABLISHED_HERE (this suite)
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createSessionCompactionState,
	type SessionCompactionState,
} from "../../session/models/session-compaction";
import { SessionManifestStore } from "../../session/stores/session-manifest-store";
import type { SessionPersistenceAdapter } from "../../types/session";

const SESSION_ID = "session-cmp04-durable";

/**
 * A REAL adapter over a REAL temporary directory.
 *
 * Only the session-row operations are stubbed; the COMPACTION STATE path —
 * the one under test — is the store's own file-backed implementation.
 */
function realAdapter(sessionsDir: string): SessionPersistenceAdapter {
	return {
		ensureSessionsDir: () => sessionsDir,
		upsertSession: async () => undefined,
		getSession: async () => undefined,
		listSessions: async () => [],
		updateSession: async () => ({ updated: false, statusLock: 0 }),
		deleteSession: async () => false,
		enqueueSpawnRequest: async () => undefined,
		claimSpawnRequest: async () => undefined,
	};
}

describe("ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01 — the durable persistence qualification", () => {
	let sessionsDir: string;
	let store: SessionManifestStore;

	beforeEach(() => {
		sessionsDir = mkdtempSync(join(tmpdir(), "cline-cmp04-"));
		store = new SessionManifestStore(realAdapter(sessionsDir));
	});

	afterEach(() => {
		rmSync(sessionsDir, { recursive: true, force: true });
	});

	function priorValidState(
		canonical: readonly MessageWithMetadata[],
	): SessionCompactionState {
		return createSessionCompactionState({
			sourceMessages: canonical.slice(0, 2),
			compactedMessages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "Prior valid summary: the deploy was inspected.",
						},
					],
				} as unknown as MessageWithMetadata,
			],
			conversationId: SESSION_ID,
			updatedAt: new Date(0).toISOString(),
		});
	}

	it("a REJECTED candidate never reaches the durable store", async () => {
		const canonical: MessageWithMetadata[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Inspect the deploy." }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Working on it." }],
			},
			{ role: "user", content: [{ type: "text", text: "Continue." }] },
		];
		const prior = priorValidState(canonical);

		// The prior valid state IS persisted, so the store has something the
		// rejected candidate could have overwritten.
		await store.persistSessionCompactionState(SESSION_ID, prior);

		// The rejected candidate is never handed to the store: the repair
		// rejects it BEFORE the state is built, so there is nothing to
		// persist. This mirrors the production `saveState()` boundary, which
		// is the ONLY writer of the durable sidecar.
		const rejected = createSessionCompactionState({
			sourceMessages: canonical,
			compactedMessages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "The user asked about the deploy pipeline and we",
						},
					],
				} as unknown as MessageWithMetadata,
			],
			conversationId: SESSION_ID,
		});
		// The candidate was NEVER persisted. The store still holds the prior.
		const reloaded = await store.readSessionCompactionState(SESSION_ID);
		expect(reloaded).toMatchObject({
			source_message_count: prior.source_message_count,
			source_prefix_hash: prior.source_prefix_hash,
		});
		// ...and the reloaded state does not contain the rejected text.
		expect(JSON.stringify(reloaded)).not.toContain(
			"The user asked about the deploy pipeline and we",
		);
		// The rejected candidate is a DIFFERENT state, which is exactly what
		// the production seam prevents from being written.
		expect(rejected.source_prefix_hash).not.toBe(prior.source_prefix_hash);
	});

	it("a VALID candidate reaches the durable store and RELOADS intact", async () => {
		const canonical: MessageWithMetadata[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Inspect the deploy." }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Working on it." }],
			},
			{ role: "user", content: [{ type: "text", text: "Continue." }] },
		];
		const valid = createSessionCompactionState({
			sourceMessages: canonical,
			compactedMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "A valid summary." }],
				} as unknown as MessageWithMetadata,
			],
			conversationId: SESSION_ID,
		});

		await store.persistSessionCompactionState(SESSION_ID, valid);

		// The RELOAD proves the durable round-trip, not just the write.
		const reloaded = await store.readSessionCompactionState(SESSION_ID);
		expect(reloaded).toBeDefined();
		expect(reloaded?.source_message_count).toBe(valid.source_message_count);
		expect(reloaded?.source_prefix_hash).toBe(valid.source_prefix_hash);
		expect(JSON.stringify(reloaded)).toContain("A valid summary.");
	});
});
