#!/usr/bin/env node
/**
 * Copy the SDK's vendored parser-helper binaries into the consumer
 * app's bin/ directory.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
 * Phase 3.
 *
 * The SDK package ships its binaries under
 * `<sdk-root>/bin/parser-helper/<platform>/`. When the SDK is
 * bundled into a host extension (e.g. VSCode), the binary path
 * no longer points to a stable location. To keep the runtime
 * locator simple, this script mirrors the binaries into each
 * consumer app's `bin/parser-helper/` directory at build time.
 *
 * Usage:
 *   bun run copy-parser-helper-to-apps.mjs <consumer-app-dir> [<consumer-app-dir> ...]
 *
 * Example:
 *   bun run copy-parser-helper-to-apps.mjs ../../apps/vscode
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const SDK_ROOT = path.resolve(path.dirname(__filename), "..");
const SOURCE = path.join(SDK_ROOT, "bin", "parser-helper");

if (!fs.existsSync(SOURCE)) {
	console.error(`error: source not found: ${SOURCE}`);
	console.error("Run `cross-compile.sh` from the parser-helper-src dir first.");
	process.exit(1);
}

const consumers = process.argv.slice(2);
if (consumers.length === 0) {
	console.error("usage: copy-parser-helper-to-apps.mjs <consumer-app-dir> [...]");
	process.exit(1);
}

let copied = 0;
for (const consumer of consumers) {
	const target = path.resolve(SDK_ROOT, consumer, "bin", "parser-helper");
	fs.rmSync(target, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.cpSync(SOURCE, target, { recursive: true });
	const platforms = fs.readdirSync(target).filter((p) =>
		fs.statSync(path.join(target, p)).isDirectory(),
	);
	console.log(`  ${consumer}: copied ${platforms.length} platform binaries`);
	copied += platforms.length;
}

console.log(`copied ${copied} binaries to ${consumers.length} consumer app(s).`);
