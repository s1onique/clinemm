import { type AgentMode, normalizeUserInput } from "@cline/shared";
import { nanoid } from "nanoid";
import type {
	CoreSessionEvent,
	SessionPendingPrompt,
} from "../../types/events";
import type { ActiveSession, PendingPrompt } from "../../types/session";
import type {
	PendingPromptMutationResult,
	PendingPromptsDeleteInput,
	PendingPromptsUpdateInput,
} from "../host/runtime-host";

export type PendingPromptDelivery = "queue" | "steer";

export interface PendingPromptEntry {
	id: string;
	prompt: string;
	mode?: AgentMode;
	delivery: PendingPromptDelivery;
	userImages?: string[];
	userFiles?: string[];
	/**
	 * ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01 (P1 fix):
	 * Optional job correlation token. The host (terminal wake path)
	 * supplies it when the enqueue was driven by a background command
	 * completion; the explicit user path leaves it undefined. Used
	 * only by the optional CCARD capture hooks (drain + dispatch) so
	 * the JSONL can correlate one logical job through C4 → C5 → C6.
	 */
	jobId?: string;
}

export interface PendingPromptQueueState {
	pendingPrompts: PendingPromptEntry[];
}

export interface PendingPromptsControllerDeps {
	getSession(sessionId: string): ActiveSession | undefined;
	emit(event: CoreSessionEvent): void;
	send(input: {
		sessionId: string;
		prompt: string;
		mode?: AgentMode;
		userImages?: string[];
		userFiles?: string[];
	}): Promise<unknown>;
	/**
	 * ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01:
	 *
	 * Optional callback fired AFTER a successful queue enqueue.
	 * The callback receives the entry id that was actually pushed
	 * (or the previously-existing entry that survived the
	 * dedupe-by-prompt match). When undefined the controller is a
	 * no-op (default — keeps the SDK package independent of the
	 * apps/vscode capture module).
	 *
	 * `jobId` is supplied when the host caller knew it (terminal
	 * wake path); undefined otherwise (explicit user follow-up).
	 */
	onEnqueue?: (input: {
		sessionId: string;
		delivery: PendingPromptDelivery;
		promptId: string;
		jobId?: string;
	}) => void;
	/**
	 * ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01 (P0+P1 fix):
	 *
	 * Optional callback fired AFTER the destructive shift but BEFORE
	 * the controller schedules the actual send. The callback receives
	 * the dequeued entry (so C5 `pending_prompt_dequeued` is
	 * observed once and only once per shift, even if the subsequent
	 * dispatch retries). Carries `jobId` so the JSONL can correlate
	 * one logical job through C4 → C5 → C6.
	 *
	 * This hook is the C5 OBSERVATION SEAM; C6 is the distinct
	 * `onBeforeDispatch` hook (see below) so the diagnostic can
	 * distinguish a successful shift (C5=1) from a subsequently
	 * scheduled dispatch (C6=1) versus a duplicate dispatch
	 * (C6=2 with a single C5).
	 *
	 * When undefined the controller is a no-op.
	 */
	onBeforeDrain?: (input: {
		sessionId: string;
		promptId: string;
		delivery: PendingPromptDelivery;
		jobId?: string;
	}) => void;
	/**
	 * ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01 (P0 fix):
	 *
	 * Optional callback fired IMMEDIATELY BEFORE the actual
	 * `deps.send(...)` invocation in the drain loop. This is the
	 * distinct C6 `continuation_scheduled` seam — independent of
	 * the C5 dequeue so a duplicate dispatch (two sends for one
	 * drain) is observable as C6=2 with C5=1.
	 *
	 * Without this hook a re-entry into the dispatch path could be
	 * invisible because the queue has already been drained.
	 *
	 * When undefined the controller is a no-op.
	 */
	onBeforeDispatch?: (input: {
		sessionId: string;
		promptId: string;
		delivery: PendingPromptDelivery;
		jobId?: string;
	}) => void;
}

export interface PendingPromptEnqueueInput {
	prompt: string;
	mode?: AgentMode;
	delivery: PendingPromptDelivery;
	userImages?: string[];
	userFiles?: string[];
	/**
	 * ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01 (P1 fix):
	 * Optional job correlation token. Threaded through to the
	 * `PendingPromptEntry.jobId` field so the optional
	 * `onBeforeDrain` + dispatch hooks can observe which background
	 * job a queued wake belongs to. When undefined (explicit user
	 * path) the entry simply carries no correlation.
	 */
	jobId?: string;
}

export interface PendingPromptConsumeResult {
	entry?: PendingPromptEntry;
	prompts: SessionPendingPrompt[];
}

export class PendingPromptService {
	list(state: PendingPromptQueueState | undefined): SessionPendingPrompt[] {
		return state ? snapshotPrompts(state) : [];
	}

	update(
		state: PendingPromptQueueState | undefined,
		input: PendingPromptsUpdateInput,
	): PendingPromptMutationResult {
		if (!state) {
			return { sessionId: input.sessionId, prompts: [], updated: false };
		}
		const promptId = input.promptId.trim();
		const index = state.pendingPrompts.findIndex(
			(entry) => entry.id === promptId,
		);
		if (index < 0) {
			return {
				sessionId: input.sessionId,
				prompts: snapshotPrompts(state),
				updated: false,
			};
		}

		const existing = state.pendingPrompts[index];
		if (!existing) {
			return {
				sessionId: input.sessionId,
				prompts: snapshotPrompts(state),
				updated: false,
			};
		}
		const prompt =
			input.prompt === undefined
				? existing.prompt
				: normalizeUserInput(input.prompt).trim();
		if (!prompt) {
			throw new Error("prompt cannot be empty");
		}
		const delivery = input.delivery ?? existing.delivery;
		const next: PendingPromptEntry = {
			...existing,
			prompt,
			mode: input.mode ?? existing.mode,
			delivery,
		};
		state.pendingPrompts.splice(index, 1);
		insertUpdatedPrompt(state, next, index, existing.delivery);
		return {
			sessionId: input.sessionId,
			prompts: snapshotPrompts(state),
			prompt: snapshotPrompt(next),
			updated: true,
		};
	}

	delete(
		state: PendingPromptQueueState | undefined,
		input: PendingPromptsDeleteInput,
	): PendingPromptMutationResult {
		if (!state) {
			return { sessionId: input.sessionId, prompts: [], removed: false };
		}
		const promptId = input.promptId.trim();
		const index = state.pendingPrompts.findIndex(
			(entry) => entry.id === promptId,
		);
		if (index < 0) {
			return {
				sessionId: input.sessionId,
				prompts: snapshotPrompts(state),
				removed: false,
			};
		}
		const [removed] = state.pendingPrompts.splice(index, 1);
		return {
			sessionId: input.sessionId,
			prompts: snapshotPrompts(state),
			prompt: removed ? snapshotPrompt(removed) : undefined,
			removed: true,
		};
	}

	enqueue(
		state: PendingPromptQueueState,
		input: PendingPromptEnqueueInput,
	): SessionPendingPrompt[] {
		const { prompt, mode, delivery, userImages, userFiles, jobId } = input;
		const existingIndex = state.pendingPrompts.findIndex(
			(queued) => queued.prompt === prompt,
		);
		if (existingIndex >= 0) {
			const [existing] = state.pendingPrompts.splice(existingIndex, 1);
			const next: PendingPromptEntry = {
				...existing,
				prompt,
				mode: mode ?? existing.mode,
				userImages: userImages ?? existing.userImages,
				userFiles: userFiles ?? existing.userFiles,
				// ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01 (P1):
				// A re-enqueue of the same prompt retains its first jobId
				// unless a fresher jobId is explicitly supplied; this
				// matches the foreground dedupe semantics (the entry is
				// the same logical continuation).
				jobId: jobId ?? existing.jobId,
			};
			if (delivery === "steer" || existing.delivery === "steer") {
				state.pendingPrompts.unshift({ ...next, delivery: "steer" });
			} else {
				state.pendingPrompts.push(next);
			}
		} else {
			const newEntry: PendingPromptEntry = {
				id: `pending_${Date.now()}_${nanoid(5)}`,
				prompt,
				mode,
				delivery,
				userImages,
				userFiles,
				// ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01 (P1):
				// jobId is preserved verbatim (may be undefined for
				// explicit user turns).
				jobId,
			};
			if (delivery === "steer") {
				state.pendingPrompts.unshift(newEntry);
			} else {
				state.pendingPrompts.push(newEntry);
			}
		}
		return snapshotPrompts(state);
	}

	consumeSteer(state: PendingPromptQueueState): PendingPromptConsumeResult {
		const steerIndex = state.pendingPrompts.findIndex(
			(entry) => entry.delivery === "steer",
		);
		if (steerIndex < 0) {
			return { prompts: snapshotPrompts(state) };
		}
		const [entry] = state.pendingPrompts.splice(steerIndex, 1);
		return { entry, prompts: snapshotPrompts(state) };
	}

	shiftNext(state: PendingPromptQueueState): PendingPromptConsumeResult {
		const entry = state.pendingPrompts.shift();
		return { entry, prompts: snapshotPrompts(state) };
	}

	requeueFront(
		state: PendingPromptQueueState,
		entry: PendingPromptEntry,
	): SessionPendingPrompt[] {
		state.pendingPrompts.unshift(entry);
		return snapshotPrompts(state);
	}

	clear(state: PendingPromptQueueState): SessionPendingPrompt[] {
		state.pendingPrompts.length = 0;
		return [];
	}
}

export class PendingPromptsController {
	private readonly service = new PendingPromptService();

	constructor(private readonly deps: PendingPromptsControllerDeps) {}

	list(sessionId: string): SessionPendingPrompt[] {
		return this.service.list(this.deps.getSession(sessionId));
	}

	update(input: PendingPromptsUpdateInput): PendingPromptMutationResult {
		const session = this.deps.getSession(input.sessionId);
		if (!session) {
			return { sessionId: input.sessionId, prompts: [], updated: false };
		}
		const result = this.service.update(session, input);
		this.emitPrompts(session);
		this.scheduleDrain(input.sessionId, session);
		return result;
	}

	delete(input: PendingPromptsDeleteInput): PendingPromptMutationResult {
		const session = this.deps.getSession(input.sessionId);
		if (!session) {
			return { sessionId: input.sessionId, prompts: [], removed: false };
		}
		const result = this.service.delete(session, input);
		this.emitPrompts(session);
		this.scheduleDrain(input.sessionId, session);
		return result;
	}

	enqueue(
		sessionId: string,
		entry: {
			prompt: string;
			mode?: AgentMode;
			delivery: "queue" | "steer";
			userImages?: string[];
			userFiles?: string[];
			/**
			 * ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01:
			 * Optional callback-supplied jobId correlation. Forwarded
			 * to the onEnqueue hook (C4 capture) when supplied so the
			 * host can correlate pending_prompt_enqueued records with
			 * the originating jobId (terminal wake path).
			 */
			jobId?: string;
		},
	): void {
		const session = this.deps.getSession(sessionId);
		if (!session) return;
		// The queue survives aborts and is visible while one settles, so
		// queue operations must keep working during the abort window: a
		// prompt typed right after Escape joins the queue instead of being
		// silently dropped, and queued prompts stay editable/deletable before
		// they auto-run. scheduleDrain/drain still refuse to run while the
		// abort is settling.
		const snapshots = this.service.enqueue(session, entry);
		this.emitPrompts(session);
		// ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01:
		// C4 hook — fire the optional onEnqueue capture callback AFTER
		// the queue mutation, BEFORE scheduleDrain. The snapshot tail
		// identifies the entry actually pushed (or the
		// previously-existing entry that survived the dedupe-by-prompt
		// match). When no callback is supplied the host has no capture
		// seam installed (the production default).
		if (this.deps.onEnqueue) {
			const tail = snapshots[snapshots.length - 1];
			if (tail) {
				this.deps.onEnqueue({
					sessionId,
					delivery: entry.delivery,
					promptId: tail.id,
					...(entry.jobId !== undefined ? { jobId: entry.jobId } : {}),
				});
			}
		}
		this.scheduleDrain(sessionId, session);
	}

	consumeSteer(sessionId: string): PendingPromptEntry | undefined {
		const session = this.deps.getSession(sessionId);
		if (!session) return undefined;
		const { entry: steer } = this.service.consumeSteer(session);
		if (!steer) return undefined;
		this.emitPrompts(session);
		this.emitSubmitted(session, steer);
		return steer;
	}

	/**
	 * Drops every queued prompt. Only called when the user aborts a
	 * queue-initiated turn — that gesture means "stop the queued work", not
	 * just "stop this response", so the remainder must not auto-run.
	 */
	discardQueue(session: ActiveSession): void {
		if (session.pendingPrompts.length === 0) return;
		this.service.clear(session);
		this.emitPrompts(session);
	}

	emitPrompts(session: ActiveSession): void {
		this.deps.emit({
			type: "pending_prompts",
			payload: {
				sessionId: session.sessionId,
				prompts: snapshotPrompts(session),
			},
		});
	}

	scheduleDrain(sessionId: string, session: ActiveSession): void {
		if (
			session.pendingPrompts.length === 0 ||
			session.aborting ||
			session.drainingPendingPrompts ||
			!session.agent.canStartRun()
		) {
			return;
		}
		queueMicrotask(() => {
			void this.drain(sessionId);
		});
	}

	async drain(sessionId: string): Promise<void> {
		const session = this.deps.getSession(sessionId);
		if (!session) return;
		if (session.aborting || session.drainingPendingPrompts) {
			return;
		}
		if (!session.agent.canStartRun()) {
			return;
		}
		const { entry: next } = this.service.shiftNext(session);
		if (!next) return;
		// ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01 (P0+P1 fix):
		// C5 hook — fire the optional onBeforeDrain capture callback
		// AFTER the destructive shift (the entry has actually been
		// claimed off the queue) but BEFORE the controller schedules
		// the actual send. The callback carries `next.jobId` so
		// terminal-wake-bound entries can be correlated through
		// C4 → C5 → C6.
		//
		// NOTE: this fires ONCE per shift. If `send` fails the entry
		// is requeued (via requeueFront); no second C5 fires for the
		// retry — that is the load-bearing distinction from C6.
		if (this.deps.onBeforeDrain) {
			this.deps.onBeforeDrain({
				sessionId,
				promptId: next.id,
				delivery: next.delivery,
				...(next.jobId !== undefined ? { jobId: next.jobId } : {}),
			});
		}
		this.emitPrompts(session);
		this.emitSubmitted(session, next);
		session.drainingPendingPrompts = true;
		let continueDrain = true;
		try {
			// ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01 (P0 fix):
			// C6 hook — fire the optional onBeforeDispatch capture
			// callback IMMEDIATELY BEFORE the actual `deps.send(...)`
			// call. This is the distinct "continuation scheduled"
			// seam: each retry of an inner async send (e.g. a duplicate
			// dispatch path) crosses C6 again, while C5 still fires
			// exactly once per shift. The diagnostic can therefore
			// observe "C6=2 with C5=1" as a duplicate-dispatch
			// fingerprint.
			if (this.deps.onBeforeDispatch) {
				this.deps.onBeforeDispatch({
					sessionId,
					promptId: next.id,
					delivery: next.delivery,
					...(next.jobId !== undefined ? { jobId: next.jobId } : {}),
				});
			}
			const result = await this.deps.send({
				sessionId,
				prompt: next.prompt,
				...(next.mode ? { mode: next.mode } : {}),
				userImages: next.userImages,
				userFiles: next.userFiles,
				// ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01
				// (production wiring fix per FACTORY HALT_CCARD_V2_PRODUCTION_WIRING_FALSE_GREEN):
				// Forward `next.delivery` so the receiving `runTurn` can
				// observe the original delivery context (queue/steer)
				// at the execution boundary (C7). Without this, the
				// drained prompt's C7 record would lose its
				// origin-discriminating information — the host's
				// deriveOrigin() would fall through to `explicit_user`
				// for what is actually a `pending_prompt_drain` turn.
				...(next.delivery !== undefined ? { delivery: next.delivery } : {}),
				// ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01
				// (production wiring fix per FACTORY HALT_CCARD_V2_PRODUCTION_WIRING_FALSE_GREEN):
				// Forward `next.jobId` into the SendSessionInput so the
				// jobId correlation token survives the real
				// `deps.send` boundary. Without this forwarding the
				// C6→C7 jobId correlation is lost — C7 (run_turn_started)
				// would observe `delivery` but never the originating
				// jobId, defeating the C4→C5→C6→C7→C8 traceability.
				...(next.jobId !== undefined ? { jobId: next.jobId } : {}),
			});
			// A turn that resolves with an error finish ran (the prompt is in
			// the conversation and the error is surfaced), so the entry is not
			// requeued — but stop draining instead of firing the remaining
			// queue into a failing provider. The rest stays queued and drains
			// on the next enqueue/update or successful turn.
			if (isErrorFinish(result)) {
				continueDrain = false;
			}
		} catch {
			continueDrain = false;
			this.service.requeueFront(session, next);
			this.emitPrompts(session);
		} finally {
			session.drainingPendingPrompts = false;
			if (
				continueDrain &&
				session.pendingPrompts.length > 0 &&
				session.status !== "failed" &&
				session.status !== "cancelled"
			) {
				queueMicrotask(() => {
					void this.drain(sessionId);
				});
			}
		}
	}

	private emitSubmitted(session: ActiveSession, entry: PendingPrompt): void {
		const prompt = snapshotPrompt(entry);
		this.deps.emit({
			type: "pending_prompt_submitted",
			payload: {
				sessionId: session.sessionId,
				id: prompt.id,
				prompt: prompt.prompt,
				delivery: prompt.delivery,
				attachmentCount: prompt.attachmentCount,
				userImages: prompt.userImages,
				userFiles: prompt.userFiles,
			},
		});
	}
}

function isErrorFinish(result: unknown): boolean {
	return (
		typeof result === "object" &&
		result !== null &&
		"finishReason" in result &&
		(result as { finishReason?: unknown }).finishReason === "error"
	);
}

function snapshotPrompt(entry: PendingPromptEntry): SessionPendingPrompt {
	return {
		id: entry.id,
		prompt: entry.prompt,
		delivery: entry.delivery,
		attachmentCount:
			(entry.userImages?.length ?? 0) + (entry.userFiles?.length ?? 0),
		userImages: entry.userImages,
		userFiles: entry.userFiles,
	};
}

function snapshotPrompts(
	state: PendingPromptQueueState,
): SessionPendingPrompt[] {
	return state.pendingPrompts.map(snapshotPrompt);
}

function insertUpdatedPrompt(
	state: PendingPromptQueueState,
	next: PendingPromptEntry,
	previousIndex: number,
	previousDelivery: PendingPromptDelivery,
): void {
	if (next.delivery === "steer") {
		state.pendingPrompts.unshift(next);
	} else if (previousDelivery === "steer") {
		state.pendingPrompts.push(next);
	} else {
		state.pendingPrompts.splice(previousIndex, 0, next);
	}
}
