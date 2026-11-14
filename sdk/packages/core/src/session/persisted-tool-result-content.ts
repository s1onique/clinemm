import type { ToolResultContent } from "@cline/shared";
import { toPersistedToolResultContent as sharedToPersistedToolResultContent } from "@cline/shared";

/**
 * Preserve the runtime tool-output serialization used by canonical session
 * persistence. This intentionally remains internal to Core because the
 * historical codec accepts a wider runtime value set than the public
 * `ToolResultContent` type describes.
 *
 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01: the implementation now
 * lives in `@cline/shared` so the canonical provider-visible projection
 * (`toProviderVisibleMessages`) and the session persistence path can never
 * diverge. This module keeps the Core-local import path working.
 */
export function toPersistedToolResultContent(
	output: unknown,
): ToolResultContent["content"] {
	return sharedToPersistedToolResultContent(output);
}
