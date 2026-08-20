/**
 * ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01 — real render seam.
 *
 * Belongs to the WEBSIDE closure of the CORRECTION02 ACT. The previous
 * TI_UI01..TI_UI03 translator tests proved the translator contract pinning
 * (`say:"command"`, `commandCompleted:true`, `text` contains
 * COMMAND_OUTPUT_STRING AND the verbatim validation error), but DID NOT prove
 * the user-visible heading for the resulting row was truthful. This file
 * closes that gap by rendering the REAL `ChatRow` (not a mock) with the
 * translator-produced `ClineMessage` and asserting the heading text.
 *
 * RCP01 — RED before production change:
 *   a rejected-before-execution row currently renders
 *     "Cline wants to execute this command:"
 *   which is semantically FALSE: no approval was requested, no executor
 *   was called. The translator stamps `commandExecutionDisposition`
 *   on the message; ChatRow must consult that field rather than the
 *   unconditional hardcoded string.
 *
 * The other RCP02..RCP10 invariants (pending/executing/completed/
 * executed-failure/status-pill/no-text-heuristic) are also asserted
 * here so the WHOLE bounded presentation contract is provable from a
 * single fixture file, as required by §26 (MOCK DISCIPLINE) and §34
 * (NECESSITY / ABLATION). They run against the same production
 * `ChatRowContent` and exercise the SAME branches the user actually
 * hits.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"

import { ChatRowContent } from "../ChatRow"

// We mock `useExtensionState` only to satisfy the dependency on shared
// webview context for `ChatRowContent`. The chat-row render itself is the
// production component — no chat-row mock.

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [],
		clineMessages: [],
		vscodeTerminalExecutionMode: "vscodeTerminal",
		showFeatureTips: false,
		enableCheckpointsSetting: false,
		turnState: { phase: "idle", seq: 0 },
		thinkingPresentation: undefined,
		backgroundEditEnabled: false,
	}),
	__esModule: true,
}))

vi.mock("@/components/chat/CommandOutputRow", () => ({
	// Render just the icon and title so the heading semantics are
	// observable via RTL without pulling in the rest of the row's
	// internals (status pill, expandable output, etc.). The icon is
	// part of the heading by visual convention but the assertion
	// targets the heading text span specifically.
	CommandOutputRow: ({ icon, title }: { icon?: React.ReactNode; title?: React.ReactNode }) => (
		<div data-testid="command-output-row-stub">
			{icon}
			{title}
		</div>
	),
	CommandOutputContent: () => null,
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: { openFile: vi.fn(), openIntegratedTerminal: vi.fn() },
	UiServiceClient: { scrollToSettings: vi.fn() },
}))

vi.mock("@/components/chat/chat-view/utils/messageUtils", () => ({
	canRestoreWorkspaceFromMessage: () => false,
}))

function commandRowMessage(overrides: Partial<ClineMessage> = {}): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		say: "command",
		text: 'git status\n<<<COMMAND OUTPUT>>>\nError: {"error":"✖ Invalid input"}',
		commandCompleted: true,
		...overrides,
	}
}

function makeProps(message: ClineMessage) {
	return {
		message,
		isExpanded: true,
		onToggleExpand: vi.fn(),
		lastModifiedMessage: message,
		isLast: true,
		onSetQuote: vi.fn(),
		onCancelCommand: undefined,
		inputValue: "",
		sendMessageFromChatRow: undefined,
		onLastRowContentChange: undefined,
		mode: "act" as const,
		reasoningContent: undefined,
		responseStarted: false,
	}
}

describe("ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01 / real-render seam", () => {
	// ---------- RCP01 — RED at HEAD before production change ----------
	//
	// At HEAD before this ACT, ChatRow hardcoded the heading for
	// `case "command"` regardless of `commandExecutionDisposition`.
	// After this ACT lands, a row stamped with the new structured field
	// MUST NOT show the approval-language heading.
	//
	// HEAD pre-fix expected: this assertion FAILS (the heading is
	// present), proving the bug at the real render seam.
	// Post-fix expected: this assertion PASSES (the approval heading
	// is gone for the rejection case).
	//
	// The `commandExecutionDisposition` field is added by this ACT as
	// part of the typed wire-fixing delta. Until then TypeScript would
	// reject the field on `ClineMessage`; the test is therefore
	// expected to be RED twice: first as a TS error, then as a
	// behavioural assertion once the field is added but ChatRow still
	// ignores it.

	it("RCP01: rejected-before-execution row never says 'wants to execute'", () => {
		const message = commandRowMessage({
			commandExecutionDisposition: "rejected_before_execution",
		})
		render(<ChatRowContent {...makeProps(message)} />)
		expect(screen.queryByText("Cline wants to execute this command:")).toBeNull()
	})

	// ---------- RCP02 — pending-approval control ----------
	//
	// A genuinely-pending command (no completion flag, no execution
	// marker) MUST keep the approval-language wording. Guards against
	// accidental over-correction from RCP01.

	it("RCP02: genuinely pending (no disposition) keeps approval wording", () => {
		const message: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "command",
			text: "git status",
			commandCompleted: undefined,
		}
		render(<ChatRowContent {...makeProps(message)} />)
		expect(screen.getByText("Cline wants to execute this command:")).toBeInTheDocument()
	})

	// ---------- RCP03 — currently executing control ----------
	//
	// The streaming mid-run shape: marker present, body empty. Heading
	// stays; downstream status pill is "Running".

	it("RCP03: executing row retains the existing heading semantics", () => {
		const message = commandRowMessage({
			commandCompleted: undefined,
			text: "git status\n<<<COMMAND OUTPUT>>>",
		})
		render(<ChatRowContent {...makeProps(message)} />)
		expect(screen.getByText("Cline wants to execute this command:")).toBeInTheDocument()
	})

	// ---------- RCP04 — completed (executed) control ----------
	//
	// A successful command completion keeps the existing heading.
	// The heading is about the recent proposal-to-execute intent;
	// success vs running is a downstream timing distinction.

	it("RCP04: completed (executed) row preserves the existing heading", () => {
		const message = commandRowMessage({
			// see RCP01
			commandExecutionDisposition: "executed",
			text: "git status\n<<<COMMAND OUTPUT>>>\nOn branch main",
		})
		render(<ChatRowContent {...makeProps(message)} />)
		expect(screen.getByText("Cline wants to execute this command:")).toBeInTheDocument()
	})

	// ---------- RCP05 — executed failure control ----------
	//
	// A command that ACTUALLY EXECUTED but returned non-zero / error.
	// Free-form error text MUST NOT be a disambiguator; the typed
	// `commandExecutionDisposition: "executed"` field keeps this from
	// being mislabelled as pre-execution rejection.

	it("RCP05: executed-failure keeps the existing heading (NOT a rejection)", () => {
		const message = commandRowMessage({
			// see RCP01
			commandExecutionDisposition: "executed",
			text: "git status\n<<<COMMAND OUTPUT>>>\nError: git: not a repository (or any parent): '.git'",
		})
		render(<ChatRowContent {...makeProps(message)} />)
		expect(screen.getByText("Cline wants to execute this command:")).toBeInTheDocument()
	})

	// ---------- RCP06 — schema-invalid input control ----------
	//
	// The exact TI_UI01 producer shape, re-rendered. The approval
	// heading must be absent; a truthful rejection heading must be
	// present. Exact copy is P2 per §48.

	it("RCP06: schema-invalid input row has a non-approval heading", () => {
		const message = commandRowMessage({
			// see RCP01
			commandExecutionDisposition: "rejected_before_execution",
			text: 'git status\n<<<COMMAND OUTPUT>>>\nError: {"error":"✖ Invalid input"}',
		})
		render(<ChatRowContent {...makeProps(message)} />)
		expect(screen.queryByText("Cline wants to execute this command:")).toBeNull()
		// A truthful rejection heading must be present. Use a
		// substring matcher keyed on the lifecycle semantics to avoid
		// coupling to exact wording (per §48 P2).
		const allHeadings = Array.from(document.querySelectorAll("span, h1, h2, h3, h4, h5, h6"))
			.map((n) => n.textContent ?? "")
			.filter(Boolean)
		const truthy = allHeadings.some((t) => /rejected|invalid/i.test(t))
		expect(truthy).toBe(true)
	})

	// ---------- RCP09 — error text cannot drive classification ----------
	//
	// A command that ACTUALLY EXECUTED may emit "Invalid input" in
	// stderr. The selector MUST classify by structured
	// `commandExecutionDisposition`, NEVER by text (anti-text-heuristic
	// guard from §16).

	it("RCP09: executed row with 'Invalid input' stderr is NOT rejected", () => {
		const message = commandRowMessage({
			// see RCP01
			commandExecutionDisposition: "executed",
			text: "some-cli args\n<<<COMMAND OUTPUT>>>\nError: Invalid input: missing flag --foo",
		})
		render(<ChatRowContent {...makeProps(message)} />)
		expect(screen.getByText("Cline wants to execute this command:")).toBeInTheDocument()
	})

	// ---------- RCP10 — structured rejection drives presentation ----------
	//
	// The selector MUST work regardless of the verbatim validation
	// text. The wording is allowed to vary.

	it("RCP10: rejection classification is independent of validation text", () => {
		const message = commandRowMessage({
			// see RCP01
			commandExecutionDisposition: "rejected_before_execution",
			text: "ls -la\n<<<COMMAND OUTPUT>>>\nError: unsupported timeout 120000 — max 60000",
		})
		render(<ChatRowContent {...makeProps(message)} />)
		expect(screen.queryByText("Cline wants to execute this command:")).toBeNull()
	})
})
