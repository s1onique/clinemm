/**
 * ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01 — RED
 *
 * Hypothesis H2: `default: false` in state-keys.ts + the
 * default-injection branch in `readGlobalStateFromStorage` collapses
 * a LEGACY ABSENT persistent key into the cached `false`. That
 * `false` then flows through the `safeYoloCapabilitySource` closure
 * into `resolveSafeYoloCapabilityFromState` which returns
 * `network: "deny"`, overriding even an explicit env opt-in.
 *
 * The doc comment on `SafeYoloCapabilitySnapshot`
 * (sandbox-policy.ts:776-790) explicitly states: "Pre-existing
 * state files (no key) read as `undefined` here and fall through
 * to the env path." The red test below exercises the production
 * hydration chain and verifies the invariant against the doc
 * contract.
 *
 * RED REPRODUCTION:
 *   - An empty ClineFileStorage (legacy state file, no key)
 *   - Hydrate through readGlobalStateFromStorage
 *   - Read through StateManager cache
 *   - Pass through closure + resolveSafeYoloCapabilityFromState
 *   - Expected per doc: snap.network === undefined (no opinion)
 *   - Observed in this test: snap.network === false → "deny"
 *   - First divergence FOUND here.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ClineFileStorage } from "@shared/storage/ClineFileStorage"
import type { ClineMemento } from "@shared/storage/ClineStorage"
import { afterEach, describe, expect, it } from "vitest"

import { resolveSafeYoloCapabilityFromState } from "../sandbox-policy"

describe("ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01 — H2 RED", () => {
	const temporaryDirectories: string[] = []

	afterEach(() => {
		for (const d of temporaryDirectories.splice(0)) {
			try {
				rmSync(d, { force: true, recursive: true })
			} catch {
				// Best-effort cleanup.
			}
		}
	})

	it("hydrates ABSENT clinemmSafeYoloAllowNetwork — observe what the closure receives", async () => {
		// Simulate a legacy state file: clinemmSafeYoloAllowNetwork is
		// simply absent from disk.
		const dir = mkdtempSync(join(tmpdir(), "clinemm-live-regression-"))
		temporaryDirectories.push(dir)
		const storage = new ClineFileStorage(join(dir, "globalState.json"))

		const { readGlobalStateFromStorage } = await import("../../core/storage/utils/state-helpers")
		const hydrated = await readGlobalStateFromStorage(storage as ClineMemento)

		// FIRST DIVERGENCE: doc says "undefined", observed value is the
		// default injected from state-keys.ts (`false`).
		const observed = hydrated.clinemmSafeYoloAllowNetwork
		console.log("[RED] hydrated.clinemmSafeYoloAllowNetwork after legacy read:", observed, "typeOf=", typeof observed)

		const snap = resolveSafeYoloCapabilityFromState({
			network: observed,
			sshAgent: hydrated.clinemmSafeYoloAllowSshAgent,
		})

		console.log("[RED] snap.network =", snap.network, "snap.sshAgent =", snap.sshAgent)

		// Per the documented invariant at sandbox-policy.ts:786-790
		// ("Pre-existing state files (no key) read as `undefined` here and
		// fall through to the env path"), legacy absence MUST be
		// `undefined`. The literal observed value (boolean) here is the
		// first divergence between documented contract and real hydration.
		expect(observed, "Legacy ABSENT must hydrate to undefined (3-valued contract), not the schema default.").toBeUndefined()
	})
})
