import type { Meta, StoryObj } from "@storybook/react-vite"
import { createStorybookDecorator } from "@/config/StorybookDecorator"
import ContextWindow from "./ContextWindow"

const meta: Meta<typeof ContextWindow> = {
	title: "Views/Components/ContextWindow",
	component: ContextWindow,
	parameters: {
		layout: "padded",
		docs: {
			description: {
				component:
					"ContextWindow shows token usage against the model's context window and hosts the compact-task button with its inline confirmation card. The decorator mimics the expanded TaskHeader card so spacing and contrast are representative.",
			},
		},
	},
	decorators: [
		createStorybookDecorator(
			undefined,
			// Mirror TaskHeader's expanded card surface so the compact
			// confirmation is previewed against its real background.
			"rounded-sm border-1 pt-2 pb-2 px-2 bg-(--vscode-toolbar-hoverBackground)/65",
		),
	],
	argTypes: {
		contextWindow: { control: "number", description: "Model context window size" },
		lastApiReqContextInputTokens: {
			control: "number",
			description:
				"ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 (CORRECTION01): provider-normalized context-input token count of the last request (`tokensIn + cacheReads + cacheWrites`, the AI SDK `inputTokens.total` contract) — drives the bar percentage and the displayed used value. Distinct from `lastApiReqTotalTokens` (which sums input + output + cache activity).",
		},
		lastApiReqTotalTokens: {
			control: "number",
			description: "Billed request total (input + output + cache). Not used by the bar percentage.",
		},
	},
}

export default meta
type Story = StoryObj<typeof ContextWindow>

export const HighUsage: Story = {
	args: {
		contextWindow: 200_000,
		// ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 (CORRECTION01): the bar
		// reflects the provider-normalized context-input occupancy
		// (`tokensIn + cacheReads + cacheWrites`), not the billed request total.
		lastApiReqContextInputTokens: 45_000,
		lastApiReqTotalTokens: 146_000,
		tokensIn: 36_000,
		tokensOut: 28_000,
		cacheWrites: 5_200,
		cacheReads: 3_800,
		useAutoCondense: false,
	},
	parameters: {
		docs: {
			description: {
				story: "High context usage. Click the fold icon to open the compact-task confirmation card.",
			},
		},
	},
}
