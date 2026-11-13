/**
 * ACT-CLINEMM-FLINT-TOOLCALL-RED-01-CORRECTION01 — LIVE WITNESS FIXTURES
 *
 * The live `run_commands` payloads of the Flint session
 * `1794593797996_r48lj.messages.json`, captured **byte for byte** from the
 * transcript's `tool_use.input` blocks.
 *
 * These constants live in a dedicated module (not inside a `.test.ts` file)
 * so that BOTH the regression suite
 * (`flint-toolcall-red01-correction01.test.ts`) and the independent witness
 * verifier (`flint-toolcall-red01-witness.test.ts`) consume the SAME
 * single source of truth. Importing a `.test.ts` file from another test
 * file would re-register its `describe`/`it` blocks in the importing
 * suite, which corrupts both suites' accounting.
 *
 * ## Why this module exists (the witness-mismatch defect)
 *
 * The first CORRECTION01 revision claimed the seven live-rejected calls
 * were replayed "VERBATIM", but the fixtures had been RE-TRANSCRIBED by
 * hand rather than copied from the transcript, and two of them had drifted:
 *
 *  - the `find` fixture lost four `-not -path` clauses
 *    (the `pg-index-diff`, `act-fm233-build-roz-p5-discriminator01`,
 *    `.helm`, `.kube` and `.vscode` path filters) and its
 *    `| sort | head -300` tail, and
 *  - the accepted JSON-array fixture lost its `| head -150` tail.
 *
 * The drifted fixtures still exercised the same *shape*, so every
 * behavioural test stayed GREEN — the defect was invisible to the
 * behavioural suite and only a byte-level comparison against the live
 * transcript exposed it. The witness verifier
 * (`flint-toolcall-red01-witness.test.ts`) now performs exactly that
 * comparison and fails loudly on any future drift.
 */

export const KEYCLOAK_ROOT =
	"/Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak";

/**
 * The five `{"commands": "<shell text>"}` calls rejected in the live
 * session, in transcript order (message indices 5, 8, 11, 14, 18).
 *
 * Copied byte for byte from the transcript's `tool_use.input`.
 */
export const LIVE_REJECTED_COMMANDS_KEYED: ReadonlyArray<
	Record<string, unknown>
> = [
	{ commands: `ls -la ${KEYCLOAK_ROOT}` },
	{ commands: `ls -la ${KEYCLOAK_ROOT}` },
	{ commands: `ls -la ${KEYCLOAK_ROOT}` },
	{ commands: `ls -la ${KEYCLOAK_ROOT}` },
	{
		commands: `find ${KEYCLOAK_ROOT} -maxdepth 2 -not -path '*/.git/*' -not -path '*/.pnpm-store*' -not -path '*/logs*' -not -path '*/profiles*' -not -path '*/pg-index-diff*' -not -path '*/.act-fm233-build-roz-p5-discriminator01*' -not -path '*/.helm' -not -path '*/.kube' -not -path '*/.vscode' -not -path '*/.act-fm233-build-roz-p5-discriminator01' | sort | head -300`,
	},
];

/**
 * The two `{"command": "<shell text>"}` calls rejected in the live session
 * (message indices 2 and 21), in transcript order.
 *
 * Copied byte for byte from the transcript's `tool_use.input`.
 */
export const LIVE_REJECTED_COMMAND_KEYED: ReadonlyArray<
	Record<string, unknown>
> = [
	{ command: `ls -la ${KEYCLOAK_ROOT}` },
	{ command: `git -C ${KEYCLOAK_ROOT} log --oneline -50` },
];

/**
 * The single ACCEPTED `{"command":"[\"...\"]"}` call of the live session
 * (message index 35). It MUST keep working — this is the previously
 * repaired shape.
 *
 * Copied byte for byte from the transcript's `tool_use.input`.
 */
export const LIVE_ACCEPTED_COMMAND_JSON_ARRAY = {
	command: `["wc -l ${KEYCLOAK_ROOT}/.gitlab-ci.yml", "grep -n '^\\\\- \\\\|^\\\\s*- name:\\\\|^stages:\\\\|^\\\\.\\\\|^jobs:\\\\|^\\\\s*[a-zA-Z_.-]*:' ${KEYCLOAK_ROOT}/.gitlab-ci.yml | head -150"]`,
} as const;
