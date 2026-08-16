/**
 * C1.6 test-only deterministic barrier.
 *
 * Replaces the C1.4 `setImmediate` polling fixtures with a small
 * primitive that lets a test deterministically force completion order
 * between two (or more) parallel sibling promises. This eliminates
 * scheduler-dependent flake and produces reproducible evidence for
 * the parallel-batch invariants.
 *
 * Three operations:
 *   const g = barrier()
 *   await g.arrive(id)   // sibling waits at the gate
 *   g.release(id, value) // hand back a value when the test decides
 *   g.fail(id, err)      // hand back a rejection
 *
 * The barrier does NOT introduce wall-clock waits. It only suspends
 * async functions until the test calls `release` / `fail`.
 */

/** A single controllable gate used inside an async function. */
export interface ControlledPromise<T> {
	readonly id: string;
	arrive(): Promise<T>;
}

/** A barrier factory + a registry of pending arrivals. */
export interface Barrier {
	controllable<T>(id: string): ControlledPromise<T>;
	release<T>(id: string, value: T): void;
	fail(id: string, err: unknown): void;
	pending(): readonly string[];
}

interface PendingArrival<T> {
	resolve: (value: T) => void;
	reject: (err: unknown) => void;
}

export function barrier(): Barrier {
	const pending = new Map<string, PendingArrival<unknown>>();
	return {
		controllable<T>(id: string): ControlledPromise<T> {
			return {
				id,
				arrive(): Promise<T> {
					return new Promise<T>((resolve, reject) => {
						pending.set(id, {
							resolve: resolve as (v: unknown) => void,
							reject,
						});
					});
				},
			};
		},
		release<T>(id: string, value: T): void {
			const slot = pending.get(id) as PendingArrival<T> | undefined;
			if (!slot) {
				throw new Error(`barrier.release: no pending arrival for id=${id}`);
			}
			pending.delete(id);
			slot.resolve(value);
		},
		fail(id: string, err: unknown): void {
			const slot = pending.get(id);
			if (!slot) {
				throw new Error(`barrier.fail: no pending arrival for id=${id}`);
			}
			pending.delete(id);
			slot.reject(err);
		},
		pending(): readonly string[] {
			return Array.from(pending.keys());
		},
	};
}
