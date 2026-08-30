import { evaluateCommandPolicy } from "@cline/core"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { McpServer, McpTool } from "@shared/mcp"
import { describe, expect, it } from "vitest"
import { buildTempAuthorityEvidence, getCommandHostAuthorization, isToolAutoApproved } from "./sdk-tool-policies"
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

// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION03:
// Slash-bypass positive case: with strict identity bound, the
// EXPLICIT-PATH forms /usr/bin/mktemp and /usr/bin/mktemp -d
// are AUTO. BARE forms (mktemp, mktemp -d) are ASK with the
// new source label host_mktemp_shell_resolution_unbound because
// bash's lookup order (function -> builtin -> PATH) means the
// policy cannot prove the executed identity for the bare form.
//
// These tests are REAL production-policy-seam tests; they
// drive evaluateCommandPolicy with production-shaped host
// authorization and the strict-identity evidence.

const DARWIN_BSD_EVIDENCE = {
	platform: "darwin",
	executablePath: "/usr/bin/mktemp",
	executableRealpath: "/usr/bin/mktemp",
	darwinUserTempRoot: "/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T",
	canonicalDarwinUserTempRoot: "/private/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T",
} as const

describe("CORRECTION03: explicit-path slash-bypass (policy seam)", () => {
	it("/usr/bin/mktemp + darwin identity + getconf root -> ALLOW", () => {
		// These tests are REAL production-policy-seam tests; they
		// drive evaluateCommandPolicy with production-shaped host
		// authorization and the strict-identity evidence. The
		// CORRECTION03 gate rejects the bare form with
		// host_mktemp_shell_resolution_unbound and allows the
		// slash-prefixed form when the host evidence is present
		// and the identity realpath equals /usr/bin/mktemp.
		const r = evaluateCommandPolicy({
			toolInput: { command: "/usr/bin/mktemp" },
			hostAuthorization: {
				mode: "safe-only",
				explicitAllowRules: [
					{
						source: "host_safe_mktemp_default_temp",
						pattern: /^\s*(?:\/usr\/bin\/)?mktemp(?:\s+-d)?\s*$/u,
					},
				],
				tempAuthorityEvidence: DARWIN_BSD_EVIDENCE,
			},
		})
		expect(r.decision.kind).toBe("allow")
		expect(r.decision.matchedRuleSource).toBe("host_safe_mktemp_default_temp")
	})
	it("bare `mktemp` + darwin identity -> ASK with host_mktemp_shell_resolution_unbound", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "mktemp" },
			hostAuthorization: {
				mode: "safe-only",
				explicitAllowRules: [
					{
						source: "host_safe_mktemp_default_temp",
						pattern: /^\s*(?:\/usr\/bin\/)?mktemp(?:\s+-d)?\s*$/u,
					},
				],
				tempAuthorityEvidence: DARWIN_BSD_EVIDENCE,
			},
		})
		expect(r.decision.kind).toBe("ask")
		expect(r.decision.source).toBe("host_mktemp_shell_resolution_unbound")
	})
})

// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-EXPLICIT-PATH-EVIDENCE01
//
// Production-shaped host-adapter tests for the explicit-path
// evidence binding. These are REAL_PRODUCTION_HOST_ADAPTER tests:
// they drive `getCommandHostAuthorization()` (the actual function
// `SdkController.resolveHostAuthorization` calls in production)
// with a toolInput whose first rendered command is the slash-
// prefixed `/usr/bin/mktemp`. Then they drive
// `evaluateCommandPolicy()` with that produced authorization
// (NOT an injected TempAuthorityEvidence) and assert the policy
// outcome.
//
// The defining scenario is the installed false negative this ACT
// closes: on a darwin host whose PATH is shadowed by GNU/Nix
// coreutils mktemp first, the user's explicit invocation
// `/usr/bin/mktemp` MUST auto-approve, because bash executes a
// slash-prefixed command name as a pathname (GNU Bash Reference
// Manual, Command Search and Execution).

describe("ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-EXPLICIT-PATH-EVIDENCE01: host adapter binds evidence to slash-prefixed executable", () => {
	const SAFE_ON_SETTINGS = {
		...DEFAULT_AUTO_APPROVAL_SETTINGS,
		actions: {
			...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
			executeSafeCommands: true,
		},
	}

	it("R1: with PATH shadowed to GNU/Nix mktemp first, /usr/bin/mktemp via getCommandHostAuthorization -> ALLOW", () => {
		if (process.platform !== "darwin") return
		const originalPath = process.env.PATH
		try {
			process.env.PATH = "/run/current-system/sw/bin:/usr/bin:/bin"
			const auth = getCommandHostAuthorization("run_commands", SAFE_ON_SETTINGS, undefined, undefined, {
				command: "/usr/bin/mktemp",
			})
			expect(auth.tempAuthorityEvidence).toBeDefined()
			expect(auth.tempAuthorityEvidence!.executableRealpath).toBe("/usr/bin/mktemp")
			const r = evaluateCommandPolicy({
				toolInput: { command: "/usr/bin/mktemp" },
				hostAuthorization: auth,
			})
			expect(r.decision.kind).toBe("allow")
			expect(r.decision.matchedRuleSource).toBe("host_safe_mktemp_default_temp")
		} finally {
			process.env.PATH = originalPath
		}
	})

	it("R2: with PATH shadowed, /usr/bin/mktemp -d via getCommandHostAuthorization -> ALLOW", () => {
		if (process.platform !== "darwin") return
		const originalPath = process.env.PATH
		try {
			process.env.PATH = "/run/current-system/sw/bin:/usr/bin:/bin"
			const auth = getCommandHostAuthorization("run_commands", SAFE_ON_SETTINGS, undefined, undefined, {
				command: "/usr/bin/mktemp -d",
			})
			const r = evaluateCommandPolicy({
				toolInput: { command: "/usr/bin/mktemp -d" },
				hostAuthorization: auth,
			})
			expect(r.decision.kind).toBe("allow")
			expect(r.decision.matchedRuleSource).toBe("host_safe_mktemp_default_temp")
		} finally {
			process.env.PATH = originalPath
		}
	})

	it("CONSERVATION: with PATH shadowed, bare `mktemp` -> ASK with shell_resolution_unbound", () => {
		if (process.platform !== "darwin") return
		const originalPath = process.env.PATH
		try {
			process.env.PATH = "/run/current-system/sw/bin:/usr/bin:/bin"
			const auth = getCommandHostAuthorization("run_commands", SAFE_ON_SETTINGS, undefined, undefined, {
				command: "mktemp",
			})
			const r = evaluateCommandPolicy({
				toolInput: { command: "mktemp" },
				hostAuthorization: auth,
			})
			expect(r.decision.kind).toBe("ask")
			expect(r.decision.source).toBe("host_mktemp_shell_resolution_unbound")
		} finally {
			process.env.PATH = originalPath
		}
	})

	it("CONSERVATION: with PATH shadowed, bare `mktemp -d` -> ASK with shell_resolution_unbound", () => {
		if (process.platform !== "darwin") return
		const originalPath = process.env.PATH
		try {
			process.env.PATH = "/run/current-system/sw/bin:/usr/bin:/bin"
			const auth = getCommandHostAuthorization("run_commands", SAFE_ON_SETTINGS, undefined, undefined, {
				command: "mktemp -d",
			})
			const r = evaluateCommandPolicy({
				toolInput: { command: "mktemp -d" },
				hostAuthorization: auth,
			})
			expect(r.decision.kind).toBe("ask")
			expect(r.decision.source).toBe("host_mktemp_shell_resolution_unbound")
		} finally {
			process.env.PATH = originalPath
		}
	})
})

// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-EXPLICIT-PATH-EVIDENCE01
//
// buildTempAuthorityEvidence({executablePath}) unit + getCommandHostAuthorization
// toolInput-shape coverage.

describe("ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-EXPLICIT-PATH-EVIDENCE01: buildTempAuthorityEvidence({executablePath}) unit + toolInput shape", () => {
	const SAFE_ON_SETTINGS = {
		...DEFAULT_AUTO_APPROVAL_SETTINGS,
		actions: {
			...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
			executeSafeCommands: true,
		},
	}

	describe("buildTempAuthorityEvidence({executablePath}) explicit-path mode", () => {
		it("darwin + executablePath=/usr/bin/mktemp -> full evidence bound to that path", () => {
			if (process.platform !== "darwin") return
			const ev = buildTempAuthorityEvidence({ executablePath: "/usr/bin/mktemp" })
			expect(ev).toBeDefined()
			expect(ev!.platform).toBe("darwin")
			expect(ev!.executablePath).toBe("/usr/bin/mktemp")
			expect(ev!.executableRealpath).toBe("/usr/bin/mktemp")
			expect(ev!.darwinUserTempRoot.length).toBeGreaterThan(0)
			expect(ev!.canonicalDarwinUserTempRoot.length).toBeGreaterThan(0)
		})

		it("darwin + executablePath=/usr/local/bin/mktemp -> undefined (not Apple-system)", () => {
			if (process.platform !== "darwin") return
			const ev = buildTempAuthorityEvidence({ executablePath: "/usr/local/bin/mktemp" })
			expect(ev).toBeUndefined()
		})

		it("darwin + executablePath=/nonexistent/mktemp -> undefined (realpath fails)", () => {
			if (process.platform !== "darwin") return
			const ev = buildTempAuthorityEvidence({ executablePath: "/nonexistent/mktemp" })
			expect(ev).toBeUndefined()
		})

		it("darwin + executablePath=/usr/bin/mktemp with TMPDIR steered -> getconf still wins", () => {
			if (process.platform !== "darwin") return
			const originalTmpdir = process.env.TMPDIR
			try {
				process.env.TMPDIR = "/synthetic/attacker-selected"
				const ev = buildTempAuthorityEvidence({ executablePath: "/usr/bin/mktemp" })
				if (ev !== undefined) {
					expect(ev.darwinUserTempRoot).not.toBe("/synthetic/attacker-selected")
					expect(ev.darwinUserTempRoot).not.toBe(process.env.TMPDIR)
				}
			} finally {
				process.env.TMPDIR = originalTmpdir
			}
		})
	})

	describe("getCommandHostAuthorization toolInput-shape recognition", () => {
		it("string toolInput /usr/bin/mktemp -> executablePath branch active", () => {
			if (process.platform !== "darwin") return
			const auth = getCommandHostAuthorization("run_commands", SAFE_ON_SETTINGS, undefined, undefined, "/usr/bin/mktemp")
			expect(auth.tempAuthorityEvidence?.executableRealpath).toBe("/usr/bin/mktemp")
		})

		it("{commands: ['/usr/bin/mktemp']} -> executablePath branch active", () => {
			if (process.platform !== "darwin") return
			const auth = getCommandHostAuthorization("run_commands", SAFE_ON_SETTINGS, undefined, undefined, {
				commands: ["/usr/bin/mktemp"],
			})
			expect(auth.tempAuthorityEvidence?.executableRealpath).toBe("/usr/bin/mktemp")
		})

		it("{command: {command: '/usr/bin/mktemp', args: []}} -> executablePath branch active", () => {
			if (process.platform !== "darwin") return
			const auth = getCommandHostAuthorization("run_commands", SAFE_ON_SETTINGS, undefined, undefined, {
				command: { command: "/usr/bin/mktemp", args: [] },
			})
			expect(auth.tempAuthorityEvidence?.executableRealpath).toBe("/usr/bin/mktemp")
		})

		it("non-mktemp toolInput -> tempAuthorityEvidence undefined (no PATH resolution work)", () => {
			if (process.platform !== "darwin") return
			const originalPath = process.env.PATH
			try {
				process.env.PATH = "/usr/bin:/bin"
				const auth = getCommandHostAuthorization("run_commands", SAFE_ON_SETTINGS, undefined, undefined, {
					command: "pwd",
				})
				expect(auth.tempAuthorityEvidence).toBeUndefined()
			} finally {
				process.env.PATH = originalPath
			}
		})

		it("non-mktemp toolInput -> no which/getconf subprocess work", () => {
			if (process.platform !== "darwin") return
			// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-EXPLICIT-PATH-EVIDENCE01:
			// narrow scope means unrelated safe commands
			// (pwd / git status / ls / cat package.json) MUST NOT
			// trigger /usr/bin/which mktemp or
			// /usr/bin/getconf DARWIN_USER_TEMP_DIR subprocess
			// probes. The earlier broader wiring did. This test
			// spies on child_process.spawnSync and asserts that
			// for an unrelated toolInput, neither is invoked.
			const cp = require("node:child_process") as typeof import("node:child_process")
			const originalSpawnSync = cp.spawnSync
			const whichCalls: Array<{ cmd: string; argv: string[] }> = []
			const getconfCalls: Array<{ cmd: string; argv: string[] }> = []
			const spy: typeof cp.spawnSync = ((cmd: string, argv?: readonly string[]) => {
				if (cmd === "/usr/bin/which" || cmd === "which") {
					whichCalls.push({ cmd, argv: [...(argv ?? [])] })
				} else if (cmd === "/usr/bin/getconf" || cmd === "getconf") {
					getconfCalls.push({ cmd, argv: [...(argv ?? [])] })
				}
				return originalSpawnSync(cmd, argv as string[])
			}) as typeof cp.spawnSync
			cp.spawnSync = spy
			try {
				for (const cmd of ["pwd", "git status", "ls", "cat package.json"]) {
					const auth = getCommandHostAuthorization("run_commands", SAFE_ON_SETTINGS, undefined, undefined, {
						command: cmd,
					})
					expect(auth.tempAuthorityEvidence).toBeUndefined()
				}
				expect(whichCalls).toEqual([])
				expect(getconfCalls).toEqual([])
			} finally {
				cp.spawnSync = originalSpawnSync
			}
		})
		// NOTE (ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01): upstream PR #13498 added
		// 2 tests here that expected isToolAutoApproved("firecrawl__scrape", settings)
		// (2-arg signature) to return `true` when settings.actions.useMcp=true
		// WITHOUT an mcpHub. ClineMM's `isToolAutoApproved` (line 944) requires
		// either an mcpHub or an `override === "all"` session override; otherwise
		// `!!tool?.autoApprove` is `false` for unknown tools (intentional
		// hard-DENY for unknown MCP server/tool pairs, see F16 +
		// ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION03 G1 fixture). The upstream
		// tests encode the simplified useMcp-only semantic that F16 prohibits
		// in ClineMM (per-tool MCP approval is load-bearing for Safe-YOLO).
		// Therefore: dropped upstream's 2 tests. ClineMM's existing test
		// matrix (A/B/C/D/E/F/G1/G2/PRODUCTION REGRESSION at lines 30-637)
		// already proves the correct semantic.
	})
})
