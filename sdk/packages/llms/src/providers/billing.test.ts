import { describe, expect, it } from "vitest";
import {
	resolveProviderUsageCostDisplay,
	shouldShowProviderUsageCost,
} from "./billing";
import { getProviderCollectionSync } from "./model-registry";

describe("provider usage cost display", () => {
	it("hides usage cost for subscription-backed Codex providers", () => {
		expect(resolveProviderUsageCostDisplay("openai-codex")).toBe(
			"subscription",
		);
		expect(resolveProviderUsageCostDisplay("openai-codex-cli")).toBe(
			"subscription",
		);
		expect(shouldShowProviderUsageCost("openai-codex")).toBe(false);
		expect(shouldShowProviderUsageCost("openai-codex-cli")).toBe(false);
	});

// ACT-CLINEMM-COST-DISPLAY-TRUTH01: explicit contract for ClinePass,
	// whose token-derived reference prices are NOT the user's per-task
	// spend. Catalog layers downstream MUST preserve this "subscription"
	// class; see apps/vscode/src/sdk/model-catalog/catalog.ts.
	it("hides usage cost for ClinePass (flat-rate subscription)", () => {
		expect(resolveProviderUsageCostDisplay("cline-pass")).toBe(
			"subscription",
		);
		expect(shouldShowProviderUsageCost("cline-pass")).toBe(false);
	});
	it("hides usage cost for the Claude Code subscription provider", () => {
		expect(resolveProviderUsageCostDisplay("claude-code")).toBe("subscription");
		expect(shouldShowProviderUsageCost("claude-code")).toBe(false);
	});

	it("shows usage cost by default for usage-billed providers", () => {
		expect(resolveProviderUsageCostDisplay("openai-native")).toBe("show");
		expect(resolveProviderUsageCostDisplay("anthropic")).toBe("show");
		expect(resolveProviderUsageCostDisplay("cline")).toBe("show");
		expect(shouldShowProviderUsageCost("anthropic")).toBe(true);
	});

	it("stores the display policy on provider metadata", () => {
		expect(
			getProviderCollectionSync("openai-codex")?.provider.metadata,
		).toMatchObject({ usageCostDisplay: "subscription" });
		expect(
			getProviderCollectionSync("cline-pass")?.provider.metadata,
		).toMatchObject({ usageCostDisplay: "subscription" });
	});
});
