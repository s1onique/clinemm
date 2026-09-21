/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 / correction01 PRE-REPAIR RED
 *
 * Pre-repair RED witness captured at parent commit ddcf1ad4...
 *
 * Probe design (correction02):
 *
 *   Run ABSENCE-WITNESSES against the actual parent commit by reading
 *   the file content via `git show <parent>:<path>`. The previous
 *   correction01 attempt used the WRONG path
 *   (`apps/vscode/src/vscode-run-commands-tool.ts` instead of the
 *   real `apps/vscode/src/sdk/vscode-run-commands-tool.ts`) and
 *   recorded 2/3 PASS + 1 INVALID. This corrected probe reads
 *   directly through git, which cannot ENOENT.
 *
 *   Expected at ddcf1ad4 (the contract-freeze + correction-03 residue
 *   cleanup commit):
 *     - `notifyOnCompletion` field absent from schemas.ts
 *     - `notifyOnCompletion` field absent from vscode-run-commands-tool.ts
 *     - background-notify-coordinator.ts does not exist
 *
 *   So all three assertions are ABSENCE-WITNESSES at ddcf1ad4.
 *
 *   Run only once: `bun run test:vitest <this-file>`. Then delete the
 *   probe file. The captured output lives in
 *   `.factory/evidence/.../19-pre-repair-red-output.txt`.
 */

import { execSync } from "node:child_process"
import { describe, expect, it } from "vitest"

const PARENT = "ddcf1ad4f076afbebbaf1686b73a3cb040ad0b4b"

function readAtParent(path: string): string {
	return execSync(`git show ${PARENT}:${path}`, { encoding: "utf-8" })
}

function existsAtParent(path: string): boolean {
	try {
		execSync(`git cat-file -e ${PARENT}:${path}`, { encoding: "utf-8", stdio: "ignore" })
		return true
	} catch {
		return false
	}
}

describe(`PRE-REPAIR RED witness (parent ${PARENT.slice(0, 12)}...)`, () => {
	it("notifyOnCompletion is absent from sdk/packages/core/src/extensions/tools/schemas.ts at parent commit", () => {
		const schemas = readAtParent("sdk/packages/core/src/extensions/tools/schemas.ts")
		expect(schemas).not.toContain("notifyOnCompletion")
	})

	it("notifyOnCompletion is absent from apps/vscode/src/sdk/vscode-run-commands-tool.ts at parent commit", () => {
		const tool = readAtParent("apps/vscode/src/sdk/vscode-run-commands-tool.ts")
		expect(tool).not.toContain("notifyOnCompletion")
	})

	it("BackgroundNotifyCoordinator module is absent at parent commit", () => {
		expect(existsAtParent("apps/vscode/src/sdk/background-notify-coordinator.ts")).toBe(false)
	})
})
