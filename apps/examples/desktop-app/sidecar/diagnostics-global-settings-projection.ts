/**
 * ACT-CLINEMM-DIAGNOSTIC-EXPORT-PRIVACY01 — CORRECTION02
 *
 * The SHAREABLE projection of the GLOBAL SETTINGS for the diagnostic export.
 *
 * WHY A SEPARATE MODULE
 * ---------------------
 * The export artifact is handed to a support engineer, so it is a PUBLIC
 * surface. The global settings are USER-CONFIGURABLE state, and their schema
 * explicitly allows ARBITRARY strings:
 *
 *   - `tuiTheme` is `z.string()` — any text at all.
 *   - `disabledTools`, `disabledPlugins` and `disabledAgentPlugins` are
 *     arrays of arbitrary strings (tool names, plugin paths).
 *   - `cloudModelId` is `z.string()` — any text at all.
 *
 * Selecting those KEYS is therefore not sufficient: the VALUES are
 * unrestricted, and a sensitive string placed in `disabledPlugins` would be
 * copied verbatim into the exported artifact. The same is true of the
 * `tools` block, whose values are nested objects.
 *
 * WHAT THIS PROJECTION KEEPS
 * --------------------------
 * Only values that are VALIDATED PRIMITIVES or COUNTS:
 *
 *   - booleans (`telemetryOptOut`, `autoUpdateEnabled`,
 *     `compactionEnabled`, `toolAutoApprove`),
 *   - closed enums (`compactionStrategy`, `planActMode`),
 *   - the model-tool toggles, projected onto the FINITE set of
 *     configurable tool names as plain booleans,
 *   - the SIZE of each free-form list, never its entries.
 *
 * Every value is re-validated HERE rather than trusted from the caller: the
 * projection is the privacy boundary, so it must hold even if it is handed a
 * hand-edited settings file whose values never passed the schema.
 */

/**
 * The compaction strategies the settings schema allows.
 *
 * A value outside this set is NOT published: the export carries a closed
 * enum, never an arbitrary string.
 */
const COMPACTION_STRATEGIES = ["basic", "agentic"] as const;

/** The plan/act modes the settings schema allows. */
const PLAN_ACT_MODES = ["plan", "act"] as const;

type CompactionStrategy = (typeof COMPACTION_STRATEGIES)[number];
type PlanActMode = (typeof PLAN_ACT_MODES)[number];

/**
 * The configurable model tools whose toggles are published.
 *
 * The set is FINITE and comes from the shared schema vocabulary, so the
 * published keys are bounded and known. The VALUES are booleans.
 */
const CONFIGURABLE_MODEL_TOOL_NAMES = ["web_search"] as const;

/**
 * The shareable projection of the global settings.
 *
 * Every leaf is a boolean, a closed-enum string, or a count.
 */
export interface DiagnosticsGlobalSettingsProjection {
	readonly telemetryOptOut: boolean;
	readonly autoUpdateEnabled: boolean;
	readonly compactionStrategy: CompactionStrategy | undefined;
	readonly compactionEnabled: boolean | undefined;
	readonly planActMode: PlanActMode | undefined;
	readonly toolAutoApprove: boolean | undefined;
	/** The model-tool toggles, as booleans over a finite key set. */
	readonly modelTools: Readonly<Record<string, boolean>>;
	/** How many tools are disabled. The NAMES are not published. */
	readonly disabledToolsCount: number;
	/** How many plugins are disabled. The NAMES/PATHS are not published. */
	readonly disabledPluginsCount: number;
	/** How many agent plugins are disabled. The NAMES/PATHS are not published. */
	readonly disabledAgentPluginsCount: number;
}

/** The shape of the settings the projection reads. */
type SettingsLike = Record<string, unknown>;

/** Read a boolean, or `undefined` when the value is not a boolean. */
function readBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

/** Read a string that must be a member of a closed set. */
function readEnum<T extends string>(
	value: unknown,
	allowed: readonly T[],
): T | undefined {
	return typeof value === "string" &&
		(allowed as readonly string[]).includes(value)
		? (value as T)
		: undefined;
}

/**
 * Read the SIZE of a free-form list.
 *
 * Only the COUNT is published. The entries are arbitrary user-controlled
 * strings and are never read.
 */
function readListCount(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

/**
 * Project the model-tool toggles onto the finite set of configurable tool
 * names.
 *
 * The settings schema allows only `web_search`, and its value is a boolean.
 * Any other key is ignored, and a non-boolean value is treated as disabled
 * rather than published.
 */
function readModelTools(value: unknown): Record<string, boolean> {
	const source =
		value !== null && typeof value === "object" && !Array.isArray(value)
			? (value as SettingsLike)
			: {};
	const toggles: Record<string, boolean> = {};
	for (const name of CONFIGURABLE_MODEL_TOOL_NAMES) {
		const setting = source[name];
		toggles[name] =
			setting !== null &&
			typeof setting === "object" &&
			!Array.isArray(setting) &&
			typeof (setting as SettingsLike).enabled === "boolean"
				? ((setting as SettingsLike).enabled as boolean)
				: false;
	}
	return toggles;
}

/**
 * Project the global settings into the shareable, validated shape.
 *
 * @param settings the global settings object (may be absent or malformed)
 */
export function projectDiagnosticsGlobalSettings(
	settings: SettingsLike | undefined,
): DiagnosticsGlobalSettingsProjection {
	const source = settings ?? {};
	return {
		telemetryOptOut: readBoolean(source.telemetryOptOut) ?? false,
		autoUpdateEnabled: readBoolean(source.autoUpdateEnabled) ?? true,
		compactionStrategy: readEnum(
			source.compactionStrategy,
			COMPACTION_STRATEGIES,
		),
		compactionEnabled: readBoolean(source.compactionEnabled),
		planActMode: readEnum(source.planActMode, PLAN_ACT_MODES),
		toolAutoApprove: readBoolean(source.toolAutoApprove),
		modelTools: readModelTools(source.tools),
		disabledToolsCount: readListCount(source.disabledTools),
		disabledPluginsCount: readListCount(source.disabledPlugins),
		disabledAgentPluginsCount: readListCount(source.disabledAgentPlugins),
	};
}
