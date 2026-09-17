/**
 * ACT-CLINEMM-MACOS-COMMAND-SANDBOX-SEATBELT-RECON01 capability-model-probe
 *
 * Goal: prototype a CommandCapability -> Seatbelt profile generator
 * to prove the architectural direction in Q9.
 *
 * The shape here is intentionally minimal -- a *probe*, not a backend.
 * Production work would live in a future ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01.
 *
 * Run with: bun capability-model-probe.ts
 */

type CommandCapability = {
	readonly readonlyRoots: string[]
	readonly writableRoots: string[]
	readonly network: "deny" | "allow-localhost" | "allow"
	readonly excludedRoots: string[]
	readonly tempRoot?: string
}

const DEFAULT_EXCLUDED_ROOTS = (home: string) => [
	`${home}/.ssh`,
	`${home}/.aws`,
	`${home}/.gnupg`,
]

function generateProfile(cap: CommandCapability, home: string): string {
	const excluded = [...DEFAULT_EXCLUDED_ROOTS(home), ...cap.excludedRoots]

	// network-outbound rules
	let netRules = "(deny network*)"
	if (cap.network === "allow-localhost") {
		netRules =
			"(deny network*)\n(allow network-outbound (remote ip \"localhost:*\"))\n(allow network-inbound (local ip \"localhost:*\"))"
	} else if (cap.network === "allow") {
		netRules = "(allow network*)"
	}

	// file-read*: allow all except excluded roots
	const readRule = `(allow file-read*
  (require-all
${excluded.map((e) => `    (require-not (subpath "${e}"))`).join("\n")}))`

	// file-write*: only writableRoots + dev paths
	const writeSubpaths = [
		...cap.writableRoots,
		"/dev/null",
		"/dev/tty",
		"/tmp",
		"/private/tmp",
		"/private/var/folders",
	]
	if (cap.tempRoot) writeSubpaths.push(cap.tempRoot)
	const writeRule = `(allow file-write*
${writeSubpaths.map((w) => `  (subpath "${w}")`).join("\n")})`

	// file-read-metadata: always needed for path resolution
	const metaRule = `(allow file-read-metadata (subpath "/"))`

	// process-exec: needed for any non-embedded program
	const procRule = `(allow process-exec)
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup)`

	const lines: string[] = [
		"(version 1)",
		"(deny default)",
		procRule,
		readRule,
		writeRule,
		netRules,
		metaRule,
	]
	return lines.filter(Boolean).join("\n") + "\n"
}

// Demo: a typical "git status" capability
const gitStatusCap: CommandCapability = {
	readonlyRoots: [],
	writableRoots: [],
	network: "deny",
	excludedRoots: [],
}

const HOME = "/Users/example"
const profile = generateProfile(gitStatusCap, HOME)
console.log("--- GENERATED PROFILE FOR git status ---")
console.log(profile)
console.log("--- end ---")

// Demo: a "rm -rf" capability
const rmCap: CommandCapability = {
	readonlyRoots: [],
	writableRoots: ["/Users/example/workspace"],
	network: "deny",
	excludedRoots: ["/Users/example/workspace/protected"],
	tempRoot: "/private/tmp/clinemm-rm-12345",
}
console.log("--- GENERATED PROFILE FOR rm -rf in workspace ---")
console.log(generateProfile(rmCap, HOME))
