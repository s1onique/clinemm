/**
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 - AMENDMENT-01
 *
 * FOCUSED PRODUCTION CLASSIFIER RED for the SURVIVING historical
 * remote-inspection classification defect and its two sibling defects.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 *
 * The PRODUCTION host classifier (`createHostExecutionProgressClassifier` and
 * `isInspectionCommandInput`, the real module under
 * `sdk/packages/core/src/extensions/tools/execution-progress-classifier.ts`)
 * still MISCLASSIFIES the historical remote reconnaissance as productive
 * execution.
 *
 * A1 - HISTORICAL SHELL REDIRECTION CONSERVATION
 *
 *   The nine reconnaissance commands of the frozen Session A transcript
 *   (transcript message indices 29-45) all carry the trailing
 *   `2>&1 | tail -N` shape. The classifier's segment splitter treats the
 *   `&` of the DESCRIPTOR DUPLICATION `2>&1` as a command separator, so it
 *   reads the duplication as an extra, unrecognised segment. The read-only
 *   reconnaissance is then reported as an execution.
 *
 *   Descriptor duplication (`2>&1`, `>&2`, `1>&2`) is NOT a command
 *   separator and NOT a file mutation: it redirects a descriptor onto
 *   another descriptor. An actual output redirection to a workspace file
 *   (`> file`) REMAINS a mutation.
 *
 * A2 - BOUNDED MUTATION CONSERVATION
 *
 *   The independently executed counterexamples - `git tag -a`, `git tag -d`,
 *   `mount`, `cd /tmp > file`, `export X=1 > file` - must NOT be positively
 *   classified as inspections.
 *
 * A3 - MISSING EXECUTION OUTCOME
 *
 *   An empty or absent execution observation must not establish positive
 *   execution progress.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * -----------------------------
 *
 * It does not prove that any of these commands changes the runtime's
 * behaviour, and it does not prove live recovery. It proves the CLASSIFIER's
 * verdict for the exact historical command strings.
 *
 * The command strings are CLASSIFICATION INPUTS ONLY. This file NEVER
 * executes them, locally or remotely.
 *
 * EVIDENCE CLASS
 * --------------
 *
 * SYNTHETIC_REAL_PRODUCTION_SEAM - the classifier is the real production
 * module; the command strings are CLASSIFICATION INPUTS ONLY and are NEVER
 * executed by this file.
 */
import type { ExecutionRoundProductivity } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createHostExecutionProgressClassifier,
	isInspectionCommandInput,
} from "./execution-progress-classifier";

/**
 * The verdict a `run_commands` call receives.
 *
 * `undefined` means the host DECLINED to classify and the runtime's own
 * structural reading governs.
 */
type Verdict = ExecutionRoundProductivity | undefined;

/**
 * The PRODUCTION completed observation: the `command_status` snapshot of a
 * job that exited successfully.
 *
 * The observation is a SUCCESSFUL execution observation, so the verdict is
 * governed by the command's SHAPE alone.
 */
const SUCCESSFUL_OBSERVATION = {
	output: [{ ok: true, exitCode: 0 }],
} as const;

/** Classify one `run_commands` call through the REAL production classifier. */
function classify(commands: string[]): Verdict {
	return createHostExecutionProgressClassifier()(
		"run_commands",
		{ commands },
		SUCCESSFUL_OBSERVATION,
	);
}

/**
 * The NINE historical reconnaissance commands of the frozen Session A
 * transcript, VERBATIM.
 *
 * These are the EXACT command strings the session dispatched at transcript
 * message indices 29, 31, 33, 35, 37, 39, 41, 43 and 45. They are
 * CLASSIFICATION INPUTS ONLY - this file never executes them, and the
 * witness never opens an SSH connection.
 */
const HISTORICAL_SESSION_A_RECON_COMMANDS: readonly string[] = [
	// transcript message index 29
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; ls $N/lib | grep -E "^(sha2|monotimes|httpclient|osproc|json|unittest|times|posix)\\.nimle?$"; grep -n "proc fsync" $N/lib/posix/posix_linux_amd64.nim | head -3; grep -rn "flock" $N/lib/posix/*.nim | head -5; grep -n "proc sha256" $N/lib/pure/sha2.nim | head -3; grep -n "proc getMonoTime" $N/lib/std/monotimes.nim | head -3\' 2>&1 | tail -30',
	// transcript message index 31
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; ls $N/lib $N/lib/pure $N/lib/std | grep -iE "sha|http|mono|proc|json|unit" ; echo ---; grep -rn "sha256" $N/lib/pure/*.nim | head -5; echo ---; grep -rn "proc fsync\\|proc open\\b" $N/lib/posix/posix_linux_amd64.nim | head\' 2>&1 | tail -40',
	// transcript message index 33
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; grep -rn "fsync\\|proc open\\*\\|O_CREAT" $N/lib/posix/*.nim | head -20; echo ---; grep -rn "proc readFile\\|proc writeFile" $N/lib/system/io.nim | head\' 2>&1 | tail -30',
	// transcript message index 35
	"SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.11 'N=~/nim/nim-2.2.4; grep -n \"streamOut\\|streamErr\\|proc startProcess\\|proc running\\|proc terminate\\|proc waitFor\\|proc close\\|type Process\\*\\|poStdErrToStdOut\\|proc execCmdEx\\|proc peekExitCode\" $N/lib/pure/osproc.nim | head -40' 2>&1 | tail -45",
	// transcript message index 37
	"SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 'N=~/nim/nim-2.2.4; F=$(find $N/lib -name osproc.nim); echo $F; grep -n \"streamOut\\|streamErr\\|proc startProcess\\|proc running\\|proc terminate\\|proc waitFor\\|proc close\\|type Process\\*\\|poStdErrToStdOut\\|proc execCmdEx\\|proc peekExitCode\\|proc kill\" $F | head -40' 2>&1 | tail -45",
	// transcript message index 39
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; sed -n "330,420p" $N/lib/pure/osproc.nim; echo =====; sed -n "955,1060p" $N/lib/pure/osproc.nim\' 2>&1 | tail -140',
	// transcript message index 41
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; sed -n "55,120p" $N/lib/pure/osproc.nim; echo =====; sed -n "780,830p" $N/lib/pure/osproc.nim\' 2>&1 | tail -120',
	// transcript message index 43
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; grep -n "^  proc \\(fcntl\\|poll\\|waitpid\\|kill\\|dup2\\|execv\\|execve\\|pipe\\|fork\\|read\\|write\\|close\\|open\\|fcntl\\)\\b" $N/lib/posix/posix.nim | head -40; echo ---; grep -n "O_NONBLOCK\\|F_SETFL\\|SIGKILL\\|WNOHANG" $N/lib/posix/posix_linux_amd64_consts.nim | head -10\' 2>&1 | tail -50',
	// transcript message index 45
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; grep -n "proc \\(waitpid\\|kill\\|dup2\\|execv\\|execve\\|pipe\\|fork\\|read\\|write\\|close\\|fcntl\\|open\\)\\*" $N/lib/posix/posix.nim | head -40; echo ---; grep -n "proc \\(waitpid\\|kill\\|dup2\\|execv\\|pipe\\|fork\\|read\\|write\\|close\\|fcntl\\)\\*" $N/lib/posix/posix_linux_amd64.nim | head -40\' 2>&1 | tail -60',
];

describe("ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 (AMENDMENT-01) / A1 historical shell redirection conservation", () => {
	it("classifies a DESCRIPTOR DUPLICATION suffix as an inspection, not an execution", () => {
		// The three shapes the ACT names explicitly.
		expect(classify(["grep foo bar 2>&1 | tail -10"])).toBe("inspected");
		expect(classify(["grep foo bar >&2"])).toBe("inspected");
		expect(
			classify([
				"SSH_AUTH_SOCK=... ssh -o BatchMode=yes host 'N=/tmp; grep foo bar' 2>&1 | tail -10",
			]),
		).toBe("inspected");
	});

	it("classifies the frozen historical reconnaissance commands as inspections", () => {
		// The actual historical command strings, NOT simplified substitutes.
		// Each one is a CLASSIFICATION INPUT ONLY.
		//
		// EIGHT of the NINE historical commands are recognised. The NINTH
		// (transcript message index 37) carries a COMMAND SUBSTITUTION
		// (`F=$(find $N/lib -name osproc.nim)`), which is outside the
		// established static recognition contract: its semantics are not
		// knowable from the text alone, so it keeps the conservative
		// UNKNOWN disposition. It is asserted separately below.
		for (const command of HISTORICAL_SESSION_A_RECON_COMMANDS) {
			if (command.includes("$(find")) {
				// The command-substitution form: asserted separately.
				continue;
			}
			expect(
				{ command, verdict: classify([command]) },
				`command: ${command}`,
			).toEqual({ command, verdict: "inspected" });
		}
	});

	it("keeps the COMMAND SUBSTITUTION historical command as UNKNOWN", () => {
		// The one historical command whose payload is dynamically
		// constructed. The classifier must not claim a semantic reading it
		// cannot justify.
		const substitutionCommand = HISTORICAL_SESSION_A_RECON_COMMANDS.find(
			(command) => command.includes("$(find"),
		);
		expect(substitutionCommand).toBeDefined();
		expect(classify([substitutionCommand as string])).not.toBe("inspected");
	});

	it("conserves an ACTUAL output redirection to a workspace file as a mutation", () => {
		// Descriptor duplication is not a file mutation, but an output
		// redirection to a real file IS one. The repair must not globally
		// strip redirections.
		expect(classify(["git status > file"])).toBe("executed");
		expect(classify(["git status > /workspace/output.txt"])).toBe("executed");
		expect(classify(["grep foo bar > out.txt"])).toBe("executed");
		expect(classify(["grep foo bar >> out.txt"])).toBe("executed");
	});

	it("conserves ACTUAL background execution", () => {
		// `&` is a REAL background separator, and it is NOT a descriptor
		// duplication. It must keep splitting the command, so the work
		// that follows it is classified on its own.
		expect(classify(["grep foo bar & make build"])).toBe("executed");
		expect(classify(["make build & grep foo bar"])).toBe("executed");
		expect(classify(["grep foo bar & bun run build"])).toBe("executed");
		// A backgrounded read-only command is still a read: the `&` does
		// not make the read into work.
		expect(classify(["grep foo bar &"])).toBe("inspected");
		// The `&` must not be swallowed into the preceding token: a
		// backgrounded MUTATION is still a mutation.
		expect(classify(["git tag new-tag &"])).not.toBe("inspected");
	});

	it("conserves the ACTUAL &&, ||, ; and pipeline boundaries", () => {
		expect(classify(["grep foo bar && make build"])).toBe("executed");
		expect(classify(["make build || grep foo bar"])).toBe("executed");
		expect(classify(["grep foo bar; make build"])).toBe("executed");
		// A pure pipeline of inspections stays an inspection.
		expect(classify(["grep foo bar | tail -10"])).toBe("inspected");
		expect(classify(["grep foo bar | head -3 | wc -l"])).toBe("inspected");
	});

	it("conserves QUOTED and ESCAPED separators", () => {
		// A separator inside quotes is data, not a separator.
		expect(classify(["grep -n 'type: \"done\"\\|type: 'done'' bar"])).toBe(
			"inspected",
		);
		// An escaped separator is data too.
		expect(classify(["grep foo \\; bar"])).toBe("inspected");
	});

	it("conserves REMOTE build, installation and mutation classification", () => {
		expect(classify(["ssh host 'make build'"])).toBe("executed");
		expect(classify(["ssh host 'pytest -q'"])).toBe("executed");
		expect(classify(["ssh host 'curl -sI https://example.com'"])).toBe(
			"executed",
		);
		expect(classify(["ssh host 'mkdir -p /tmp/x'"])).toBe("executed");
		// The SAME remote shapes with the historical redirection suffix.
		expect(classify(["ssh host 'make build' 2>&1 | tail -40"])).toBe(
			"executed",
		);
		expect(classify(["ssh host 'mkdir -p /tmp/x' 2>&1 | tail -40"])).toBe(
			"executed",
		);
	});

	it("keeps a COMMAND SUBSTITUTION as UNKNOWN", () => {
		// The command substitution is outside the established static
		// recognition contract: it stays an honest uncertainty, which the
		// caller reports conservatively.
		expect(
			isInspectionCommandInput({
				commands: [
					"ssh host 'F=$(find $N/lib -name osproc.nim); grep -n foo $F'",
				],
			}),
		).toBe(false);
	});
});

describe("ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 (AMENDMENT-01) / A2 bounded mutation conservation", () => {
	it("does NOT classify the independently executed mutation counterexamples as inspections", () => {
		// Each of these MUTATES something. None of them may be positively
		// classified as an inspection.
		for (const command of [
			"git tag -a new-tag -m msg",
			"git tag -d new-tag",
			"mount /dev/sda /mnt",
			"cd /tmp > file",
			"export X=1 > file",
		]) {
			expect(
				{ command, verdict: classify([command]) },
				`command: ${command}`,
			).not.toEqual({ command, verdict: "inspected" });
		}
	});

	it("conserves ordinary `git tag` LISTING and ordinary environment setup", () => {
		expect(classify(["git tag"])).toBe("inspected");
		expect(classify(["git tag -l"])).toBe("inspected");
		expect(classify(["git tag --list"])).toBe("inspected");
		expect(classify(["export X=1"])).toBe("inspected");
		expect(classify(["export X=1; ls"])).toBe("inspected");
		expect(classify(["cd /tmp"])).toBe("inspected");
		expect(classify(["cd /tmp; ls"])).toBe("inspected");
	});
});

describe("ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 (AMENDMENT-01) / A3 missing execution outcome", () => {
	it("does NOT establish positive execution progress from an EMPTY or ABSENT observation", () => {
		const classifyProduction = createHostExecutionProgressClassifier();
		for (const output of [null, [], {}]) {
			expect(
				classifyProduction(
					"run_commands",
					{ commands: ["bun run build"] },
					{ output },
				),
				`output: ${JSON.stringify(output)}`,
			).not.toBe("executed");
		}
	});

	it("conserves a LEGITIMATE background wait and an EXPLICIT negative observation", () => {
		const classifyProduction = createHostExecutionProgressClassifier();
		// A still-running observation is a legitimate wait: the host
		// declines so the runtime's own reading governs.
		expect(
			classifyProduction(
				"run_commands",
				{ commands: ["bun run build"] },
				{
					output: JSON.stringify({
						status: "running",
						jobId: "cmd_job_0001",
						elapsedMs: 15000,
					}),
				},
			),
		).toBeUndefined();
		// An explicit negative observation is preserved.
		expect(
			classifyProduction(
				"run_commands",
				{ commands: ["bun run build"] },
				{ output: [{ ok: true, exitCode: 1 }] },
			),
		).toBe("failed");
		expect(
			classifyProduction(
				"run_commands",
				{ commands: ["bun run build"] },
				{ output: "command failed", isError: true },
			),
		).toBe("failed");
	});
});
