/**
 * ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01 — GREEN
 *
 * StateManager round-trip regression coverage for the three-valued
 * `clinemmSafeYoloAllow*` contract after the H2 repair.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ClineFileStorage } from "@shared/storage/ClineFileStorage"
import type { ClineMemento } from "@shared/storage/ClineStorage"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { buildExperimentalReconCapability, resolveSafeYoloCapabilityFromState } from "../sandbox-policy"

const EMPTY = { cwd: "/tmp", workspaceRoots: [] as readonly string[] }

describe("ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01 — GREEN", () => {
	const temporaryDirectories: string[] = []
	const savedEnv: Record<string, string | undefined> = {}

	beforeEach(() => {
		savedEnv.CLINEMM_EXPERIMENTAL_SANDBOX = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		savedEnv.CLINEMM_SAFE_YOLO_NETWORK = process.env.CLINEMM_SAFE_YOLO_NETWORK
		savedEnv.CLINEMM_SAFE_YOLO_SSH_AGENT = process.env.CLINEMM_SAFE_YOLO_SSH_AGENT
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
		delete process.env.CLINEMM_SAFE_YOLO_SSH_AGENT
	})

	afterEach(() => {
		for (const d of temporaryDirectories.splice(0)) {
			try {
				rmSync(d, { force: true, recursive: true })
			} catch {}
		}
		for (const [k, v] of Object.entries(savedEnv)) {
			if (v === undefined) {
				delete process.env[k]
			} else {
				process.env[k] = v
			}
		}
	})

	async function hydrateStorage() {
		const dir = mkdtempSync(join(tmpdir(), "clinemm-lr-green-"))
		temporaryDirectories.push(dir)
		const storage = new ClineFileStorage(join(dir, "globalState.json"))
		const { readGlobalStateFromStorage } = await import("../../core/storage/utils/state-helpers")
		const hydrated = await readGlobalStateFromStorage(storage as ClineMemento)
		return { storage, cache: { ...hydrated } }
	}

	it("T01: ABSENT key stays undefined through hydration", async () => {
		const { cache } = await hydrateStorage()
		expect(cache.clinemmSafeYoloAllowNetwork).toBeUndefined()
		expect(cache.clinemmSafeYoloAllowSshAgent).toBeUndefined()
	})

	it("T02: persisted true survives restart", async () => {
		const dir = mkdtempSync(join(tmpdir(), "clinemm-lr-restart-true-"))
		temporaryDirectories.push(dir)
		const storage = new ClineFileStorage(join(dir, "globalState.json"))
		await storage.update("clinemmSafeYoloAllowNetwork", true)
		const { readGlobalStateFromStorage } = await import("../../core/storage/utils/state-helpers")
		const hydrated = await readGlobalStateFromStorage(storage as ClineMemento)
		expect(hydrated.clinemmSafeYoloAllowNetwork).toBe(true)
		const reloaded = new ClineFileStorage(join(dir, "globalState.json"))
		const reHydrated = await readGlobalStateFromStorage(reloaded as ClineMemento)
		expect(reHydrated.clinemmSafeYoloAllowNetwork).toBe(true)
	})

	it("T03: persisted false survives restart", async () => {
		const dir = mkdtempSync(join(tmpdir(), "clinemm-lr-restart-false-"))
		temporaryDirectories.push(dir)
		const storage = new ClineFileStorage(join(dir, "globalState.json"))
		await storage.update("clinemmSafeYoloAllowNetwork", false)
		const { readGlobalStateFromStorage } = await import("../../core/storage/utils/state-helpers")
		const hydrated = await readGlobalStateFromStorage(storage as ClineMemento)
		expect(hydrated.clinemmSafeYoloAllowNetwork).toBe(false)
	})

	it("T04: ABSENT + env=allow → resolver stays undefined → builder resolves to allow", async () => {
		const { cache } = await hydrateStorage()
		const snap = resolveSafeYoloCapabilityFromState({
			network: cache.clinemmSafeYoloAllowNetwork,
			sshAgent: cache.clinemmSafeYoloAllowSshAgent,
		})
		expect(snap.network).toBeUndefined()
		const cap = buildExperimentalReconCapability({
			...EMPTY,
			networkOverride: snap.network,
			sshAgentOverride: snap.sshAgent,
		})
		expect(cap.network).toBe("allow")
	})

	it("T05: persisted false + env=allow → resolver yields 'deny'", async () => {
		const { cache } = await hydrateStorage()
		cache.clinemmSafeYoloAllowNetwork = false
		const snap = resolveSafeYoloCapabilityFromState({
			network: cache.clinemmSafeYoloAllowNetwork,
			sshAgent: cache.clinemmSafeYoloAllowSshAgent,
		})
		expect(snap.network).toBe("deny")
		const cap = buildExperimentalReconCapability({
			...EMPTY,
			networkOverride: snap.network,
			sshAgentOverride: snap.sshAgent,
		})
		expect(cap.network).toBe("deny")
	})

	it("T06: persisted true → resolver yields 'allow'", async () => {
		const { cache } = await hydrateStorage()
		cache.clinemmSafeYoloAllowNetwork = true
		const snap = resolveSafeYoloCapabilityFromState({
			network: cache.clinemmSafeYoloAllowNetwork,
			sshAgent: cache.clinemmSafeYoloAllowSshAgent,
		})
		expect(snap.network).toBe("allow")
		const cap = buildExperimentalReconCapability({
			...EMPTY,
			networkOverride: snap.network,
			sshAgentOverride: snap.sshAgent,
		})
		expect(cap.network).toBe("allow")
	})

	it("T07: cache mutation between calls is observed by the next read", async () => {
		const { cache } = await hydrateStorage()
		const snap1 = resolveSafeYoloCapabilityFromState({
			network: cache.clinemmSafeYoloAllowNetwork,
			sshAgent: cache.clinemmSafeYoloAllowSshAgent,
		})
		const cap1 = buildExperimentalReconCapability({
			...EMPTY,
			networkOverride: snap1.network,
			sshAgentOverride: snap1.sshAgent,
		})
		expect(cap1.network).toBe("allow")
		cache.clinemmSafeYoloAllowNetwork = false
		const snap2 = resolveSafeYoloCapabilityFromState({
			network: cache.clinemmSafeYoloAllowNetwork,
			sshAgent: cache.clinemmSafeYoloAllowSshAgent,
		})
		const cap2 = buildExperimentalReconCapability({
			...EMPTY,
			networkOverride: snap2.network,
			sshAgentOverride: snap2.sshAgent,
		})
		expect(cap2.network).toBe("deny")
		cache.clinemmSafeYoloAllowNetwork = true
		const snap3 = resolveSafeYoloCapabilityFromState({
			network: cache.clinemmSafeYoloAllowNetwork,
			sshAgent: cache.clinemmSafeYoloAllowSshAgent,
		})
		const cap3 = buildExperimentalReconCapability({
			...EMPTY,
			networkOverride: snap3.network,
			sshAgentOverride: snap3.sshAgent,
		})
		expect(cap3.network).toBe("allow")
	})

	it("T10: changing network does not mutate sshAgent capability", async () => {
		const { cache } = await hydrateStorage()
		expect(cache.clinemmSafeYoloAllowNetwork).toBeUndefined()
		expect(cache.clinemmSafeYoloAllowSshAgent).toBeUndefined()
		cache.clinemmSafeYoloAllowNetwork = true
		expect(cache.clinemmSafeYoloAllowSshAgent).toBeUndefined()
		const snap = resolveSafeYoloCapabilityFromState({
			network: cache.clinemmSafeYoloAllowNetwork,
			sshAgent: cache.clinemmSafeYoloAllowSshAgent,
		})
		expect(snap.network).toBe("allow")
		expect(snap.sshAgent).toBeUndefined()
	})
})
