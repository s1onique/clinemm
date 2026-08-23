#!/usr/bin/env node
/**
 * Mirror the SDK's vendored parser-helper binaries into apps/vscode/bin/.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
 * Phase 3.
 *
 * The SDK package ships its binaries under
 * `<sdk-root>/bin/parser-helper/<platform>/`. When the SDK is
 * bundled into the VSCode extension.js, the runtime needs to
 * locate the binary in a stable, well-known location inside the
 * extension's installed tree. This script mirrors the binaries
 * into `apps/vscode/bin/parser-helper/`, which the VSIX includes
 * (no .vscodeignore exclusion).
 *
 * The SDK's runtime locator prefers the consumer-side mirror when
 * present (via the VSCode host adapter's helper locator), and
 * falls back to the SDK package root otherwise.
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const VSCODE_APP_ROOT = path.resolve(path.dirname(__filename), "..")
const SDK_ROOT = path.resolve(VSCODE_APP_ROOT, "..", "..", "sdk", "packages", "core")

const result = spawnSync("bun", ["run", "scripts/copy-parser-helper-to-apps.mjs", VSCODE_APP_ROOT], {
	cwd: SDK_ROOT,
	stdio: "inherit",
})

if (result.status !== 0) {
	console.error("error: failed to mirror parser-helper binaries from SDK")
	process.exit(result.status ?? 1)
}
