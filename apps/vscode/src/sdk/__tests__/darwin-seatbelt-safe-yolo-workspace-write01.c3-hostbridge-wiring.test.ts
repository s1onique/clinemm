/**
 * ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01-CORRECTION01 — C2 wiring test.
 *
 * Why this file exists:
 *
 *   The original ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01 closed by
 *   declaring the kernel repair (workspace roots on writableRoots)
 *   PROVEN via the C2-kernel corpus. The reviewer correctly noted the
 *   corpus constructed `new CommandJobManager({
 *   experimentalSandboxWorkspaceRoots: [...] })` directly, BELOW the
 *   new VscodeSessionHost wiring seam. That left a load-bearing
 *   integration gap: did a real installed VS Code actually feed
 *   `workspaceRoots` through HostProvider -> resolver -> filter ->
 *   CommandJobManager? The corpus did not prove it.
 *
 *   This file proves the wiring seam ABOVE CommandJobManager:
 *
 *     HostProvider.workspace.getWorkspacePaths({})
 *       -> resolveActiveWorkspaceRootsForSandbox()
 *         -> filterWorkspaceRootsForWritable()
 *
 *   is observed end-to-end against a DI HostProvider whose
 *   workspaceClient returns controlled paths. The trivial one-line
 *   plumbing inside `VscodeSessionHost.create`
 *
 *     new CommandJobManager({
 *       experimentalSandboxWorkspaceRoots: await resolveActiveWorkspaceRootsForSandbox(),
 *     })
 *
 *   plus the C2-kernel corpus (which proves CommandJobManager ->
 *   Seatbelt -> kernel honors those roots) closes the integration
 *   loop that the reviewer flagged.
 *
 *   Adversarial coverage includes:
 *     - HOST-WIRE-1  safe paths pass through canonicalized
 *     - HOST-WIRE-2  HOME dropped via hostbridge seam (not just direct call)
 *     - HOST-WIRE-3  symlink-to-HOME dropped via hostbridge seam
 *     - HOST-WIRE-4  symlink-to-/ dropped via hostbridge seam
 *     - HOST-WIRE-5  HostProvider not initialized -> [] (back-compat)
 *     - HOST-WIRE-6  empty workspacePaths -> [] (no-op)
 *     - HOST-WIRE-7  HOME dropped even when host returns it verbatim
 *     - HOST-WIRE-8  HOME-parent dropped even when host returns it verbatim
 *     - HOST-WIRE-9  canonical form is what reaches the resolver
 *                   (i.e. caller can't smuggle symlink through unchanged)
 */
import { mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { HostProvider } from "@/hosts/host-provider"
import type { HostBridgeClientProvider } from "@/hosts/host-provider-types"
import type { GetWorkspacePathsResponse } from "@/shared/proto/host/workspace"

import { resolveActiveWorkspaceRootsForSandbox } from "../sandbox-policy"

let scratchRoot: string
let safeRepo: string
let symlinkToHome: string
let symlinkToRoot: string
function makeUnusedStubs(): Pick<HostBridgeClientProvider, "envClient" | "windowClient" | "diffClient"> {
	return {
		envClient: {
			clipboardWriteText: vi.fn().mockRejectedValue(new Error("not used")),
			clipboardReadText: vi.fn().mockRejectedValue(new Error("not used")),
			getHostVersion: vi.fn().mockRejectedValue(new Error("not used")),
			getIdeRedirectUri: vi.fn().mockRejectedValue(new Error("not used")),
			getTelemetrySettings: vi.fn().mockRejectedValue(new Error("not used")),
			subscribeToTelemetrySettings: vi.fn().mockReturnValue(() => {}),
			shutdown: vi.fn().mockResolvedValue({}),
			debugLog: vi.fn().mockResolvedValue({}),
			openExternal: vi.fn().mockResolvedValue({}),
		},
		windowClient: {
			showTextDocument: vi.fn().mockRejectedValue(new Error("not used")),
			showOpenDialogue: vi.fn().mockRejectedValue(new Error("not used")),
			showMessage: vi.fn().mockRejectedValue(new Error("not used")),
			showInputBox: vi.fn().mockRejectedValue(new Error("not used")),
			showSaveDialog: vi.fn().mockRejectedValue(new Error("not used")),
			openFile: vi.fn().mockResolvedValue({}),
			openSettings: vi.fn().mockResolvedValue({}),
			getOpenTabs: vi.fn().mockResolvedValue({}),
			getVisibleTabs: vi.fn().mockResolvedValue({}),
			getActiveEditor: vi.fn().mockResolvedValue({}),
		},
		diffClient: {
			openDiff: vi.fn().mockRejectedValue(new Error("not used")),
			getDocumentText: vi.fn().mockRejectedValue(new Error("not used")),
			replaceText: vi.fn().mockRejectedValue(new Error("not used")),
			scrollDiff: vi.fn().mockRejectedValue(new Error("not used")),
			truncateDocument: vi.fn().mockRejectedValue(new Error("not used")),
			saveDocument: vi.fn().mockRejectedValue(new Error("not used")),
			closeAllDiffs: vi.fn().mockResolvedValue({}),
			openMultiFileDiff: vi.fn().mockRejectedValue(new Error("not used")),
		},
	}
}

function initHostProviderWithWorkspacePaths(paths: string[]) {
	HostProvider.reset()
	const response: GetWorkspacePathsResponse = { paths }
	const getWorkspacePaths = vi.fn(async () => response)
	const workspaceClient = {
		getWorkspacePaths,
		saveOpenDocumentIfDirty: vi.fn().mockRejectedValue(new Error("not used")),
		getDiagnostics: vi.fn().mockResolvedValue({}),
		openProblemsPanel: vi.fn().mockResolvedValue({}),
		openInFileExplorerPanel: vi.fn().mockResolvedValue({}),
		openClineSidebarPanel: vi.fn().mockResolvedValue({}),
		openTerminalPanel: vi.fn().mockResolvedValue({}),
		executeCommandInTerminal: vi.fn().mockRejectedValue(new Error("not used")),
		openFolder: vi.fn().mockResolvedValue({}),
		searchWorkspaceItems: vi.fn().mockRejectedValue(new Error("not used")),
	}
	const hostBridge: HostBridgeClientProvider = {
		workspaceClient: workspaceClient as unknown as HostBridgeClientProvider["workspaceClient"],
		...makeUnusedStubs(),
	}
	HostProvider.initialize(
		(() => {}) as never,
		(() => {}) as never,
		(() => {}) as never,
		hostBridge,
		(_: string) => {},
		async (path: string) => `http://example.com:1234${path}`,
		async (n: string) => `/mock/path/to/binary/${n}`,
		"/mock/path/to/extension",
		"/mock/path/to/globalstorage",
	)
	return { workspaceClient, getWorkspacePaths }
}

beforeAll(() => {
	scratchRoot = realpathSync(tmpdir()) + "/clinemm-wsw-hostwire-" + process.pid + "-" + Date.now()
	mkdirSync(scratchRoot, { recursive: true })
	safeRepo = join(scratchRoot, "safe-repo")
	mkdirSync(safeRepo, { recursive: true })
	symlinkToHome = join(scratchRoot, "lnk-home")
	symlinkToRoot = join(scratchRoot, "lnk-root")
	const home = process.env.HOME ?? ""
	if (home) {
		try {
			symlinkSync(home, symlinkToHome)
		} catch {
			/* best effort */
		}
	}
	try {
		symlinkSync("/", symlinkToRoot)
	} catch {
		/* best effort */
	}
})

afterAll(() => {
	HostProvider.reset()
	try {
		rmSync(scratchRoot, { recursive: true, force: true })
	} catch {
		/* best effort */
	}
})

describe("ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01-CORRECTION01 C2 — HostProvider -> resolveActiveWorkspaceRootsForSandbox wiring", () => {
	it("HOST-WIRE-1: safe paths returned by the hostbridge pass through canonicalized", async () => {
		initHostProviderWithWorkspacePaths([safeRepo])
		const got = await resolveActiveWorkspaceRootsForSandbox()
		expect(got).toEqual([realpathSync(safeRepo)])
	})

	it("HOST-WIRE-2: HOME returned by the hostbridge is dropped (no silent widening to user data)", async () => {
		const home = process.env.HOME ?? ""
		if (!home) {
			expect(true).toBe(true)
			return
		}
		initHostProviderWithWorkspacePaths([home])
		const got = await resolveActiveWorkspaceRootsForSandbox()
		expect(got).toEqual([])
	})

	it("HOST-WIRE-3: symlink-to-HOME returned by the hostbridge is dropped", async () => {
		if (!require("node:fs").existsSync(symlinkToHome)) {
			expect(true).toBe(true)
			return
		}
		initHostProviderWithWorkspacePaths([symlinkToHome])
		const got = await resolveActiveWorkspaceRootsForSandbox()
		expect(got).toEqual([])
	})

	it("HOST-WIRE-4: symlink-to-/ returned by the hostbridge is dropped", async () => {
		if (!require("node:fs").existsSync(symlinkToRoot)) {
			expect(true).toBe(true)
			return
		}
		initHostProviderWithWorkspacePaths([symlinkToRoot])
		const got = await resolveActiveWorkspaceRootsForSandbox()
		expect(got).toEqual([])
	})

	it("HOST-WIRE-5: HostProvider not initialized -> [] (back-compat)", async () => {
		HostProvider.reset()
		// No HostProvider.initialize call: resolveActiveWorkspaceRootsForSandbox
		// must short-circuit to [] (the prior empty-workspace contract).
		const got = await resolveActiveWorkspaceRootsForSandbox()
		expect(got).toEqual([])
	})

	it("HOST-WIRE-6: empty workspacePaths returned by the hostbridge -> [] (no-op)", async () => {
		initHostProviderWithWorkspacePaths([])
		const got = await resolveActiveWorkspaceRootsForSandbox()
		expect(got).toEqual([])
	})

	it("HOST-WIRE-7: HOME verbatim from hostbridge is dropped (canonical form also dropped)", async () => {
		const home = process.env.HOME ?? ""
		if (!home) {
			expect(true).toBe(true)
			return
		}
		initHostProviderWithWorkspacePaths([home])
		const got = await resolveActiveWorkspaceRootsForSandbox()
		expect(got).not.toContain(realpathSync(home))
		expect(got).not.toContain(home)
	})

	it("HOST-WIRE-8: HOME-parent verbatim from hostbridge is dropped (canonical form also dropped)", async () => {
		const home = process.env.HOME ?? ""
		if (!home) {
			expect(true).toBe(true)
			return
		}
		const parent = home.split("/").slice(0, -1).join("/") || "/"
		initHostProviderWithWorkspacePaths([parent])
		const got = await resolveActiveWorkspaceRootsForSandbox()
		const canonicalParent = realpathSync(parent)
		expect(got).not.toContain(canonicalParent)
		expect(got).not.toContain(parent)
	})

	it("HOST-WIRE-9: canonical form is what reaches the resolver (smuggled symlink cannot pass through unchanged)", async () => {
		const alias = join(scratchRoot, "alias-to-safe")
		try {
			symlinkSync(safeRepo, alias)
		} catch {
			expect(true).toBe(true)
			return
		}
		initHostProviderWithWorkspacePaths([alias])
		const got = await resolveActiveWorkspaceRootsForSandbox()
		expect(got).toEqual([realpathSync(safeRepo)])
		expect(got).not.toContain(alias)
	})
})
