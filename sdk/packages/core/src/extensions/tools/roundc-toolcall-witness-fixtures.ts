/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — ROUND C LIVE WITNESS FIXTURES.
 *
 * ## Provenance
 *
 * These constants are the Round C `run_commands` payloads that the live
 * session `1794702518894_gui73.messages.json` (installed extension version
 * `4.1.16-5a1c485cb`, model `qwen3.8-flash-next-iq3_s`, provider
 * `openai-compatible`) had REJECTED by the pre-approval schema validator.
 *
 * They are transcribed from that transcript's `tool_use.input` blocks. The
 * session dump itself is NEVER committed to this repository (it contains an
 * adversarial audit transcript, absolute paths from the operator's machine,
 * and repository contents), so the shapes are reproduced here as
 * STRUCTURAL fixtures with the operator's paths replaced by an
 * inert placeholder.
 *
 * The replacement is deliberate and safe: it preserves the shape that the
 * normalizer has to handle — the length of the inner quoting, the number
 * of array members, and the `["...", "..."]` envelope — while removing
 * every path that names a real repository on the operator's machine.
 *
 * ## The two confirmed defect shapes
 *
 * | Shape | Count | Live rejection message |
 * |-------|------:|------------------------|
 * | `commands` is a STRING holding a JSON-array-shaped literal | 4 | `expected array, received string` |
 * | `commands` is a LIST of `{command: "..."}` objects    | 4 | `expected string, received object` |
 *
 * ## Why the first shape is not plain JSON
 *
 * The four string-valued payloads look like JSON arrays, but they are NOT
 * valid JSON: their members contain SHELL single-quotes (`'...'`), which
 * are not JSON escapes. `JSON.parse` rejects every one of them with
 * `Invalid \escape`. The literal is therefore a JSON-array-SHAPED string
 * whose members are shell command text — the model serialized a command
 * LIST into a string, using shell quoting for the inner members.
 *
 * This is the reason the FLINT-TOOLCALL-RED-01 canonicalizer (which
 * decodes `{"command": "<JSON array string>"}`) could not help: it decodes
 * JSON, and these payloads are not JSON.
 *
 * These constants live in a dedicated module (not inside a `.test.ts`
 * file) so that BOTH the regression suite and any independent witness
 * verifier consume the SAME single source of truth. Importing a
 * `.test.ts` file from another test file would re-register its
 * `describe`/`it` blocks in the importing suite.
 */

/**
 * The inert placeholder that stands in for the operator's repository
 * root. It is a path that does not exist and is never accessed: these
 * fixtures are parsed, never executed.
 */
export const ROUND_C_REPO_PLACEHOLDER = "/r3po";

/**
 * The four Round C `run_commands` calls whose `commands` value was a
 * STRING holding a JSON-array-shaped literal, in transcript order.
 *
 * Live message indices: 21, 27, 27, 285.
 * Live tool-call ids:   call_8c27bbc73c2b486d935b9418,
 *                        call_92fa76e104f74badbd913259,
 *                        call_bdb7de2cf9f34b0792e6f7ec,
 *                        call_2f93b49827894a51aad131af.
 *
 * Each of these carries ONE member in the live transcript except the last,
 * which carries FOUR.
 */
export const ROUND_C_REJECTED_STRING_COMMANDS: ReadonlyArray<
	Record<string, unknown>
> = [
	{
		commands: `["cd /tmp/kcx_r1/keycloakx && echo '=== securityContext defaults ===' && grep -n -B3 -A12 'securityContext' values.yaml | head -60 && echo '=== networkPolicy/pdb values ===' && grep -n -A12 'networkPolicy:\\|podDisruptionBudget:' values.yaml && echo '=== command/args ===' && grep -n -B2 -A12 '^command:\\|^args:' values.yaml"]`,
	},
	{
		commands: `["cd ${ROUND_C_REPO_PLACEHOLDER} && echo '=== hook annotations ===' && grep -rn 'helm.sh/hook' .helm/ | head -30 && echo '=== rollback in CI ===' && grep -n 'rollback\\|--atomic\\|--wait\\|--timeout' .gitlab-ci.yml | head -30 && echo '=== phone-providers tree ===' && find phone-providers -name '*.java' | head -60"]`,
	},
	{
		commands: `["cd ${ROUND_C_REPO_PLACEHOLDER} && echo '=== liquibase/changelog refs ===' && grep -rn 'MARK_RAN\\|liquibase\\|changelog' --include=\\'*.xml\\' --include=\\'*.yaml\\' --include=\\'*.yml\\' --include=\\'*.md\\' --include=\\'*.sql\\' . 2>/dev/null | grep -v '^./profiles/' | head -40 && echo '=== bootstrap admin ===' && grep -rn -i 'bootstrap' .helm/ | head -30"]`,
	},
	{
		commands: `["cd ${ROUND_C_REPO_PLACEHOLDER}; echo '=== deploy_tpl 221-273 (secret-ish masked) ==='; sed -n '221,273p' .gitlab-ci.yml | sed -E 's/(--[a-z-]+[[:space:]]+[A-Za-z_.-]*(SECRET|PASSWORD|TOKEN|KEY|CRED)[A-Za-z_.-]*)=[^ ]+/\\1=<masked>/g' | cat -n | sed 's/^/  /'", "cd ${ROUND_C_REPO_PLACEHOLDER}; helm template roz .helm/roz -f .helm/roz/values.yaml -f .helm/roz/values-prod.yaml --set global.env=prod > /tmp/r_plain.yaml 2>/tmp/r_plain.err; echo RC=$?; head -2 /tmp/r_plain.err; echo '--- kinds rendered ---'; grep -h '^kind:' /tmp/r_plain.yaml | sort | uniq -c", "cd ${ROUND_C_REPO_PLACEHOLDER}; echo '--- image + securityContext ---'; grep -n -A4 '^image:' .helm/roz/values.yaml | head -20; grep -n -A12 'securityContext:' .helm/roz/values.yaml | head -30", "cd ${ROUND_C_REPO_PLACEHOLDER}; helm template roz .helm/roz -f .helm/roz/values.yaml -f .helm/roz/values-prod.yaml --set global.env=prod --set keycloakx.image.repository=cr.yandex/crp6iqpcb9uq94n6k81o/keycloak-roz --set keycloakx.image.tag=26.0.7 > /tmp/r_plain2.yaml 2>/tmp/r_plain2.err; echo RC=$?; grep -n 'image:' /tmp/r_plain2.yaml | head -5"]`,
	},
];

/**
 * The four Round C `run_commands` calls whose `commands` value was a LIST
 * of `{command: "..."}` objects, in transcript order.
 *
 * Live message indices: 63, 99, 107, 111.
 * Live tool-call ids:   call_8cf0c1473d0b4c9fa8b2f087,
 *                        call_d19075a225044efb8d9f9ac3,
 *                        call_95d0f0fec0f144db9c2090d3,
 *                        call_fcab4101caa74709b96cc1c1.
 *
 * The first of these carried THREE entries; the rest carried ONE each.
 */
export const ROUND_C_REJECTED_OBJECT_COMMANDS: ReadonlyArray<
	Record<string, unknown>
> = [
	{
		commands: [
			{
				command: `cd ${ROUND_C_REPO_PLACEHOLDER}; echo '===== startup.sh ====='; cat -n startup.sh; echo '===== Dockerfile.roz ====='; cat -n Dockerfile.roz; echo '===== Dockerfile.do ====='; cat -n Dockerfile.do`,
			},
			{
				command: `cd /tmp/kcsrc/keycloak-26.3.1; echo '===== PersistedConfigSource ====='; sed -n '1,200p' quarkus/runtime/src/main/java/org/keycloak/quarkus/runtime/configuration/PersistedConfigSource.java`,
			},
			{
				command: `cd ${ROUND_C_REPO_PLACEHOLDER}; echo '===== values.yaml image block ====='; grep -n -A8 '^image:' .helm/roz/values.yaml; echo '===== values-prod ====='; grep -n -A8 '^image:' .helm/roz/values-prod.yaml`,
			},
		],
	},
	{
		commands: [
			{
				command: `cd ${ROUND_C_REPO_PLACEHOLDER}; echo '===== tracked java test classes ====='; git ls-files | grep -E 'src/test/java/.*\\.java$' | wc -l; git ls-files | grep -E 'src/test/java/.*\\.java$' | head -50; echo '===== non-java test-ish files ====='; git ls-files | grep -E '(test|spec)' | grep -v 'src/test/java' | head -30`,
			},
		],
	},
	{
		commands: [
			{
				command: `cd ${ROUND_C_REPO_PLACEHOLDER}; echo '===== CI 1780-1935 (freemarker-head-theme-ci-qualify) ====='; sed -n '1780,1935p' .gitlab-ci.yml; echo '===== CI 230-340 (deploy template + build jobs) ====='; sed -n '230,340p' .gitlab-ci.yml | cat -n | sed 's/^/  /'`,
			},
		],
	},
	{
		commands: [
			{
				command: `cd ${ROUND_C_REPO_PLACEHOLDER}; echo '===== final repo state ====='; git rev-parse --abbrev-ref HEAD; git rev-parse HEAD; git status --porcelain=v1 | head; echo '===== tracked test count ====='; git ls-files | grep -cE 'src/test/java/.*\\.java$'`,
			},
		],
	},
];

/**
 * The live rejection message for the string-valued `commands` shape.
 */
export const ROUND_C_REJECTION_STRING_COMMANDS =
	"Invalid input for tool run_commands: expected array, received string";

/**
 * The live rejection message for the object-valued `commands` shape.
 */
export const ROUND_C_REJECTION_OBJECT_COMMANDS =
	"Invalid input for tool run_commands: expected string, received object";
