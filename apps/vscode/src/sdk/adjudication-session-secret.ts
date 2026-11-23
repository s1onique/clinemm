/**
 * ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
 *
 * The VS Code HOST ADAPTER for the SDK's `CoreAdjudicationConfig.secretProvider`.
 *
 * THE CONTRACT
 * ------------
 *
 *   same session + same secret   -> same evidence handle
 *   different session            -> different evidence identity
 *   missing secret on restoration -> FAIL CLOSED
 *
 * The last rule is the important one. When the secret for a session cannot be
 * recovered, the provider hands back a FRESH, IN-MEMORY-ONLY secret. The
 * SDK's registry then reports `isRestorable() === false` and the runtime
 * reports the degradation rather than claiming a restoration it cannot
 * perform. Silently persisting a NEW secret for a session whose historical
 * handles exist would make those handles resolve to nothing while LOOKING
 * like a successful restore — the exact fail-open the SDK contract forbids.
 *
 * WHERE THE SECRET LIVES
 * ----------------------
 *
 * The secret is stored in the extension's TRUSTED secret store: the
 * file-backed `secrets.json` (mode 0o600) behind `StateManager`. It is NOT
 * stored in:
 *
 *   - workspace settings,
 *   - a repository file,
 *   - a task prompt,
 *   - a provider request,
 *   - a debug log,
 *   - the committed evidence package.
 *
 * The OPAQUE evidence handle is model-visible. The secret is not.
 *
 * SESSION SCOPING
 * ---------------
 *
 * The store is a JSON object keyed by session id, so:
 *
 *   - a different session gets a DIFFERENT secret (never a shared one);
 *   - the same session always gets the SAME secret (across a restoration);
 *   - there is no cross-session lookup: a handle minted in session A can
 *     never resolve in session B, because the derivation includes both the
 *     session id and the session's own secret.
 */

import { StateManager } from "@/core/storage/StateManager"

const SECRET_STORAGE_KEY = "adjudicationSessionSecrets" as const

/**
 * The shape of the persisted blob.
 */
type SessionSecretBlob = Record<string, string>

/**
 * Generate a cryptographically random session secret.
 *
 * 32 hex characters of cryptographic randomness, exactly matching the SDK's
 * `AdjudicationEvidenceRegistry.generateSecret()` shape.
 */
function generateSessionSecret(): string {
	const bytes = new Uint8Array(16)
	globalThis.crypto.getRandomValues(bytes)
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * Read the persisted blob. A malformed blob is treated as EMPTY: a corrupt
 * store must not crash the session, and an empty store means every session
 * re-derives a fresh secret (the fail-closed direction).
 */
function readBlob(): SessionSecretBlob {
	try {
		const raw = StateManager.get().getSecretKey(SECRET_STORAGE_KEY)
		if (!raw) {
			return {}
		}
		const parsed = JSON.parse(raw) as unknown
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {}
		}
		const blob: SessionSecretBlob = {}
		for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof value === "string" && value.length > 0) {
				blob[key] = value
			}
		}
		return blob
	} catch {
		return {}
	}
}

/**
 * Persist the blob.
 */
function writeBlob(blob: SessionSecretBlob): void {
	try {
		StateManager.get().setSecret(SECRET_STORAGE_KEY, JSON.stringify(blob))
	} catch {
		// The store is unavailable. The in-memory secret still works for
		// this session; the restoration simply will not be restorable, which
		// the runtime reports rather than claims away.
	}
}

/**
 * The SDK's `CoreAdjudicationConfig.secretProvider` shape.
 *
 * The SDK type is `(sessionId: string) => string | Promise<string>`: it does
 * not admit `undefined`. The SDK's fail-closed path is therefore to OMIT the
 * provider entirely — the registry then generates an in-memory secret and
 * reports `isRestorable() === false`, and the runtime reports the
 * degradation instead of claiming a restoration it cannot perform.
 */
export type AdjudicationSecretProvider = (sessionId: string) => string | Promise<string>

/**
 * The provider's configuration.
 */
export interface CreateSessionSecretProviderOptions {
	/**
	 * Whether the provider may PERSIST a newly generated secret.
	 *
	 * When `false`, a session that has no stored secret gets a FRESH,
	 * IN-MEMORY-ONLY secret. The provider then cannot restore the session's
	 * historical evidence handles, and the caller MUST NOT claim that it
	 * can. The SDK registry reports the degradation through
	 * `isRestorable()`.
	 *
	 * When `true` (the normal first-start path), a missing secret is
	 * generated, persisted and returned.
	 */
	readonly allowCreate?: boolean
}

/**
 * Create the VS Code host adapter for the session secret provider.
 *
 * The provider is a FUNCTION of the session id, exactly like the SDK's
 * `secretProvider?: (sessionId: string) => string | Promise<string>`.
 */
export function createSessionSecretProvider(options: CreateSessionSecretProviderOptions = {}): AdjudicationSecretProvider {
	const allowCreate = options.allowCreate !== false
	return async (sessionId: string): Promise<string> => {
		const id = sessionId?.trim()
		if (!id) {
			// An empty session id has no persisted slot. A fresh in-memory
			// secret is the only coherent answer, and it is NOT restorable.
			return generateSessionSecret()
		}
		const blob = readBlob()
		const existing = blob[id]
		if (existing) {
			// The SAME session always gets the SAME secret, so a restored
			// session re-derives the SAME evidence handles.
			return existing
		}
		const secret = generateSessionSecret()
		if (allowCreate) {
			blob[id] = secret
			writeBlob(blob)
		}
		// When `allowCreate` is false the secret is NOT persisted: it lives
		// only in this process, so the session's historical handles do not
		// resolve after a restart. That is the fail-closed direction, and
		// the SDK registry reports it as NOT restorable.
		return secret
	}
}

/**
 * The provider used at the NORMAL session-start seam.
 *
 * It creates a secret for a session that has none, and returns the stored
 * one for a session that has it (so a REBUILD of the same session keeps its
 * handles).
 */
export function createSessionSecretProviderForStart(): AdjudicationSecretProvider {
	return createSessionSecretProvider({ allowCreate: true })
}

/**
 * The provider used at the RESTORATION seam.
 *
 * It NEVER persists a secret: a restoration must recover the existing one or
 * report that it cannot. A session with no stored secret gets a fresh
 * in-memory secret, which the SDK registry reports as NOT restorable.
 */
export function createSessionSecretProviderForRestore(): AdjudicationSecretProvider {
	return createSessionSecretProvider({ allowCreate: false })
}
