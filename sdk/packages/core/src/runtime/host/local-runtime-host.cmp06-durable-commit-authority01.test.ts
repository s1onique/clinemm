/**
 * ACT-CLINEMM-CMP06-DURABLE-COMMIT-AUTHORITY-01.
 *
 * THE DURABLE COMMIT AUTHORITY QUALIFICATION.
 *
 * WHAT THIS ESTABLISHES
 * ----------------------
 *
 * The CMP-05 repair gave the compaction seam a cancellation authority at
 * the INSTALLATION COMMIT POINT: `isInstallationCancelled(context.abortSignal)`
 * is consulted IMMEDIATELY BEFORE `saveState()` is invoked.
 *
 * That check is correct AT THE SEAM, but the seam's `saveState()` is not
 * the durable commit point. The production chain is:
 *
 *   saveState
 *     -> persistActiveSessionCompactionState
 *       -> enqueueCompactionStateWrite          <-- ASYNCHRONOUS QUEUE
 *         -> persistSessionCompactionState
 *           -> writeFileAtomic                   <-- THE DURABLE REPLACEMENT
 *
 * `enqueueCompactionStateWrite` SERIALIZES the session's compaction-state
 * writes behind `session.compactionStateWriteQueue`. A write that arrives
 * while an earlier write is still in flight is QUEUED and does not touch
 * the filesystem until the earlier write resolves.
 *
 * So there is a WINDOW between the seam's cancellation check and the
 * durable replacement: the candidate can be accepted, handed to `saveState`,
 * queued, and THEN the user cancels — while the candidate is still queued
 * and no atomic replacement has begun.
 *
 * THE DISCRIMINATOR
 * -----------------
 *
 * Hold an existing session write using deterministic synchronization.
 * Submit a valid compaction-state installation BEHIND that write. Signal
 * cancellation while the compaction write remains QUEUED and before the
 * atomic replacement begins. Release the preceding write.
 *
 * The candidate MUST NOT be persisted: the previously installed state must
 * remain exactly as it was, and no successful compaction may be published.
 *
 * DETERMINISM
 * -----------
 *
 * Every gate in this suite is a promise the test controls. There is no
 * sleep, no timer and no wall-clock race:
 *
 *   - the store holds the first write on an explicit promise;
 *   - the queue's enqueue is OBSERVED through the host's own
 *     `compactionStateWriteQueue` pointer (the same test-hook style the
 *     existing `local-runtime-host.test.ts` uses for `Reflect.get`), and
 *     the observation drains the microtask queue with `setImmediate`, so
 *     "the candidate is queued" is a PROVEN fact, not a timing guess;
 *   - the cancellation is signalled from the test, at the proven moment.
 *
 * The suite drives the REAL production queue and the REAL production
 * persistence path (the real `SessionManifestStore` over REAL files in a
 * REAL disposable directory), and it reuses the SAME `AbortSignal` the
 * compaction seam already consults. It does not substitute `saveState`
 * with an immediate in-memory assignment.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSessionService } from "../../session/services/file-session-service";
import { MessageBuilder } from "../../session/services/message-builder";
import type { CoreSessionConfig } from "../../types/config";
import { LocalRuntimeHost as RuntimeHostUnderTest } from "./local-runtime-host";
import { type StartSessionInput, splitCoreSessionConfig } from "./runtime-host";

const distinctId = "cmp06-durable-commit-authority";

/**
 * A deterministic gate. The test controls exactly when it opens; there is
 * no timer and no polling anywhere in this suite.
 */
function createGate(): {
	readonly wait: Promise<void>;
	readonly open: () => void;
} {
	let open!: () => void;
	const wait = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { wait, open };
}

/**
 * Drains the microtask queue completely.
 *
 * `setImmediate` is a MACROTASK, so one turn runs every pending microtask
 * first. The production path from the seam's cancellation check to the
 * queue enqueue is entirely microtask hops (no I/O), so a bounded number
 * of turns deterministically reaches the enqueue. This is an ordering
 * guarantee of the event loop, not a timing assumption.
 */
async function drainMicrotasks(turns = 25): Promise<void> {
	for (let index = 0; index < turns; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

function createConfig(
	overrides: Partial<CoreSessionConfig> = {},
): CoreSessionConfig {
	return {
		providerId: "mock-provider",
		modelId: "mock-model",
		cwd: "/tmp/project",
		systemPrompt: "You are a test agent",
		mode: "act",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		...overrides,
	};
}

function normalizeStartInput(
	input: Omit<StartSessionInput, "config" | "localRuntime"> & {
		config: CoreSessionConfig;
	},
): StartSessionInput {
	const split = splitCoreSessionConfig(input.config);
	return { ...input, ...split };
}

function canonicalMessages(count: number): MessageWithMetadata[] {
	return canonicalMessagesFrom(0, count);
}

/**
 * Canonical messages whose INDICES continue from `start`.
 *
 * The compaction sidecar's source-prefix identity is a HASH over the
 * canonical prefix, so an extended history must EXTEND the previous one
 * message-for-message. A fixture that restarts the index would not
 * project, and the suite would silently measure the wrong path.
 */
function canonicalMessagesFrom(
	start: number,
	count: number,
): MessageWithMetadata[] {
	const messages: MessageWithMetadata[] = [];
	for (let index = start; index < start + count; index += 1) {
		messages.push({
			role: index % 2 === 0 ? "user" : "assistant",
			content: [
				{
					type: "text",
					text: `canonical message ${index} ${"x".repeat(2000)}`,
				},
			],
		} as unknown as MessageWithMetadata);
	}
	return messages;
}

type HeldBackend = {
	readonly backend: FileSessionService;
	/** Number of durable replacement attempts that reached the store. */
	readonly attempts: () => number;
	/**
	 * Resolves once AT LEAST `count` durable replacement attempts have
	 * reached the store. The store signals this synchronously when it is
	 * entered, so "the write is at the store" is an observed fact.
	 */
	readonly attempted: (count?: number) => Promise<void>;
	/** The states the store was asked to persist, in order. */
	readonly requested: () => Array<{ sessionId: string; state: unknown }>;
	/** Opens the held write, letting the queue advance. */
	readonly release: () => void;
	/**
	 * ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01: re-arms the
	 * deterministic gate so the NEXT durable replacement is held by a fresh
	 * gate the test opens explicitly.
	 */
	readonly holdNext: () => void;
	/** Makes every subsequent durable replacement fail deterministically. */
	readonly rejectAll: (error: Error) => void;
	/** The absolute path of the session's durable compaction sidecar. */
	readonly compactionPath: (sessionId: string) => string;
};

/**
 * A REAL backend over a REAL disposable directory whose durable replacement
 * can be HELD by a deterministic gate.
 *
 * The gate is a promise the test opens explicitly. There is no timer, no
 * sleep and no polling: the queued write cannot advance until the test
 * opens the gate, so "the compaction write is still queued" is an
 * OBSERVED FACT, not a race.
 */
function createHeldBackend(sessionsDir: string): HeldBackend {
	const real = new FileSessionService(sessionsDir);
	let gate = createGate();
	const requested: Array<{ sessionId: string; state: unknown }> = [];
	const arrivals: Array<() => void> = [];
	let attempts = 0;
	let released = false;
	let rejection: Error | undefined;

	const original = real.persistSessionCompactionState.bind(real);
	(
		real as unknown as { persistSessionCompactionState: unknown }
	).persistSessionCompactionState = async (
		sessionId: string,
		state: unknown,
	) => {
		attempts += 1;
		requested.push({ sessionId, state });
		for (const notify of arrivals.splice(0, arrivals.length)) {
			notify();
		}
		if (!released) {
			await gate.wait;
		}
		if (rejection) {
			throw rejection;
		}
		await original(sessionId, state as never);
	};

	return {
		backend: real,
		attempts: () => attempts,
		attempted: (count = 1) =>
			new Promise<void>((resolve) => {
				if (attempts >= count) {
					resolve();
					return;
				}
				arrivals.push(resolve);
			}),
		requested: () => requested.slice(),
		release: () => {
			released = true;
			gate.open();
		},
		/**
		 * ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01 — RE-ARM
		 * THE GATE.
		 *
		 * The gate is one-shot by default: `release()` opens it for good.
		 * A witness that must hold a SECOND write needs to re-arm it, so
		 * the second write is held by its own gate and the test stays in
		 * control of exactly when it advances.
		 *
		 * This changes nothing about the PRODUCTION path: it is the same
		 * deterministic gate, re-armed.
		 */
		holdNext: () => {
			released = false;
			gate = createGate();
		},
		rejectAll: (error: Error) => {
			rejection = error;
		},
		compactionPath: (sessionId: string) =>
			join(sessionsDir, sessionId, `${sessionId}.compaction.json`),
	};
}

/**
 * The REAL host's compaction seam, captured from the agent config the host
 * built. Its `saveState` is the host's own `saveState`, which runs
 * `persistActiveSessionCompactionState` -> `enqueueCompactionStateWrite` ->
 * the REAL store.
 */
type ProductionPrepareTurn = (
	context: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type HostHarness = {
	readonly manager: RuntimeHostUnderTest;
	readonly liveMessages: MessageWithMetadata[];
	readonly createAgent: ReturnType<typeof vi.fn>;
};

function createHostHarness(backend: FileSessionService): HostHarness {
	const liveMessages: MessageWithMetadata[] = [];
	const createAgent = vi.fn(() => ({
		run: vi.fn(),
		continue: vi.fn(),
		abort: vi.fn(),
		subscribeEvents: vi.fn().mockReturnValue(() => {}),
		canStartRun: vi.fn().mockReturnValue(true),
		getAgentId: vi.fn().mockReturnValue("agent-cmp06"),
		getConversationId: vi.fn().mockReturnValue("conv-cmp06"),
		restore: vi.fn(),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn(() => liveMessages),
		messages: liveMessages,
		prepareProviderMessagesForApi: vi.fn(
			async (messages: MessageWithMetadata[]) => messages,
		),
	}));
	const manager = new RuntimeHostUnderTest({
		distinctId,
		sessionService: backend,
		runtimeBuilder: {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		} as never,
		createAgent: createAgent as never,
	});
	return { manager, liveMessages, createAgent };
}

function buildPrepareTurnContext(input: {
	sessionId: string;
	messages: MessageWithMetadata[];
	abortSignal: AbortSignal;
	emitStatusNotice?: (
		message: string,
		metadata?: Record<string, unknown>,
	) => void;
}): Record<string, unknown> {
	return {
		agentId: "agent-cmp06",
		conversationId: input.sessionId,
		parentAgentId: null,
		iteration: 1,
		messages: input.messages,
		apiMessages: input.messages,
		abortSignal: input.abortSignal,
		systemPrompt: "You are a test agent",
		tools: [],
		model: {
			id: "mock-model",
			provider: "mock-provider",
			// A SMALL model limit so the production auto-compaction
			// trigger is reached deterministically by the fixture
			// messages: `shouldCompact` is a production decision and the
			// suite must not stub it out.
			info: { id: "mock-model", maxInputTokens: 400 },
		},
		emitStatusNotice: input.emitStatusNotice ?? (() => {}),
	};
}

/**
 * The EFFECTIVE provider-visible projection of a seam's preparation result.
 *
 * The provider-visible transcript is what the runtime actually sends to the
 * provider on the next turn. A candidate that was refused must be ABSENT
 * from it: the refusal has to hold not only in the persisted sidecar but
 * also in the transcript the provider sees.
 *
 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-01 A2) —
 * THE PRODUCTION CONSUMER'S FALLBACK.
 *
 * The previous form read `result?.messages ?? []`. That is VACUOUS for a
 * metadata-only preparation result: the CMP-06/CMP-07 refusal path returns
 * `publishWorkingContextEstimateMetadataOnly(...)`, which publishes the
 * working-context estimate and NOTHING else. `result.messages` is
 * therefore `undefined`, `?? []` produced an EMPTY transcript, and the
 * assertion "the rejected candidate is absent" passed vacuously — it
 * excluded the candidate by excluding EVERYTHING.
 *
 * The production consumer is the agent runtime's
 * `prepareTurnForModelRequest()` (agent-runtime.ts), and it reads:
 *
 *     let next = request;
 *     if (result.messages) { next = { ...next, messages: cloneMessages(result.messages) }; }
 *     if (result.systemPrompt !== undefined) { next = { ...next, systemPrompt: result.systemPrompt }; }
 *     return next;
 *
 * So when the preparation result carries METADATA BUT NO REPLACEMENT
 * MESSAGES, the consumer keeps the ORIGINAL request messages. The
 * effective projection is therefore the ORIGINAL history, not an empty
 * transcript.
 *
 * This helper reproduces that fallback EXACTLY: it takes the original
 * request messages and replaces them with the result's messages only when
 * the result actually carries some.
 *
 * The projection is produced by the REAL `MessageBuilder`, so it is the
 * same projection the production runtime builds.
 */
function providerVisibleProjection(
	result: Record<string, unknown> | undefined,
	originalMessages: readonly MessageWithMetadata[],
): string {
	const replacement = result?.messages as
		| readonly MessageWithMetadata[]
		| undefined;
	const effective =
		replacement !== undefined && replacement !== null
			? replacement
			: originalMessages;
	const messages = effective as unknown as Parameters<
		MessageBuilder["buildForApi"]
	>[0];
	return JSON.stringify(new MessageBuilder().buildForApi(messages));
}

/**
 * The host's own compaction-state write queue pointer for a session.
 *
 * `enqueueCompactionStateWrite` REPLACES this pointer with a new promise
 * when it enqueues a write, so a changed identity PROVES that a write was
 * enqueued behind the previous one. This is the same test-hook style the
 * existing `local-runtime-host.test.ts` uses (`Reflect.get(target, ...)`).
 */
function readWriteQueuePointer(
	manager: RuntimeHostUnderTest,
	sessionId: string,
): Promise<void> | undefined {
	const sessions = Reflect.get(manager, "sessions") as
		| Map<string, { compactionStateWriteQueue?: Promise<void> }>
		| undefined;
	return sessions?.get(sessionId)?.compactionStateWriteQueue;
}

describe("ACT-CLINEMM-CMP06-DURABLE-COMMIT-AUTHORITY-01 — the durable commit authority", () => {
	let sessionsDir: string;
	let host: RuntimeHostUnderTest | undefined;

	beforeEach(() => {
		sessionsDir = mkdtempSync(join(tmpdir(), "cline-cmp06-"));
	});

	afterEach(async () => {
		await host?.dispose();
		host = undefined;
		rmSync(sessionsDir, { recursive: true, force: true });
	});

	/**
	 * Starts a session with the production compaction seam and returns the
	 * seam's `prepareTurn`, the session's live message list and the
	 * notices the seam published.
	 */
	async function startCompactingSession(input: {
		sessionId: string;
		backend: FileSessionService;
		messages: MessageWithMetadata[];
		compact: () => Promise<unknown>;
		notices: Array<{ message: string; metadata?: unknown }>;
	}): Promise<{
		prepareTurn: ProductionPrepareTurn;
		harness: HostHarness;
	}> {
		const harness = createHostHarness(input.backend);
		host = harness.manager;
		harness.liveMessages.push(...input.messages);
		await harness.manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId: input.sessionId,
					cwd: sessionsDir,
					workspaceRoot: sessionsDir,
					enableAgentTeams: false,
					compaction: {
						enabled: true,
						strategy: "basic",
						compact: input.compact as never,
					},
				}),
				initialMessages: input.messages,
				interactive: true,
			}),
		);
		const prepareTurn = harness.createAgent.mock.calls[0]?.[0]?.prepareTurn as
			| ProductionPrepareTurn
			| undefined;
		if (!prepareTurn) {
			throw new Error("production prepareTurn seam unavailable");
		}
		return { prepareTurn, harness };
	}

	// ── THE DISCRIMINATOR ───────────────────────────────────────────────

	it("REFUSES a compaction-state installation that is cancelled while QUEUED behind an in-flight write", async () => {
		const sessionId = "cmp06-queued-cancellation";
		const held = createHeldBackend(sessionsDir);
		const messages = canonicalMessages(4);
		const summary = { index: 0 };
		const notices: Array<{ message: string; metadata?: unknown }> = [];

		const { prepareTurn, harness } = await startCompactingSession({
			sessionId,
			backend: held.backend,
			messages,
			notices,
			compact: async () => {
				summary.index += 1;
				return {
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: `CANDIDATE SUMMARY ${summary.index}`,
								},
							],
						},
					] as unknown as MessageWithMetadata[],
				};
			},
		});

		// The controller is the SAME abort signal the compaction seam
		// consults at its installation authority check.
		const controller = new AbortController();
		const notice = (message: string, metadata?: Record<string, unknown>) => {
			notices.push({ message, metadata });
		};

		// ── WRITE #1: the prior installation. It reaches the store and is
		//    HELD there by the deterministic gate.
		const first = prepareTurn(
			buildPrepareTurnContext({
				sessionId,
				messages,
				abortSignal: controller.signal,
				emitStatusNotice: notice,
			}),
		);
		await held.attempted();
		const pointerAfterFirst = readWriteQueuePointer(harness.manager, sessionId);
		expect(pointerAfterFirst).toBeDefined();

		// ── WRITE #2: the candidate installation, submitted BEHIND the held
		//    write. The production queue must ENQUEUE it: the pointer is
		//    REPLACED with a new promise.
		const second = prepareTurn(
			buildPrepareTurnContext({
				sessionId,
				messages: [...messages, ...canonicalMessagesFrom(messages.length, 2)],
				abortSignal: controller.signal,
				emitStatusNotice: notice,
			}),
		);
		let pointerAfterSecond = pointerAfterFirst;
		for (let attempt = 0; attempt < 25; attempt += 1) {
			pointerAfterSecond = readWriteQueuePointer(harness.manager, sessionId);
			if (pointerAfterSecond !== pointerAfterFirst) break;
			await drainMicrotasks(1);
		}
		// PROVEN: the candidate was ENQUEUED behind the held write, and it
		// has NOT reached the store yet.
		expect(pointerAfterSecond).not.toBe(pointerAfterFirst);
		expect(held.attempts()).toBe(1);

		// ── CANCELLATION: signalled while the compaction write is still
		//    QUEUED and BEFORE the atomic replacement begins.
		controller.abort(new Error("cmp06: user cancelled the turn"));

		// ── RELEASE the preceding write, letting the queue advance.
		held.release();

		await first;
		const secondResult = await second;

		// The candidate must NOT have been persisted: the store must hold
		// the PRIOR state, not the candidate.
		const persisted = await held.backend.readSessionCompactionState(sessionId);
		expect(persisted).toBeDefined();
		const persistedText = JSON.stringify(persisted);
		expect(persistedText).toContain("CANDIDATE SUMMARY 1");
		expect(persistedText).not.toContain("CANDIDATE SUMMARY 2");

		// ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01 — THE
		// RETURNED PROVIDER-VISIBLE PROJECTION.
		//
		// The refusal must hold in the transcript the runtime actually
		// sends to the provider, not only in the persisted sidecar. The
		// REJECTED candidate must be ABSENT from the projection the refused
		// installation returned.
		// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
		// (AMENDMENT-01 A2) — THE EFFECTIVE PROJECTION.
		//
		// The preparation result of a refused installation is METADATA-ONLY:
		// it carries the working-context estimate and no replacement
		// messages. The production consumer therefore KEEPS the original
		// request messages, so the effective projection is the ORIGINAL
		// history — not an empty transcript.
		//
		// The refused candidate must be absent from it, AND the original
		// history must be PRESENT. Asserting only the absence would pass
		// vacuously against an empty projection.
		const secondRequestMessages = [
			...messages,
			...canonicalMessagesFrom(messages.length, 2),
		];
		const refusedProjection = providerVisibleProjection(
			secondResult,
			secondRequestMessages,
		);
		expect(refusedProjection).not.toContain("CANDIDATE SUMMARY 2");

		// The projection is NOT EMPTY. An empty transcript would exclude the
		// rejected candidate vacuously, so the absence assertion above would
		// prove nothing. The projection must carry the original history.
		expect(refusedProjection).not.toBe("[]");

		// The ORIGINAL history is conserved: the user's task and the
		// authorized working history are both still there.
		expect(refusedProjection).toContain("canonical message 0");
		expect(refusedProjection).toContain("canonical message 3");
		expect(refusedProjection).toContain("canonical message 4");
		expect(refusedProjection).toContain("canonical message 5");

		// No successful compaction may be published for the refused
		// installation: only the FIRST (legitimately committed)
		// installation may have published one.
		expect(
			notices.filter((entry) => entry.message.endsWith("compacted")),
		).toHaveLength(1);
		expect(notices.map((entry) => entry.message)).toContain(
			"compaction-skipped",
		);
	});

	// ── PUBLICATION CONTROL ─────────────────────────────────────────────

	it("publishes a successful compaction ONLY AFTER the durable replacement resolved", async () => {
		const sessionId = "cmp06-publication-order";
		const held = createHeldBackend(sessionsDir);
		const messages = canonicalMessages(4);
		const notices: Array<{ message: string; metadata?: unknown }> = [];
		const summary = { index: 0 };

		const { prepareTurn } = await startCompactingSession({
			sessionId,
			backend: held.backend,
			messages,
			notices,
			compact: async () => {
				summary.index += 1;
				return {
					messages: [
						{
							role: "user",
							content: [{ type: "text", text: `SUMMARY ${summary.index}` }],
						},
					] as unknown as MessageWithMetadata[],
				};
			},
		});

		const controller = new AbortController();
		const installation = prepareTurn(
			buildPrepareTurnContext({
				sessionId,
				messages,
				abortSignal: controller.signal,
				emitStatusNotice: (message, metadata) => {
					notices.push({ message, metadata });
				},
			}),
		);
		await held.attempted();

		// The persistence is INCOMPLETE: the durable replacement has not
		// begun, so no successful compaction may have been published yet.
		expect(
			notices.filter((entry) => entry.message.endsWith("compacted")),
		).toHaveLength(0);

		// Release the persistence and let it resolve.
		held.release();
		await installation;

		// The success is published only AFTER the durable replacement
		// resolved.
		expect(
			notices.filter((entry) => entry.message.endsWith("compacted")),
		).toHaveLength(1);
		const persisted = await held.backend.readSessionCompactionState(sessionId);
		expect(JSON.stringify(persisted)).toContain("SUMMARY 1");
	});

	it("publishes NO successful compaction and keeps the prior state recoverable when the durable replacement is REJECTED", async () => {
		const sessionId = "cmp06-persistence-rejection";
		const held = createHeldBackend(sessionsDir);
		const messages = canonicalMessages(4);
		const notices: Array<{ message: string; metadata?: unknown }> = [];
		const summary = { index: 0 };

		const { prepareTurn } = await startCompactingSession({
			sessionId,
			backend: held.backend,
			messages,
			notices,
			compact: async () => {
				summary.index += 1;
				return {
					messages: [
						{
							role: "user",
							content: [{ type: "text", text: `SUMMARY ${summary.index}` }],
						},
					] as unknown as MessageWithMetadata[],
				};
			},
		});

		const controller = new AbortController();

		// ── the PRIOR installation succeeds and becomes the durable state.
		const prior = prepareTurn(
			buildPrepareTurnContext({
				sessionId,
				messages,
				abortSignal: controller.signal,
				emitStatusNotice: (message, metadata) => {
					notices.push({ message, metadata });
				},
			}),
		);
		await held.attempted();
		held.release();
		await prior;

		// The prior state is durable. Its BYTES are captured BEFORE the
		// rejected operation, so the comparison is against a snapshot and
		// not against the same mutable object.
		const priorBytes = readFileSync(held.compactionPath(sessionId), "utf8");
		expect(priorBytes).toContain("SUMMARY 1");

		// ── the REJECTED installation.
		held.rejectAll(new Error("cmp06: deterministic persistence rejection"));
		notices.length = 0;
		const rejected = prepareTurn(
			buildPrepareTurnContext({
				sessionId,
				messages: [...messages, ...canonicalMessagesFrom(messages.length, 2)],
				abortSignal: controller.signal,
				emitStatusNotice: (message, metadata) => {
					notices.push({ message, metadata });
				},
			}),
		);
		await held.attempted(2);
		const rejectedResult = await rejected;

		// No successful compaction was published for the rejected write.
		expect(
			notices.filter((entry) => entry.message.endsWith("compacted")),
		).toHaveLength(0);

		// ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01 — A
		// PERSISTENCE FAILURE IS NOT A CANCELLATION.
		//
		// The turn was NOT cancelled: the abort signal never fired. The
		// write failed because the durable replacement was REJECTED, which
		// is a DIFFERENT fact with a DIFFERENT remedy — a persistence
		// failure is retried or surfaced, a cancellation is not.
		//
		// The compaction's own diagnostics must therefore NOT report this
		// as a cancellation. The signal is the authority, and it never
		// fired.
		expect(controller.signal.aborted).toBe(false);
		const rejectedNotices = notices.filter((entry) =>
			entry.message.endsWith("compaction-skipped"),
		);
		for (const notice of rejectedNotices) {
			const metadata = (notice.metadata ?? {}) as Record<string, unknown>;
			expect(metadata.rejectionReason).not.toBe("cancelled");
			expect(metadata.phase).not.toBe("durable_commit");
		}

		// ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01 — THE
		// RETURNED PROVIDER-VISIBLE PROJECTION.
		//
		// The rejected candidate must be absent from the transcript the
		// runtime actually sends to the provider.
		// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
		// (AMENDMENT-01 A2) — THE EFFECTIVE PROJECTION.
		//
		// The rejected candidate is absent from the transcript the runtime
		// actually sends to the provider, and the ORIGINAL history is
		// PRESENT in it. The presence assertions are what make the absence
		// assertion non-vacuous.
		const rejectedRequestMessages = [
			...messages,
			...canonicalMessagesFrom(messages.length, 2),
		];
		const rejectedProjection = providerVisibleProjection(
			rejectedResult,
			rejectedRequestMessages,
		);
		expect(rejectedProjection).not.toContain("SUMMARY 2");
		expect(rejectedProjection).not.toBe("[]");
		expect(rejectedProjection).toContain("canonical message 0");
		expect(rejectedProjection).toContain("canonical message 5");

		// The prior valid persisted state remains BYTE-IDENTICAL: the
		// rejected replacement was never exposed.
		const afterBytes = readFileSync(held.compactionPath(sessionId), "utf8");
		expect(afterBytes).toBe(priorBytes);
		expect(afterBytes).not.toContain("SUMMARY 2");

		// ...and it is still recoverable through the production reader.
		const recovered = await held.backend.readSessionCompactionState(sessionId);
		expect(recovered).toBeDefined();
		expect(JSON.stringify(recovered)).toContain("SUMMARY 1");
		expect(JSON.stringify(recovered)).not.toContain("SUMMARY 2");
	});

	// ── CONSERVATION ────────────────────────────────────────────────────

	it("installs a NORMAL first compaction and restores it through the production persistence reader", async () => {
		const sessionId = "cmp06-first-compaction";
		const held = createHeldBackend(sessionsDir);
		const messages = canonicalMessages(4);
		const notices: Array<{ message: string; metadata?: unknown }> = [];
		const summary = { index: 0 };

		const { prepareTurn } = await startCompactingSession({
			sessionId,
			backend: held.backend,
			messages,
			notices,
			compact: async () => {
				summary.index += 1;
				return {
					messages: [
						{
							role: "user",
							content: [
								{ type: "text", text: `FIRST SUMMARY ${summary.index}` },
							],
						},
					] as unknown as MessageWithMetadata[],
				};
			},
		});

		const controller = new AbortController();
		const installation = prepareTurn(
			buildPrepareTurnContext({
				sessionId,
				messages,
				abortSignal: controller.signal,
				emitStatusNotice: (message, metadata) => {
					notices.push({ message, metadata });
				},
			}),
		);
		await held.attempted();
		held.release();
		await installation;

		// The normal installation commits and publishes its success.
		expect(
			notices.filter((entry) => entry.message.endsWith("compacted")),
		).toHaveLength(1);

		// The state is durable and restores through the production reader.
		const restored = await held.backend.readSessionCompactionState(sessionId);
		expect(restored).toBeDefined();
		expect(restored?.source_message_count).toBe(4);
		expect(JSON.stringify(restored)).toContain("FIRST SUMMARY 1");
	});

	it("installs a NORMAL re-compaction and restores it through the production persistence reader", async () => {
		const sessionId = "cmp06-recompaction";
		const held = createHeldBackend(sessionsDir);
		const messages = canonicalMessages(4);
		const notices: Array<{ message: string; metadata?: unknown }> = [];
		const summary = { index: 0 };

		const { prepareTurn } = await startCompactingSession({
			sessionId,
			backend: held.backend,
			messages,
			notices,
			compact: async () => {
				summary.index += 1;
				return {
					messages: [
						{
							role: "user",
							content: [{ type: "text", text: `SUMMARY ${summary.index}` }],
						},
					] as unknown as MessageWithMetadata[],
				};
			},
		});

		const controller = new AbortController();
		const notice = (message: string, metadata?: Record<string, unknown>) => {
			notices.push({ message, metadata });
		};

		// ── the FIRST compaction.
		const first = prepareTurn(
			buildPrepareTurnContext({
				sessionId,
				messages,
				abortSignal: controller.signal,
				emitStatusNotice: notice,
			}),
		);
		await held.attempted();
		held.release();
		await first;
		const firstBytes = readFileSync(held.compactionPath(sessionId), "utf8");
		expect(firstBytes).toContain("SUMMARY 1");

		// ── the RE-compaction over an EXTENDED canonical history.
		const extended = [
			...messages,
			...canonicalMessagesFrom(messages.length, 2),
		];
		const second = prepareTurn(
			buildPrepareTurnContext({
				sessionId,
				messages: extended,
				abortSignal: controller.signal,
				emitStatusNotice: notice,
			}),
		);
		await held.attempted(2);
		held.release();
		await second;

		// The re-compaction committed and published its own success.
		expect(
			notices.filter((entry) => entry.message.endsWith("compacted")),
		).toHaveLength(2);

		// The re-compacted state is durable and restores through the
		// production reader.
		const restored = await held.backend.readSessionCompactionState(sessionId);
		expect(restored).toBeDefined();
		expect(restored?.source_message_count).toBe(6);
		expect(JSON.stringify(restored)).toContain("SUMMARY 2");

		// The prior persisted state was REPLACED by the re-compaction: the
		// bytes differ, because the re-compaction covers a longer
		// canonical prefix.
		const secondBytes = readFileSync(held.compactionPath(sessionId), "utf8");
		expect(secondBytes).not.toBe(firstBytes);
	});

	it("conserves the PRIOR persisted state byte-for-byte across a refused installation", async () => {
		const sessionId = "cmp06-prior-bytes";
		const held = createHeldBackend(sessionsDir);
		const messages = canonicalMessages(4);
		const notices: Array<{ message: string; metadata?: unknown }> = [];
		const summary = { index: 0 };

		const { prepareTurn } = await startCompactingSession({
			sessionId,
			backend: held.backend,
			messages,
			notices,
			compact: async () => {
				summary.index += 1;
				return {
					messages: [
						{
							role: "user",
							content: [{ type: "text", text: `SUMMARY ${summary.index}` }],
						},
					] as unknown as MessageWithMetadata[],
				};
			},
		});

		const controller = new AbortController();
		const notice = (message: string, metadata?: Record<string, unknown>) => {
			notices.push({ message, metadata });
		};

		// ── the PRIOR installation. It is HELD at the store so the
		// refused installation can be submitted BEHIND it.
		const first = prepareTurn(
			buildPrepareTurnContext({
				sessionId,
				messages,
				abortSignal: controller.signal,
				emitStatusNotice: notice,
			}),
		);
		await held.attempted();

		// ── the PRIOR installation is RELEASED and allowed to commit, so
		//    the durable bytes exist and can be SNAPSHOTTED BEFORE the
		//    refused operation.
		//
		// ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01 — THE
		// BYTE-CONSERVATION WITNESS IS CORRECTED.
		//
		// The witness previously took BOTH snapshots AFTER the refused
		// operation, so it compared the file with ITSELF and could not
		// distinguish "the refused candidate never reached the file" from
		// "the refused candidate reached the file and the file happened to
		// be unchanged". The BEFORE snapshot is what makes the comparison a
		// conservation proof.
		held.release();
		await first;

		// The PRIOR snapshot: taken from the bytes that are actually on
		// disk, BEFORE the refused operation is even submitted.
		const priorBytes = readFileSync(held.compactionPath(sessionId), "utf8");
		expect(priorBytes).toContain("SUMMARY 1");

		// ── WRITE #2: the HOLDING write. It reaches the store and is held
		//    there by the deterministic gate, so WRITE #3 stays QUEUED.
		held.holdNext();
		const holding = prepareTurn(
			buildPrepareTurnContext({
				sessionId,
				messages: [...messages, ...canonicalMessagesFrom(messages.length, 2)],
				abortSignal: controller.signal,
				emitStatusNotice: notice,
			}),
		);
		await held.attempted(2);

		// ── WRITE #3: the REFUSED installation, submitted BEHIND the held
		//    write, so it is still QUEUED when the cancellation is signalled
		//    and BEFORE the atomic replacement of the holding write begins.
		const second = prepareTurn(
			buildPrepareTurnContext({
				sessionId,
				messages: [...messages, ...canonicalMessagesFrom(messages.length, 4)],
				abortSignal: controller.signal,
				emitStatusNotice: notice,
			}),
		);
		await drainMicrotasks(5);
		// PROVEN: the refused write has NOT reached the store — it is still
		// queued behind the holding write.
		expect(held.attempts()).toBe(2);

		// ── CANCELLATION: signalled while WRITE #3 is still QUEUED.
		controller.abort(new Error("cmp06: user cancelled the turn"));
		held.release();
		await holding;
		const secondResult = await second;

		// The REFUSED candidate never reached the durable file. The file
		// holds the HOLDING write's state, which committed while the refused
		// write was still queued — and the refused candidate is absent from
		// it.
		const afterBytes = readFileSync(held.compactionPath(sessionId), "utf8");
		expect(afterBytes).not.toContain("SUMMARY 3");
		expect(afterBytes).not.toBe(priorBytes);

		// The restored state is the HOLDING write's, and the refused
		// candidate never reaches it.
		const restored = await held.backend.readSessionCompactionState(sessionId);
		expect(restored).toBeDefined();
		expect(JSON.stringify(restored)).toContain("SUMMARY 2");
		expect(JSON.stringify(restored)).not.toContain("SUMMARY 3");

		// ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01 — THE
		// RETURNED PROVIDER-VISIBLE PROJECTION.
		//
		// The refused candidate must be absent from the transcript the
		// runtime actually sends to the provider.
		// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
		// (AMENDMENT-01 A2) — THE EFFECTIVE PROJECTION.
		const thirdRequestMessages = [
			...messages,
			...canonicalMessagesFrom(messages.length, 4),
		];
		const refusedProjection = providerVisibleProjection(
			secondResult,
			thirdRequestMessages,
		);
		expect(refusedProjection).not.toContain("SUMMARY 3");
		expect(refusedProjection).not.toBe("[]");
		expect(refusedProjection).toContain("canonical message 0");
		expect(refusedProjection).toContain("canonical message 7");
	});
});
