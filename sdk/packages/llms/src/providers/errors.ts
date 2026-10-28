import { getClineEnvironmentConfig } from "@cline/shared";

export const CLINE_NOT_SUBSCRIBED_RESPONSE_MESSAGE =
	"the user is not subscribed to required model plan";
const CLINE_NOT_SUBSCRIBED_FORMATTED_MESSAGE_PREFIX =
	"no access to clinepass subscription models yet. subscribe to clinepass";
export const CLINE_ORG_INDIVIDUAL_INFERENCE_SUBSCRIPTION_RESPONSE_MESSAGE =
	"organization accounts cannot use individual model inference subscriptions";

const CLINE_PASS_LIMIT_PREFIX = "you have reached your";
const CLINE_PASS_LIMIT_MARKER = "clinepass limit";
const CLINE_PASS_LIMIT_SUFFIX = "please try again later.";
const CLINE_FREE_MODEL_LIMIT_MARKER = "free limit reached on model";
const CLINE_FREE_MODEL_LIMIT_RETRY_MARKER = "try again in ";
const CLINE_MODEL_NOT_FOUND_MARKER = "model not found";

function findClinePassLimitMessageBounds(
	text: string,
): { start: number; end: number } | undefined {
	const normalized = text.toLowerCase();
	const start = normalized.indexOf(CLINE_PASS_LIMIT_PREFIX);
	if (start === -1) {
		return undefined;
	}

	const suffixStart = normalized.indexOf(CLINE_PASS_LIMIT_SUFFIX, start);
	if (suffixStart === -1) {
		return undefined;
	}

	const end = suffixStart + CLINE_PASS_LIMIT_SUFFIX.length;
	if (!normalized.slice(start, end).includes(CLINE_PASS_LIMIT_MARKER)) {
		return undefined;
	}

	return { start, end };
}

export function getClinePassSubscriptionUrl(): string {
	return `${new URL(
		"/dashboard/subscription?personal=true",
		getClineEnvironmentConfig().appBaseUrl,
	).toString()}`;
}

export function getClineNotSubscribedMessage(): string {
	return `No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: ${getClinePassSubscriptionUrl()}`;
}

export class ClineNotSubscribedError extends Error {
	public readonly providerId?: string;

	constructor(providerId?: string) {
		super(getClineNotSubscribedMessage());
		this.name = "ClineNotSubscribedError";
		this.providerId = providerId;
	}
}

export function getClineOrgIndividualInferenceSubscriptionMessage(): string {
	return "Organization accounts cannot use ClinePass subscriptions. Go to /account -> change account to switch to your personal account for ClinePass";
}

export class ClineOrgIndividualInferenceSubscriptionError extends Error {
	public readonly providerId?: string;

	constructor(providerId?: string) {
		super(getClineOrgIndividualInferenceSubscriptionMessage());
		this.name = "ClineOrgIndividualInferenceSubscriptionError";
		this.providerId = providerId;
	}
}

export class ClinePassLimitError extends Error {
	public readonly providerId?: string;

	constructor(message: string, providerId?: string) {
		super(message);
		this.name = "ClinePassLimitError";
		this.providerId = providerId;
	}
}

export class ClineFreeModelLimitError extends Error {
	public readonly providerId?: string;

	constructor(message: string, providerId?: string) {
		super(message);
		this.name = "ClineFreeModelLimitError";
		this.providerId = providerId;
	}
}

export function isClineNotSubscribedError(
	error: unknown,
): error is ClineNotSubscribedError {
	return error instanceof ClineNotSubscribedError;
}

/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (D2 correction).
 *
 * The reasoning controls a model advertises, in a form a user-facing message
 * can name. `efforts` is the set of effort levels the model accepts; the
 * presence of a `toggle` means the model also accepts a plain on/off.
 */
export interface UnsupportedReasoningConfigurationDetails {
	providerId: string;
	modelId: string;
	/** The effort levels the model does support. */
	efforts: readonly string[];
	/** Whether the model supports a plain reasoning on/off toggle. */
	supportsToggle: boolean;
}

/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (D2 correction).
 *
 * The request asked for reasoning to be DISABLED on a model that mandates
 * reasoning.
 *
 * This is a user-configuration error, not a provider error: the request
 * never reaches the provider. The model would happily run with its
 * mandatory reasoning default, but that would silently replace the user's
 * explicit `None` selection with a different reasoning policy than the one
 * they chose — the exact silent substitution this error exists to prevent.
 *
 * The error is TYPED so the surface that owns the request can distinguish it
 * from a provider failure and can offer the user the supported alternatives
 * instead of a generic transport error.
 */
export class UnsupportedReasoningConfigurationError extends Error {
	public readonly providerId: string;
	public readonly modelId: string;
	public readonly efforts: readonly string[];
	public readonly supportsToggle: boolean;

	constructor(details: UnsupportedReasoningConfigurationDetails) {
		const alternatives = details.supportsToggle
			? "turn reasoning on, or choose an effort level"
			: details.efforts.length > 0
				? `choose one of: ${details.efforts.join(", ")}`
				: "choose a supported reasoning effort";
		super(
			`Model "${details.modelId}" requires reasoning and does not support disabling it. ` +
				`Reasoning was left enabled with the model's own default because the requested "None" setting is not supported. ` +
				`To use this model, ${alternatives}.`,
		);
		this.name = "UnsupportedReasoningConfigurationError";
		this.providerId = details.providerId;
		this.modelId = details.modelId;
		this.efforts = details.efforts;
		this.supportsToggle = details.supportsToggle;
	}
}

export function isUnsupportedReasoningConfigurationError(
	error: unknown,
): error is UnsupportedReasoningConfigurationError {
	return error instanceof UnsupportedReasoningConfigurationError;
}

export function isClineOrgIndividualInferenceSubscriptionError(
	error: unknown,
): error is ClineOrgIndividualInferenceSubscriptionError {
	return error instanceof ClineOrgIndividualInferenceSubscriptionError;
}

export function isClinePassLimitError(
	error: unknown,
): error is ClinePassLimitError {
	return error instanceof ClinePassLimitError;
}

export function isClineFreeModelLimitError(
	error: unknown,
): error is ClineFreeModelLimitError {
	return error instanceof ClineFreeModelLimitError;
}

export function isClineNotSubscribedMessage(text: string): boolean {
	const normalized = text.trim().toLowerCase();
	return (
		normalized.includes(CLINE_NOT_SUBSCRIBED_RESPONSE_MESSAGE) ||
		normalized.includes(CLINE_NOT_SUBSCRIBED_FORMATTED_MESSAGE_PREFIX)
	);
}

export function isClineOrgIndividualInferenceSubscriptionMessage(
	text: string,
): boolean {
	return text
		.toLowerCase()
		.includes(CLINE_ORG_INDIVIDUAL_INFERENCE_SUBSCRIPTION_RESPONSE_MESSAGE);
}

export function isClinePassLimitMessage(text: string): boolean {
	return findClinePassLimitMessageBounds(text) !== undefined;
}

export function extractClinePassLimitMessage(text: string): string | undefined {
	const bounds = findClinePassLimitMessageBounds(text);
	return bounds ? text.slice(bounds.start, bounds.end) : undefined;
}

export function isClineFreeModelLimitMessage(text: string): boolean {
	return text.toLowerCase().includes(CLINE_FREE_MODEL_LIMIT_MARKER);
}

export function isClineModelNotFoundMessage(text: string): boolean {
	return text.toLowerCase().includes(CLINE_MODEL_NOT_FOUND_MARKER);
}

export function extractClineFreeModelLimitResetTime(
	text: string,
): string | undefined {
	const message = text.toLowerCase();
	const resetStart = message.indexOf(CLINE_FREE_MODEL_LIMIT_RETRY_MARKER);
	if (resetStart === -1) {
		return undefined;
	}

	const resetTime = message
		.slice(resetStart + CLINE_FREE_MODEL_LIMIT_RETRY_MARKER.length)
		.trim();
	return resetTime || undefined;
}
