/**
 * ACT-CLINEMM-DIAGNOSTIC-EXPORT-PRIVACY01
 *
 * The SCHEMA-DRIVEN, ALLOWLISTED projection of a canonical session manifest
 * for the SHAREABLE diagnostic export.
 *
 * WHY A SEPARATE MODULE
 * ---------------------
 * The export artifact is handed to a support engineer. It is therefore a
 * PUBLIC surface, and it has to be safe BY CONSTRUCTION: every value in it
 * is built from a strict allowlist, and every value that cannot be safely
 * classified is OMITTED (and the omission is recorded).
 *
 * The previous implementation copied the whole manifest and then deleted a
 * few keys (`prompt`, `metadata.prompt`, `metadata.systemPrompt`) and relied
 * on a regex to blank anything credential-shaped that happened to appear in
 * the logs or settings. That is not a privacy boundary:
 *
 *   - `metadata.title` IS the user's prompt in production, and it was not
 *     deleted, so the raw prompt shipped in the artifact.
 *   - `metadata.git.url` is a Git remote that can embed credentials, and the
 *     repository's own incident-export privacy contract excludes Git remote
 *     URLs from shareable artifacts.
 *   - `messages_path` / `compaction_path` point at the PRIVATE canonical
 *     conversation records (`*.messages.json`, `*.compaction.json`), so the
 *     artifact advertised the private artifacts as if they were part of it.
 *   - A regex can only ever match the shapes it was written for. It cannot
 *     make an unknown blob safe.
 *
 * WHAT THIS PROJECTION KEEPS
 * --------------------------
 * The evidence a support engineer actually needs, and nothing else:
 *
 *   - the session identity and its run metadata (source, status, provider,
 *     model, timestamps),
 *   - the token/cost accounting counters,
 *   - the checkpoint identity (a git SHA, not a URL),
 *   - the git BRANCH name (a short label, not a remote URL),
 *   - the workspace path, with the home directory collapsed to `~`.
 *
 * WHAT THIS PROJECTION DROPS
 * --------------------------
 *   - the raw prompt (`prompt`, `metadata.prompt`, `metadata.title`,
 *     `metadata.systemPrompt`),
 *   - every credential-bearing field, by construction (nothing outside the
 *     allowlist is ever read),
 *   - the git remote URL,
 *   - the canonical private-persistence paths,
 *   - any other manifest or metadata key that is not allowlisted.
 *
 * HOW AN OMISSION IS RECORDED
 * ---------------------------
 * An omission is recorded, but the record never carries an ARBITRARY name.
 * The projection publishes the omission identifiers from its OWN finite
 * vocabulary (`manifest.prompt`, `metadata.title`, ...) and reports every
 * other omitted field only as a COUNT (`unknownOmittedFieldCount`).
 *
 * Naming an unknown key would be a disclosure channel in its own right: a
 * manifest key is user-controlled content, and a synthetic key such as
 * `PRIVATE_ACCESS_VALUE_123` would otherwise appear verbatim in a shareable
 * artifact.
 *
 * The canonical records themselves are NEVER modified: this module is a
 * READ-ONLY projection. The original `*.messages.json` and
 * `*.compaction.json` remain the private runtime persistence.
 */

/**
 * The maximum length of any single string in the projection.
 *
 * A bounded string keeps the artifact bounded and keeps a long free-form
 * value from smuggling content through a field that is allowlisted for a
 * different purpose.
 */
export const DIAGNOSTICS_PROJECTION_STRING_LIMIT = 512;

/**
 * The maximum number of entries in any projected array.
 */
export const DIAGNOSTICS_PROJECTION_ARRAY_LIMIT = 64;

/**
 * The projection of one session's canonical manifest.
 */
export interface DiagnosticsSessionProjection {
	/** The session's own id. */
	readonly sessionId: string;
	/** Which client produced the session (`vscode`, `cli`, ...). */
	readonly source: string | undefined;
	/** The bounded run status. */
	readonly status: string | undefined;
	/** Whether the session was an interactive one. */
	readonly interactive: boolean | undefined;
	/** The provider id. */
	readonly provider: string | undefined;
	/** The model id. */
	readonly model: string | undefined;
	/** The session start time (ISO-8601). */
	readonly startedAt: string | undefined;
	/** The session end time (ISO-8601), when the session ended. */
	readonly endedAt: string | undefined;
	/** The process exit code, when the session ended. */
	readonly exitCode: number | undefined;
	/** The workspace path with the home directory collapsed to `~`. */
	readonly workspace: string | undefined;
	/** The git branch name (a short label, never a remote URL). */
	readonly gitBranch: string | undefined;
	/** The checkpoint ref (a git SHA). */
	readonly checkpointRef: string | undefined;
	/** The token/cost accounting counters. */
	readonly usage: DiagnosticsSessionUsage | undefined;
	/**
	 * The KNOWN fields that were present in the manifest but are NOT part of
	 * the read allowlist, so they were OMITTED.
	 *
	 * Every entry is a STATIC identifier from a finite list: the names come
	 * from this module's own vocabulary, never from the manifest. A key that
	 * the manifest carries but this module does not know is NOT named here —
	 * it is counted in `unknownOmittedFieldCount` instead, because copying an
	 * arbitrary key name would copy arbitrary content into a shareable
	 * artifact.
	 */
	readonly omittedFields: readonly string[];
	/**
	 * How many fields were omitted whose NAMES are not in this module's
	 * finite vocabulary.
	 *
	 * The count is safe to publish (it is a number); the names are not.
	 */
	readonly unknownOmittedFieldCount: number;
}

/**
 * The token/cost accounting counters of a session.
 *
 * Every field is a NUMBER: a count or a cost, never content.
 */
export interface DiagnosticsSessionUsage {
	readonly inputTokens: number | undefined;
	readonly outputTokens: number | undefined;
	readonly cacheReadTokens: number | undefined;
	readonly cacheWriteTokens: number | undefined;
	readonly totalCost: number | undefined;
}

type JsonRecord = Record<string, unknown>;

/** Read a string field, bounded. */
function readString(
	value: unknown,
	limit = DIAGNOSTICS_PROJECTION_STRING_LIMIT,
) {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0) return undefined;
	return trimmed.length > limit
		? `${trimmed.slice(0, limit)}...[truncated]`
		: trimmed;
}

/** Read a boolean field. */
function readBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

/** Read a finite number field. */
function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/** Read a plain-object field. */
function readObject(value: unknown): JsonRecord | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return value as JsonRecord;
}

/**
 * Collapse the home directory to `~`.
 *
 * A support engineer does not need to know the user's home directory, and
 * the home directory is often the user's real name.
 */
export function collapseHomePath(value: string, home: string): string {
	if (!home) return value;
	return (
		value
			.split(home)
			.join("~")
			// JSON-encoded Windows paths carry doubled backslashes.
			.split(home.replaceAll("\\", "\\\\"))
			.join("~")
	);
}

/**
 * The manifest keys the projection reads.
 *
 * Every other top-level key is OMITTED and recorded in `omittedFields`.
 */
const PROJECTED_MANIFEST_KEYS = new Set([
	"version",
	"session_id",
	"source",
	"pid",
	"started_at",
	"ended_at",
	"exit_code",
	"status",
	"interactive",
	"provider",
	"model",
	"cwd",
	"workspace_root",
	"enable_tools",
	"enable_spawn",
	"enable_teams",
	"metadata",
]);

/**
 * The metadata keys the projection reads.
 *
 * Everything else under `metadata` is omitted: `title`, `prompt`,
 * `systemPrompt`, `git.url`, `providerConfig`, `helmValues`, `provider` and
 * any future key are all dropped by construction.
 */
const PROJECTED_METADATA_KEYS = new Set([
	"git",
	"checkpoint",
	"usage",
	"aggregateUsage",
	"modelId",
	"totalCost",
	"tokensIn",
	"tokensOut",
	"cacheReads",
	"cacheWrites",
]);

/**
 * Read the usage counters from a usage-shaped object.
 *
 * The counters are read from BOTH the `usage` and the `aggregateUsage`
 * blocks; the first block that yields at least one counter wins.
 */
function readUsage(metadata: JsonRecord): DiagnosticsSessionUsage | undefined {
	for (const key of ["usage", "aggregateUsage"]) {
		const block = readObject(metadata[key]);
		if (!block) continue;
		const usage: DiagnosticsSessionUsage = {
			inputTokens: readNumber(block.inputTokens),
			outputTokens: readNumber(block.outputTokens),
			cacheReadTokens: readNumber(block.cacheReadTokens),
			cacheWriteTokens: readNumber(block.cacheWriteTokens),
			totalCost: readNumber(block.totalCost),
		};
		if (Object.values(usage).some((value) => value !== undefined)) {
			return usage;
		}
	}
	// The flat counters the manifest also carries.
	const flat: DiagnosticsSessionUsage = {
		inputTokens: readNumber(metadata.tokensIn),
		outputTokens: readNumber(metadata.tokensOut),
		cacheReadTokens: readNumber(metadata.cacheReads),
		cacheWriteTokens: readNumber(metadata.cacheWrites),
		totalCost: readNumber(metadata.totalCost),
	};
	if (Object.values(flat).some((value) => value !== undefined)) {
		return flat;
	}
	return undefined;
}

/**
 * Read the git branch name.
 *
 * ONLY the branch is read. The remote URL is never read, so it can never
 * reach the artifact — an embedded credential in the URL is impossible by
 * construction rather than by redaction.
 */
function readGitBranch(metadata: JsonRecord): string | undefined {
	const git = readObject(metadata.git);
	if (!git) return undefined;
	return readString(git.branch, 128);
}

/**
 * Read the checkpoint ref (a git SHA).
 */
function readCheckpointRef(metadata: JsonRecord): string | undefined {
	const checkpoint = readObject(metadata.checkpoint);
	if (!checkpoint) return undefined;
	const latest = readObject(checkpoint.latest);
	return readString(latest?.ref, 128);
}

/**
 * The KNOWN manifest keys that are deliberately NOT read, and the KNOWN
 * metadata keys that are deliberately NOT read.
 *
 * These names are the projection's OWN vocabulary: they are the field names
 * this module knows about and refuses to read (the raw prompt, the
 * credential-bearing Git remote, the private-persistence paths, the provider
 * configuration, the Helm values).
 *
 * A manifest key that appears in NEITHER allowlist is an UNKNOWN key. Its
 * name is attacker-/user-controlled content, so it is NEVER copied into the
 * artifact — only counted. Naming an unknown key would turn the omission
 * record into a channel for arbitrary strings.
 */
const KNOWN_OMITTED_MANIFEST_KEYS = new Set([
	"prompt",
	"messages_path",
	"compaction_path",
]);

const KNOWN_OMITTED_METADATA_KEYS = new Set([
	"title",
	"prompt",
	"systemPrompt",
	"providerConfig",
	"helmValues",
	"provider",
]);

/**
 * The finite vocabulary of omission identifiers the projection may publish.
 *
 * A published identifier is ALWAYS one of these literals; the projection
 * never interpolates a manifest-supplied key into it.
 */
const PUBLISHABLE_OMISSION_IDS = new Set([
	...Array.from(KNOWN_OMITTED_MANIFEST_KEYS, (key) => `manifest.${key}`),
	...Array.from(KNOWN_OMITTED_METADATA_KEYS, (key) => `metadata.${key}`),
]);

/**
 * Project a canonical session manifest into the shareable, allowlisted shape.
 *
 * The manifest is READ-ONLY: nothing on disk is modified, and the canonical
 * conversation records are never opened.
 *
 * @param manifest the parsed canonical manifest (may be empty)
 * @param sessionId the session id the manifest belongs to
 * @param home the user's home directory, collapsed to `~` in paths
 */
export function projectDiagnosticsSession(
	manifest: JsonRecord,
	sessionId: string,
	home: string,
): DiagnosticsSessionProjection {
	const metadata = readObject(manifest.metadata) ?? {};
	const omittedFields: string[] = [];
	let unknownOmittedFieldCount = 0;

	for (const key of Object.keys(manifest)) {
		if (PROJECTED_MANIFEST_KEYS.has(key)) {
			continue;
		}
		if (KNOWN_OMITTED_MANIFEST_KEYS.has(key)) {
			omittedFields.push(`manifest.${key}`);
			continue;
		}
		// An UNKNOWN key: its NAME is content, so it is counted, never named.
		unknownOmittedFieldCount += 1;
	}
	for (const key of Object.keys(metadata)) {
		if (PROJECTED_METADATA_KEYS.has(key)) {
			continue;
		}
		if (KNOWN_OMITTED_METADATA_KEYS.has(key)) {
			omittedFields.push(`metadata.${key}`);
			continue;
		}
		unknownOmittedFieldCount += 1;
	}

	const cwd = readString(manifest.cwd);

	return {
		sessionId,
		source: readString(manifest.source, 64),
		status: readString(manifest.status, 64),
		interactive: readBoolean(manifest.interactive),
		provider: readString(manifest.provider, 64),
		model: readString(manifest.model, 128),
		startedAt: readString(manifest.started_at, 64),
		endedAt: readString(manifest.ended_at, 64),
		exitCode: readNumber(manifest.exit_code),
		workspace: cwd ? collapseHomePath(cwd, home) : undefined,
		gitBranch: readGitBranch(metadata),
		checkpointRef: readCheckpointRef(metadata),
		usage: readUsage(metadata),
		// The published omission identifiers are filtered through the finite
		// vocabulary one final time, so the invariant "only static names
		// reach the artifact" holds at the boundary and not merely at the
		// collection site.
		omittedFields: omittedFields
			.filter((id) => PUBLISHABLE_OMISSION_IDS.has(id))
			.slice(0, DIAGNOSTICS_PROJECTION_ARRAY_LIMIT),
		unknownOmittedFieldCount,
	};
}
