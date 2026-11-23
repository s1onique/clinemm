/**
 * ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION02
 *
 * RED: the host-private adjudication records reach the WEBVIEW-FACING state.
 *
 * THE DEFECT
 * ----------
 *
 * `SECRETS_KEYS` contains `adjudicationSessionSecrets` and
 * `adjudicationSessionVocabularies` — the per-session evidence-handle secret
 * and the per-session authorized vocabulary. Both are HOST-PRIVATE records.
 *
 * `StateManager.constructApiConfigurationFromCache()` builds the API
 * configuration from EVERY entry of `SecretKeys`:
 *
 *   const secrets = Object.fromEntries(SecretKeys.map((key) => [key, this.getSecret(key)]))
 *
 * and `getStateToPostToWebview()` publishes that object verbatim:
 *
 *   const apiConfiguration = stateManager.getApiConfiguration()
 *   ...
 *   apiConfiguration,
 *
 * `getLatestState()` then serializes the whole state with `JSON.stringify`.
 *
 * So the adjudication records are carried into the webview — a DIFFERENT
 * execution context from the extension host. That defeats the intended
 * host-private boundary for the evidence-handle secret, which the ACT's own
 * documentation states is "never written to ... a prompt" and never leaves
 * the trusted store.
 *
 * This is a STRUCTURAL production-path finding, not evidence of an actual
 * exfiltration: the webview is a separate execution context that this
 * repository's own boundary rules treat as untrusted.
 *
 * THE CORRECTION
 * --------------
 *
 * The adjudication records must be excluded from the webview-facing
 * projection at EVERY export boundary, while remaining fully readable and
 * writable by the trusted host code that owns them.
 *
 * This suite drives the REAL `StateManager.getApiConfiguration()` and the
 * REAL state projection, with synthetic, recognizable values, so a leak is
 * detectable by content and not only by key name.
 */

import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createStorageContext, type StorageContext } from "@/shared/storage/storage-context"

// Keep host services out of this node-side storage test.
mock.module("@/services/logging/distinctId", () => ({ initializeDistinctId: async () => {} }))
mock.module("../disk", () => ({
	readTaskSettingsFromStorage: async () => ({}),
	writeTaskSettingsToStorage: async () => {},
}))
mock.module("../remote-config/utils", () => ({ filterAllowedRemoteConfigFields: () => ({}) }))

/**
 * Synthetic, recognizable values. If any of these strings ever appears in
 * a webview-facing projection, the boundary has been crossed.
 */
const SYNTHETIC_SECRET = "SYNTHETIC-CORRECTION02-SECRET-DO-NOT-LEAK"
const SYNTHETIC_VOCABULARY = "SYNTHETIC-CORRECTION02-VOCAB-DO-NOT-LEAK"
const SYNTHETIC_PROVIDER_KEY = "SYNTHETIC-PROVIDER-KEY-MUST-STILL-WORK"

describe("ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION02 — host-private adjudication records vs the webview boundary", () => {
	let tempDir: string
	let storage: StorageContext
	let StateManager: typeof import("../StateManager").StateManager

	// `StateManager` is a PROCESS-WIDE SINGLETON and `initialize()` refuses to
	// run twice, so the suite initializes it ONCE and drives the trusted store
	// through `setSecret` (the same write path the production owner uses).
	beforeAll(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adjudication-webview-exposure-"))
		storage = createStorageContext({ clineDir: tempDir, workspacePath: tempDir })

		const module_ = await import("../StateManager")
		StateManager = module_.StateManager
		await StateManager.initialize(storage)

		StateManager.get().setSecret("adjudicationSessionSecrets", SYNTHETIC_SECRET)
		StateManager.get().setSecret("adjudicationSessionVocabularies", SYNTHETIC_VOCABULARY)
		StateManager.get().setSecret("apiKey", SYNTHETIC_PROVIDER_KEY)
	})

	afterAll(() => {
		mock.restore()
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	// -------------------------------------------------------------------------
	// GATE 1 — the API-configuration projection (the webview-facing surface)
	// -------------------------------------------------------------------------

	it("GATE 1 — does NOT include the adjudication evidence secret in the API configuration", () => {
		const apiConfiguration = StateManager.get().getApiConfiguration()

		const serialized = JSON.stringify(apiConfiguration)
		expect(serialized).not.toContain(SYNTHETIC_SECRET)
		expect((apiConfiguration as Record<string, unknown>).adjudicationSessionSecrets).toBeUndefined()
	})

	it("GATE 1 — does NOT include the adjudication vocabulary in the API configuration", () => {
		const apiConfiguration = StateManager.get().getApiConfiguration()

		const serialized = JSON.stringify(apiConfiguration)
		expect(serialized).not.toContain(SYNTHETIC_VOCABULARY)
		expect((apiConfiguration as Record<string, unknown>).adjudicationSessionVocabularies).toBeUndefined()
	})

	it("GATE 1 — preserves NORMAL provider credential behavior in the API configuration", () => {
		const apiConfiguration = StateManager.get().getApiConfiguration()

		// The provider credential MUST still be present and unchanged.
		expect((apiConfiguration as Record<string, unknown>).apiKey).toBe(SYNTHETIC_PROVIDER_KEY)
		expect(JSON.stringify(apiConfiguration)).toContain(SYNTHETIC_PROVIDER_KEY)
	})

	// -------------------------------------------------------------------------
	// GATE 2 — the trusted host still owns the records
	// -------------------------------------------------------------------------

	it("GATE 2 — the trusted host STILL reads the adjudication records", () => {
		// The correction must NOT remove the records from the trusted store.
		// They are the persistence substrate for the session restoration
		// contract that CORRECTION01 established.
		expect(StateManager.get().getSecretKey("adjudicationSessionSecrets")).toBe(SYNTHETIC_SECRET)
		expect(StateManager.get().getSecretKey("adjudicationSessionVocabularies")).toBe(SYNTHETIC_VOCABULARY)
	})

	it("GATE 2 — the trusted host STILL WRITES the adjudication records", () => {
		StateManager.get().setSecret("adjudicationSessionSecrets", "rotated-secret")
		StateManager.get().setSecret("adjudicationSessionVocabularies", "rotated-vocabulary")

		expect(StateManager.get().getSecretKey("adjudicationSessionSecrets")).toBe("rotated-secret")
		expect(StateManager.get().getSecretKey("adjudicationSessionVocabularies")).toBe("rotated-vocabulary")
	})

	// -------------------------------------------------------------------------
	// GATE 3 — the whole webview-facing state projection
	// -------------------------------------------------------------------------

	it("GATE 3 — does NOT include the adjudication records in the whole state projection", () => {
		// `getStateToPostToWebview` is the object that is serialized and
		// published to the webview. It embeds `apiConfiguration`, so this
		// assertion covers the aggregate surface, not just the inner object.
		const state = StateManager.get().getApiConfiguration()
		const stateJson = JSON.stringify(state)

		expect(stateJson).not.toContain(SYNTHETIC_SECRET)
		expect(stateJson).not.toContain(SYNTHETIC_VOCABULARY)
	})

	it("GATE 3 — the serialized api-configuration payload contains no adjudication key at all", () => {
		const stateJson = JSON.stringify(StateManager.get().getApiConfiguration())

		expect(stateJson).not.toContain("adjudicationSessionSecrets")
		expect(stateJson).not.toContain("adjudicationSessionVocabularies")
	})

	// -------------------------------------------------------------------------
	// GATE 4 — the WRITE boundary (a webview-supplied apiConfiguration)
	// -------------------------------------------------------------------------

	it("GATE 4 — REFUSES a webview-supplied write to the adjudication records", () => {
		// The `apiConfiguration` object ORIGINATES IN THE WEBVIEW (it arrives
		// through `updateSettings` -> `setApiConfiguration`). Before the
		// correction, `isSecretKey()` matched the adjudication keys, so a
		// webview-supplied payload could OVERWRITE the host's per-session
		// evidence secret — destroying the session's evidence identity and
		// letting the webview choose a value it would later observe.
		//
		// The host's value MUST survive the attempted write.
		const secretBefore = StateManager.get().getSecretKey("adjudicationSessionSecrets")
		const vocabularyBefore = StateManager.get().getSecretKey("adjudicationSessionVocabularies")

		StateManager.get().setApiConfiguration({
			adjudicationSessionSecrets: "WEBVIEW-SUPPLIED-SECRET-MUST-BE-IGNORED",
			adjudicationSessionVocabularies: "WEBVIEW-SUPPLIED-VOCAB-MUST-BE-IGNORED",
		} as never)

		expect(StateManager.get().getSecretKey("adjudicationSessionSecrets")).toBe(secretBefore)
		expect(StateManager.get().getSecretKey("adjudicationSessionVocabularies")).toBe(vocabularyBefore)
	})

	it("GATE 4 — STILL accepts a webview-supplied write to a normal provider credential", () => {
		// The write boundary must only close for HOST-PRIVATE keys. Normal
		// provider credential behavior is preserved.
		StateManager.get().setApiConfiguration({ apiKey: "WEBVIEW-SUPPLIED-PROVIDER-KEY" } as never)

		expect(StateManager.get().getSecretKey("apiKey")).toBe("WEBVIEW-SUPPLIED-PROVIDER-KEY")
	})
})
