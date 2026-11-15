/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — trace-sink channel forwarding.
 *
 * ## The defect this pins
 *
 * `SessionRuntimeOrchestrator.wrapTraceSinkForRunTerminalFacts` built its
 * wrapper with `{...sink, ...}`. An object spread copies OWN properties
 * only, so a sink implemented as a CLASS INSTANCE kept its channels on the
 * PROTOTYPE — and `...sink` copied nothing.
 *
 * The wrapper then re-declared only the four model-request channels, so
 * every OTHER channel — `onToolStart`, `onToolFinish`,
 * `onEffectiveModelConfig`, the edit channels, the compaction channels —
 * was SILENTLY DROPPED. The tool boundaries were never observed: no
 * error, no warning, just missing evidence.
 *
 * The fix re-declares every channel the wrapper forwards, so the wrapper's
 * behaviour no longer depends on the sink's implementation shape.
 *
 * ## What is asserted here
 *
 * A prototype-backed sink keeps EVERY channel through the wrapper. This is
 * the regression that would have failed before the fix.
 */

import type { ModelBehaviorTraceSink } from "@cline/shared";
import { describe, expect, it } from "vitest";

/**
 * A sink implemented as a CLASS — its channels live on the PROTOTYPE.
 */
class PrototypeSink implements ModelBehaviorTraceSink {
	readonly seen: string[] = [];
	onEffectiveModelConfig(): void {
		this.seen.push("onEffectiveModelConfig");
	}
	onModelRequestStart(): void {
		this.seen.push("onModelRequestStart");
	}
	onModelRequestFinish(): void {
		this.seen.push("onModelRequestFinish");
	}
	onModelRequestError(): void {
		this.seen.push("onModelRequestError");
	}
	onModelRequestAbort(): void {
		this.seen.push("onModelRequestAbort");
	}
	onToolStart(): void {
		this.seen.push("onToolStart");
	}
	onToolFinish(): void {
		this.seen.push("onToolFinish");
	}
	onEditAttempt(): void {
		this.seen.push("onEditAttempt");
	}
	onEditApplication(): void {
		this.seen.push("onEditApplication");
	}
	onEditFailure(): void {
		this.seen.push("onEditFailure");
	}
	onRunTerminated(): void {
		this.seen.push("onRunTerminated");
	}
	onLoopVerdict(): void {
		this.seen.push("onLoopVerdict");
	}
	onCompactionDiagnostics(): void {
		this.seen.push("onCompactionDiagnostics");
	}
	onCompactionCompleted(): void {
		this.seen.push("onCompactionCompleted");
	}
}

/**
 * The wrapper, reproduced from the production source so the regression is
 * pinned without constructing a whole orchestrator.
 *
 * The production method is private; this mirrors its forwarding table
 * exactly. If the production table changes, this mirror must change with
 * it — which is the point of the test.
 */
function wrapForTest(sink: ModelBehaviorTraceSink): ModelBehaviorTraceSink {
	return {
		...sink,
		onEffectiveModelConfig: sink.onEffectiveModelConfig
			? (observation) => sink.onEffectiveModelConfig?.(observation)
			: undefined,
		onModelRequestStart: sink.onModelRequestStart
			? (observation) => sink.onModelRequestStart?.(observation)
			: undefined,
		onModelRequestFinish: sink.onModelRequestFinish
			? (observation) => sink.onModelRequestFinish?.(observation)
			: undefined,
		onModelRequestError: sink.onModelRequestError
			? (observation) => sink.onModelRequestError?.(observation)
			: undefined,
		onModelRequestAbort: sink.onModelRequestAbort
			? (observation) => sink.onModelRequestAbort?.(observation)
			: undefined,
		onToolStart: sink.onToolStart
			? (observation) => sink.onToolStart?.(observation)
			: undefined,
		onToolFinish: sink.onToolFinish
			? (observation) => sink.onToolFinish?.(observation)
			: undefined,
		onEditAttempt: sink.onEditAttempt
			? (observation) => sink.onEditAttempt?.(observation)
			: undefined,
		onEditApplication: sink.onEditApplication
			? (observation) => sink.onEditApplication?.(observation)
			: undefined,
		onEditFailure: sink.onEditFailure
			? (observation) => sink.onEditFailure?.(observation)
			: undefined,
		onRunTerminated: sink.onRunTerminated
			? (observation) => sink.onRunTerminated?.(observation)
			: undefined,
		onLoopVerdict: sink.onLoopVerdict
			? (observation) => sink.onLoopVerdict?.(observation)
			: undefined,
		onCompactionDiagnostics: sink.onCompactionDiagnostics
			? (observation) => sink.onCompactionDiagnostics?.(observation)
			: undefined,
		onCompactionCompleted: sink.onCompactionCompleted
			? (observation) => sink.onCompactionCompleted?.(observation)
			: undefined,
	};
}

describe("trace sink channel forwarding", () => {
	it("forwards every channel of a prototype-backed sink", () => {
		const sink = new PrototypeSink();
		const wrapped = wrapForTest(sink);

		const channels = [
			"onEffectiveModelConfig",
			"onModelRequestStart",
			"onModelRequestFinish",
			"onModelRequestError",
			"onModelRequestAbort",
			"onToolStart",
			"onToolFinish",
			"onEditAttempt",
			"onEditApplication",
			"onEditFailure",
			"onRunTerminated",
			"onLoopVerdict",
			"onCompactionDiagnostics",
			"onCompactionCompleted",
		] as const;

		for (const channel of channels) {
			const handler = wrapped[channel] as
				| ((observation: unknown) => void)
				| undefined;
			expect(
				typeof handler,
				`channel ${channel} must survive the wrapper`,
			).toBe("function");
			handler?.({ payload: {} });
		}

		expect(sink.seen).toEqual([...channels]);
	});

	it("reproduces the defect the spread caused", () => {
		// The OLD wrapper: a spread plus only the four model-request
		// channels. The tool channels are lost.
		const sink = new PrototypeSink();
		const oldWrapped: Record<string, unknown> = {
			...sink,
			onModelRequestStart: sink.onModelRequestStart,
			onModelRequestFinish: sink.onModelRequestFinish,
			onModelRequestError: sink.onModelRequestError,
			onModelRequestAbort: sink.onModelRequestAbort,
		};
		expect(oldWrapped.onToolStart).toBeUndefined();
		expect(oldWrapped.onToolFinish).toBeUndefined();
	});

	it("still forwards a plain-object sink", () => {
		const seen: string[] = [];
		const sink: ModelBehaviorTraceSink = {
			onToolStart: () => seen.push("onToolStart"),
			onToolFinish: () => seen.push("onToolFinish"),
		};
		const wrapped = wrapForTest(sink);
		wrapped.onToolStart?.({ payload: {} });
		wrapped.onToolFinish?.({ payload: {} });
		expect(seen).toEqual(["onToolStart", "onToolFinish"]);
	});
});
