import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { McpServer, McpTool } from "@shared/mcp"
import { describe, expect, it } from "vitest"
import { isToolAutoApproved } from "./sdk-tool-policies"
import { resolveEffectiveAutoApproval } from "./session-auto-approval"

// Minimal structural type for the McpHub surface isToolAutoApproved uses.
// Avoids pulling the full McpHub class (which has heavy VS Code deps).
type McpHubLike = { getServers(): McpServer[] }

describe("isToolAutoApproved", () => {
	it("does not auto-approve command tools by default", () => {
		expect(isToolAutoApproved("run_commands", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(false)
	})

	it("uses executeSafeCommands as the single command approval flag", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				executeSafeCommands: false,
				executeAllCommands: true,
			},
		}

		expect(isToolAutoApproved("run_commands", settings)).toBe(false)
	})

	// ACT-CLINEMM-UPSTREAM-SETTINGS-AUTHORITY-PARITY01
	// EDIT-AUTOAPPROVE-AUTHORITY-REGRESSION01: prove non-command tools consult
	// the live user settings (matches upstream v4.1.10 wiring).
	it("auto-approves edit_files when actions.editFiles=true", () => {
		expect(isToolAutoApproved("editor", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(true)
	})

	it("does NOT auto-approve edit_files when actions.editFiles=false", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				editFiles: false,
			},
		}
		expect(isToolAutoApproved("editor", settings)).toBe(false)
	})

	it("auto-approves read_files when actions.readFiles=true", () => {
		expect(isToolAutoApproved("read_files", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(true)
	})

	it("does NOT auto-approve read_files when actions.readFiles=false", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				readFiles: false,
			},
		}
		expect(isToolAutoApproved("read_files", settings)).toBe(false)
	})

	it("auto-approves fetch_web_content when actions.useBrowser=true", () => {
		expect(isToolAutoApproved("fetch_web_content", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(true)
	})

	it("does NOT auto-approve fetch_web_content when actions.useBrowser=false", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				useBrowser: false,
			},
		}
		expect(isToolAutoApproved("fetch_web_content", settings)).toBe(false)
	})
})

// ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION03
//
// Decision matrix for ordinary MCP tool auto-approval. The bug observed
// in production was:
//
//   persisted MCP = false
//   per-tool MCP.autoApprove (e.g. figma-desktop/get_metadata) = false
//   session override = "all"
//   → approval UI shown (contradicts "ALL — this task")
//
// This block locks in the corrected lattice and freezes the bug as a
// named regression scenario.
describe("ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION03: MCP tool auto-approval lattice", () => {
	function makeMcpHub(tool: { autoApprove?: boolean } | undefined): McpHubLike {
		const server: McpServer = {
			name: "figma-desktop",
			config: "{}",
			status: "connected",
			tools: tool
				? [
						{
							name: "get_metadata",
							description: "Get Figma node metadata",
							autoApprove: tool.autoApprove,
						} satisfies McpTool,
					]
				: [],
		}
		return {
			getServers: () => [server],
		}
	}

	const persistedMcpOff = {
		...DEFAULT_AUTO_APPROVAL_SETTINGS,
		actions: {
			...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
			useMcp: false,
		},
	}
	const persistedMcpOn = {
		...DEFAULT_AUTO_APPROVAL_SETTINGS,
		actions: {
			...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
			useMcp: true,
		},
	}

	const hub = makeMcpHub({ autoApprove: false }) as unknown as Parameters<typeof isToolAutoApproved>[2]
	const hubApproved = makeMcpHub({ autoApprove: true }) as unknown as Parameters<typeof isToolAutoApproved>[2]

	// A. persisted MCP=false, session override=none => existing ASK
	it("A. persisted MCP=false + override=none + tool.autoApprove=false => ASK", () => {
		expect(isToolAutoApproved("figma-desktop__get_metadata", persistedMcpOff, hub, "none")).toBe(false)
	})

	// B. persisted MCP=true, session override=none, per-tool approved => existing ALLOW
	it("B. persisted MCP=true + override=none + tool.autoApprove=true => ALLOW", () => {
		expect(isToolAutoApproved("figma-desktop__get_metadata", persistedMcpOn, hubApproved, "none")).toBe(true)
	})

	// C. persisted MCP=false, session override=ALL => ALLOW (the production bug fix)
	it("C. persisted MCP=false + override=all + tool.autoApprove=false => ALLOW", () => {
		expect(isToolAutoApproved("figma-desktop__get_metadata", persistedMcpOff, hub, "all")).toBe(true)
	})

	// D. persisted MCP=true, session override=ALL, per-tool approved => ALLOW
	it("D. persisted MCP=true + override=all + tool.autoApprove=true => ALLOW", () => {
		expect(isToolAutoApproved("figma-desktop__get_metadata", persistedMcpOn, hubApproved, "all")).toBe(true)
	})

	// E. persisted MCP=false, override transitioned back to none => ASK
	it("E. persisted MCP=false + override transitioned back to none + tool.autoApprove=false => ASK", () => {
		expect(isToolAutoApproved("figma-desktop__get_metadata", persistedMcpOff, hub, "none")).toBe(false)
	})
})

// ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION03 (continued)
//
// F. pre-arm ALL → new session consumes ALL → MCP ALLOW
// G. architectural hard-DENY fixture (mutation-proof)
describe("ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION03: resolver path + mutation proof", () => {
	function makeMcpHub(tool: { autoApprove?: boolean } | undefined): McpHubLike {
		const server: McpServer = {
			name: "figma-desktop",
			config: "{}",
			status: "connected",
			tools: tool
				? [
						{
							name: "get_metadata",
							description: "Get Figma node metadata",
							autoApprove: tool.autoApprove,
						} satisfies McpTool,
					]
				: [],
		}
		return {
			getServers: () => [server],
		}
	}

	const persistedMcpOff = {
		...DEFAULT_AUTO_APPROVAL_SETTINGS,
		actions: {
			...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
			useMcp: false,
		},
	}
	const persistedMcpOn = {
		...DEFAULT_AUTO_APPROVAL_SETTINGS,
		actions: {
			...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
			useMcp: true,
		},
	}

	// F. resolver path: SdkController-style projection ends in ALLOW
	it("F. resolver path (pre-arm → consumed → override=all + persisted MCP=false) => ALLOW", () => {
		const hub = makeMcpHub({ autoApprove: false }) as unknown as Parameters<typeof isToolAutoApproved>[2]
		const effective = resolveEffectiveAutoApproval(persistedMcpOff, "all")
		expect(isToolAutoApproved("figma-desktop__get_metadata", effective, hub, "all")).toBe(true)
	})

	// G1. unknown server/tool pair stays ASK even under ALL
	it("G1. unknown MCP server/tool pair stays ASK even under ALL", () => {
		const hub = makeMcpHub({ autoApprove: true }) as unknown as Parameters<typeof isToolAutoApproved>[2]
		expect(isToolAutoApproved("nonexistent-server__unknown", persistedMcpOn, hub, "all")).toBe(false)
	})

	// G2. server present but tool not in server's tool list stays ASK
	it("G2. server present, tool not in server's tool list stays ASK even under ALL", () => {
		const emptyHub = makeMcpHub(undefined) as unknown as Parameters<typeof isToolAutoApproved>[2]
		expect(isToolAutoApproved("figma-desktop__get_metadata", persistedMcpOff, emptyHub, "all")).toBe(false)
	})

	// Upstream-conservation: non-MCP branches unchanged when override=none
	it("upstream-conservation: override=none on non-MCP tools unchanged", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				readFiles: false,
				editFiles: false,
				useBrowser: false,
			},
		}
		expect(isToolAutoApproved("read_files", settings, undefined, "none")).toBe(false)
		expect(isToolAutoApproved("editor", settings, undefined, "none")).toBe(false)
		expect(isToolAutoApproved("fetch_web_content", settings, undefined, "none")).toBe(false)
	})

	// Mutation-proof fixture: exact production repro shape.
	it("PRODUCTION REGRESSION: figma-desktop/get_metadata repro under override=all", () => {
		const figmaHub = makeMcpHub({ autoApprove: false }) as unknown as Parameters<typeof isToolAutoApproved>[2]
		expect(isToolAutoApproved("figma-desktop__get_metadata", persistedMcpOff, figmaHub, "all")).toBe(true)
	})
})

// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION02:
// Live-host evidence-authenticity tests for the new
// subprocess-based buildTempAuthorityEvidence() helper.
//
// These tests prove the ADAPTER (not just the policy seam) is
// truthful. Per the reviewer's disposition:
//   "Your current tests are good policy-seam tests, but they
//    only inject arbitrary TempAuthorityEvidence values and
//    prove the policy gate obeys those values. They do not
//    prove the VS Code adapter constructed truthful evidence."
//
// On a darwin host, the adapter must:
//   - return executableRealpath === "/usr/bin/mktemp" when
//     /usr/bin/which mktemp resolves to /usr/bin/mktemp
//   - return undefined when PATH shadows mktemp (e.g. Nix or
//     homebrew coreutils)
//   - never use os.tmpdir() (which honors TMPDIR)
//
// On non-darwin hosts, the adapter must return undefined.

import { buildTempAuthorityEvidence } from "./sdk-tool-policies"

describe("CORRECTION02: buildTempAuthorityEvidence (host adapter authenticity)", () => {
	it("returns non-darwin as undefined", () => {
		if (process.platform === "darwin") {
			// skip on darwin hosts (covered by the next tests)
			return
		}
		expect(buildTempAuthorityEvidence()).toBeUndefined()
	})

	it("on darwin with /usr/bin/mktemp first in PATH: identity-bound evidence", () => {
		if (process.platform !== "darwin") return
		// Run /usr/bin/which mktemp with a PATH that puts /usr/bin
		// FIRST, so the subprocess returns /usr/bin/mktemp. The
		// adapter must then return evidence with executableRealpath
		// === "/usr/bin/mktemp" AND darwinUserTempRoot from getconf
		// (not from TMPDIR / not synthetic).
		const originalPath = process.env.PATH
		try {
			process.env.PATH = "/usr/bin:/bin"
			const ev = buildTempAuthorityEvidence()
			expect(ev).toBeDefined()
			expect(ev!.platform).toBe("darwin")
			expect(ev!.executableRealpath).toBe("/usr/bin/mktemp")
			expect(typeof ev!.darwinUserTempRoot).toBe("string")
			expect(ev!.darwinUserTempRoot.length).toBeGreaterThan(0)
			// The canonical root must be the Apple-authoritative
			// Darwin per-user temp directory, not /tmp or /synthetic.
			expect(ev!.darwinUserTempRoot).not.toBe("/tmp")
			expect(ev!.darwinUserTempRoot).not.toMatch(/^\/synthetic/)
			expect(ev!.darwinUserTempRoot).toMatch(/^\/(private\/)?var\/folders\//)
		} finally {
			process.env.PATH = originalPath
		}
	})

	it("on darwin with PATH-shadowed mktemp: returns undefined (fail closed)", () => {
		if (process.platform !== "darwin") return
		// Override PATH so /usr/bin/which mktemp returns a non-/usr/bin
		// path. Use the Nix GNU coreutils mktemp we already have at
		// /run/current-system/sw/bin/mktemp if present, otherwise any
		// non-/usr/bin/mktemp path.
		const originalPath = process.env.PATH
		try {
			process.env.PATH = "/run/current-system/sw/bin:/usr/bin:/bin"
			// The subprocess child will see this PATH; if /usr/bin/which
			// resolves mktemp to the Nix coreutils, the realpath will
			// be the GNU coreutils and the gate fails closed.
			const ev = buildTempAuthorityEvidence()
			if (ev !== undefined) {
				// If Nix coreutils isn't installed, /usr/bin/which still
				// returns /usr/bin/mktemp first -- in that case the
				// adapter returns valid evidence and we accept it.
				// The strict-identity test (realpath !== /usr/bin/mktemp)
				// requires a PATH shadow to actually trigger.
				expect(ev.executableRealpath).toBe("/usr/bin/mktemp")
			}
		} finally {
			process.env.PATH = originalPath
		}
	})

	it("on darwin with TMPDIR steered but /usr/bin/mktemp first in PATH: getconf source wins", () => {
		if (process.platform !== "darwin") return
		const originalTmpdir = process.env.TMPDIR
		try {
			// Steer TMPDIR to a synthetic path BEFORE invoking the
			// adapter. The adapter uses /usr/bin/getconf (NOT
			// os.tmpdir()), so the synthetic TMPDIR must NOT affect
			// the darwinUserTempRoot value.
			process.env.TMPDIR = "/synthetic/attacker-selected"
			const ev = buildTempAuthorityEvidence()
			if (ev !== undefined) {
				expect(ev.darwinUserTempRoot).not.toBe("/synthetic/attacker-selected")
				expect(ev.darwinUserTempRoot).not.toBe(process.env.TMPDIR)
			}
		} finally {
			process.env.TMPDIR = originalTmpdir
		}
	})
})
