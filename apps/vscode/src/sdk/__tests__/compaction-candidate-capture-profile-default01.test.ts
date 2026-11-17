/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — DOGFOOD PROFILE DEFAULT.
 *
 * The PRIVATE compaction candidate capture is gated by TWO independent
 * conditions inside the SDK (`isCompactionCandidateCaptureArmed()` in
 * `sdk/packages/core/src/runtime/observability/compaction-candidate-capture.ts`):
 *
 *   1. `CLINE_PRIVATE_COMPACTION_CANDIDATE_CAPTURE` === "1"  (exact), AND
 *   2. `CLINEMM_RUNTIME_PROFILE` === "dogfood"                 (exact).
 *
 * The production change under test makes condition (1) the DOGFOOD PROFILE
 * DEFAULT at the extension activation seam, so the operator no longer has to
 * export it before every launch. Condition (2) is NEVER touched: it stays
 * launcher-owned, exact-match and fail-closed, so a PUBLIC install can never
 * arm the capture.
 *
 * ## Frozen matrix (the five required cases)
 *
 *   | Profile | Env override | Effective capture |
 *   |---------|---------------|--------------------|
 *   | Dogfood | unset         | ON                |
 *   | Dogfood | "1"           | ON                |
 *   | Dogfood | "0"           | OFF               |
 *   | Public  | unset         | OFF               |
 *   | Public  | "1"           | OFF               |
 *
 * ## EVIDENCE CLASSIFICATION
 *
 *   BEHAVIOURAL-EXTRACTION: the behaviour tests below do NOT re-implement
 *   the production decision. They EXTRACT the production `if` block's source
 *   text verbatim from `apps/vscode/src/extension.ts` and EVALUATE it in a
 *   controlled scope, bound to the REAL `isDogfoodRuntime` predicate and a
 *   controlled `process.env`. A production regression that changes the
 *   block's condition or its written value therefore FAILS these tests.
 *
 *   The SDK-side half of the contract (the arming predicate, the fail-closed
 *   storage resolver, the retention cap, the byte budget and the restrictive
 *   POSIX permissions) is proven against the REAL SDK module in
 *   `sdk/packages/core/src/runtime/observability/compaction-candidate-capture.profile-default.test.ts`.
 */

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { isDogfoodRuntime } from "../dogfood-runtime-profile"

const EXTENSION_PATH = resolve(__dirname, "../../extension.ts")

/**
 * The environment variable that arms the PRIVATE candidate capture.
 *
 * The literal is duplicated here (rather than imported) because the SDK
 * package is not resolvable from this vitest config's fs scope; the SDK-side
 * test asserts the SAME literal against the real module. If the production
 * variable name ever changes, BOTH suites fail — which is the intended
 * coupling, not an accident.
 */
const CAPTURE_ENV_VAR = "CLINE_PRIVATE_COMPACTION_CANDIDATE_CAPTURE"

/**
 * The launcher-owned, exact-match dogfood profile marker.
 */
const PROFILE_ENV_VAR = "CLINEMM_RUNTIME_PROFILE"

/**
 * The profile marker value that means "dogfood".
 */
const PROFILE_ENV_VALUE = "dogfood"

/**
 * The SDK's arming predicate, mirrored to the letter of the documented
 * contract so the matrix below is expressed in terms of the EFFECTIVE
 * capture state rather than in terms of the env var alone.
 *
 * The REAL predicate is proven against the REAL SDK module in the SDK-side
 * suite; this mirror exists only so this suite can express "effective
 * capture" without crossing the package boundary.
 */
function isEffectiveCaptureArmed(env: Record<string, string | undefined>): boolean {
	return env[CAPTURE_ENV_VAR] === "1" && env[PROFILE_ENV_VAR] === PROFILE_ENV_VALUE
}

/**
 * Extract the production `if` block that applies the dogfood profile default
 * for the private compaction candidate capture.
 *
 * The block is located by its ANCHOR — the assignment to the capture
 * environment variable inside the production `if` — and is returned together
 * with the guard that precedes it. The extraction is deliberately anchored on
 * the assignment so that a production change to the guard or to the written
 * value is picked up verbatim by the behavioural tests below.
 *
 * Returns `undefined` when the block is absent, so a missing block fails
 * loudly instead of silently skipping the behavioural coverage.
 */
async function extractProductionDefaultBlock(): Promise<string | undefined> {
	const source = await readFile(EXTENSION_PATH, "utf8")
	const assignment = `process.env.${CAPTURE_ENV_VAR} = "1"`
	const assignmentIndex = source.indexOf(assignment)
	if (assignmentIndex === -1) {
		return undefined
	}
	// Walk backwards to the `if (` that opens the guard. The search skips
	// occurrences inside a line comment, so a comment mentioning `if (`
	// cannot be mistaken for the guard.
	let guardStart = -1
	for (let probe = assignmentIndex; probe >= 0; probe--) {
		if (!source.startsWith("if (", probe)) {
			continue
		}
		const lineStart = source.lastIndexOf("\n", probe) + 1
		const linePrefix = source.slice(lineStart, probe)
		if (linePrefix.trimStart().startsWith("//")) {
			continue
		}
		guardStart = probe
		break
	}
	if (guardStart === -1) {
		return undefined
	}
	// Walk forward to the closing brace of the guard block.
	let depth = 0
	let cursor = source.indexOf("{", guardStart)
	if (cursor === -1) {
		return undefined
	}
	for (; cursor < source.length; cursor++) {
		if (source[cursor] === "{") {
			depth++
		} else if (source[cursor] === "}") {
			depth--
			if (depth === 0) {
				return source.slice(guardStart, cursor + 1)
			}
		}
	}
	return undefined
}

/**
 * Evaluate the PRODUCTION block against a controlled environment.
 *
 * The block is compiled with the real `isDogfoodRuntime` bound as
 * `isDogfoodRuntime` and the controlled env bound as `process.env`, exactly
 * as it is bound in the production module scope. The returned value is the
 * env AFTER the block ran.
 */
async function runProductionBlock(env: Record<string, string | undefined>): Promise<Record<string, string | undefined>> {
	const block = await extractProductionDefaultBlock()
	if (block === undefined) {
		throw new Error("production profile-default block not found in extension.ts")
	}
	// A mutable, isolated stand-in for `process.env`. The production block
	// reads `process.env.CLINE_PRIVATE_COMPACTION_CANDIDATE_CAPTURE` and
	// writes `process.env.CLINE_PRIVATE_COMPACTION_CANDIDATE_CAPTURE`; it
	// also calls `isDogfoodRuntime(process.env)`.
	const fakeEnv: Record<string, string | undefined> = { ...env }
	const factory = new Function("isDogfoodRuntime", "process", `return (function () { ${block} })()`)
	factory(isDogfoodRuntime, { env: fakeEnv })
	return fakeEnv
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
	// The production block mutates `process.env`; every test starts from a
	// clean, explicitly-controlled baseline.
	delete process.env[CAPTURE_ENV_VAR]
	delete process.env[PROFILE_ENV_VAR]
})

afterEach(() => {
	delete process.env[CAPTURE_ENV_VAR]
	delete process.env[PROFILE_ENV_VAR]
	Object.assign(process.env, ORIGINAL_ENV)
})

describe("C1: the production profile-default block exists in extension.ts", () => {
	it('C1.1: the block is present and writes the capture flag to exactly "1"', async () => {
		const block = await extractProductionDefaultBlock()
		expect(block).toBeDefined()
		expect(block).toContain(`process.env.${CAPTURE_ENV_VAR} = "1"`)
	})

	it("C1.2: the block is guarded by the dogfood runtime predicate", async () => {
		const block = await extractProductionDefaultBlock()
		expect(block).toBeDefined()
		expect(block).toContain("isDogfoodRuntime(process.env)")
	})

	it("C1.3: the block only writes when the operator left the variable UNSET", async () => {
		const block = await extractProductionDefaultBlock()
		expect(block).toBeDefined()
		expect(block).toContain(`process.env.${CAPTURE_ENV_VAR} === undefined`)
	})

	it("C1.4: the block does NOT mutate the launcher-owned profile marker", async () => {
		const block = await extractProductionDefaultBlock()
		expect(block).toBeDefined()
		expect(block).not.toContain(`process.env.${PROFILE_ENV_VAR} =`)
	})
})

describe("C2: the frozen profile/override matrix (the five required cases)", () => {
	it("C2.1: dogfood + unset -> capture ON", async () => {
		const env = await runProductionBlock({ [PROFILE_ENV_VAR]: PROFILE_ENV_VALUE })
		expect(env[CAPTURE_ENV_VAR]).toBe("1")
		expect(isEffectiveCaptureArmed(env)).toBe(true)
	})

	it('C2.2: dogfood + explicit "1" -> capture ON', async () => {
		const env = await runProductionBlock({
			[PROFILE_ENV_VAR]: PROFILE_ENV_VALUE,
			[CAPTURE_ENV_VAR]: "1",
		})
		expect(env[CAPTURE_ENV_VAR]).toBe("1")
		expect(isEffectiveCaptureArmed(env)).toBe(true)
	})

	it('C2.3: dogfood + explicit "0" -> capture OFF (the opt-out is NEVER overridden)', async () => {
		const env = await runProductionBlock({
			[PROFILE_ENV_VAR]: PROFILE_ENV_VALUE,
			[CAPTURE_ENV_VAR]: "0",
		})
		expect(env[CAPTURE_ENV_VAR]).toBe("0")
		expect(isEffectiveCaptureArmed(env)).toBe(false)
	})

	it("C2.4: public + unset -> capture OFF", async () => {
		const env = await runProductionBlock({})
		expect(env[CAPTURE_ENV_VAR]).toBeUndefined()
		expect(isEffectiveCaptureArmed(env)).toBe(false)
	})

	it('C2.5: public + explicit "1" -> capture OFF (the public privacy gate is preserved)', async () => {
		const env = await runProductionBlock({
			[CAPTURE_ENV_VAR]: "1",
		})
		expect(env[CAPTURE_ENV_VAR]).toBe("1")
		expect(isEffectiveCaptureArmed(env)).toBe(false)
	})

	it("C2.6: a NON-exact profile marker never arms the capture (fail-closed identity)", async () => {
		for (const marker of ["Dogfood", "dogfood ", "1", "true", "yes", "public", ""]) {
			const env = await runProductionBlock({
				[PROFILE_ENV_VAR]: marker,
				[CAPTURE_ENV_VAR]: "1",
			})
			expect(isEffectiveCaptureArmed(env)).toBe(false)
		}
	})
})

describe("C3: an explicit operator value is NEVER overridden", () => {
	it("C3.1: every non-unset operator value survives the block unchanged", async () => {
		for (const value of ["0", "1", "", "off", "false", "yes", "banana"]) {
			const env = await runProductionBlock({
				[PROFILE_ENV_VAR]: PROFILE_ENV_VALUE,
				[CAPTURE_ENV_VAR]: value,
			})
			expect(env[CAPTURE_ENV_VAR]).toBe(value)
		}
	})
})

describe("C4: repeated activation is IDEMPOTENT", () => {
	it("C4.1: running the block twice in dogfood converges to the same state", async () => {
		const first = await runProductionBlock({ [PROFILE_ENV_VAR]: PROFILE_ENV_VALUE })
		expect(first[CAPTURE_ENV_VAR]).toBe("1")

		// Re-run the block with the ALREADY-DEFAULTED env: the operator
		// value is now "1" (not undefined), so the block is a no-op.
		const second = await runProductionBlock({ ...first })
		expect(second[CAPTURE_ENV_VAR]).toBe("1")
		expect(isEffectiveCaptureArmed(second)).toBe(true)
	})

	it("C4.2: the block writes the SAME value on every dogfood activation", async () => {
		const a = await runProductionBlock({ [PROFILE_ENV_VAR]: PROFILE_ENV_VALUE })
		const b = await runProductionBlock({ [PROFILE_ENV_VAR]: PROFILE_ENV_VALUE })
		expect(a[CAPTURE_ENV_VAR]).toBe(b[CAPTURE_ENV_VAR])
	})

	it('C4.3: an explicit "0" stays "0" across repeated activations', async () => {
		const env = { [PROFILE_ENV_VAR]: PROFILE_ENV_VALUE, [CAPTURE_ENV_VAR]: "0" }
		const first = await runProductionBlock({ ...env })
		const second = await runProductionBlock({ ...first })
		expect(first[CAPTURE_ENV_VAR]).toBe("0")
		expect(second[CAPTURE_ENV_VAR]).toBe("0")
	})
})

describe("C5: the block is placed at the EARLIEST activation seam, BEFORE the first SDK session", () => {
	it("C5.1: the block runs IMMEDIATELY AFTER the provider-capture activation", async () => {
		const source = await readFile(EXTENSION_PATH, "utf8")
		const providerIndex = source.indexOf("applyProviderRequestCaptureDiagnosticProfile(")
		const blockIndex = source.indexOf(`process.env.${CAPTURE_ENV_VAR} = "1"`)
		expect(providerIndex).toBeGreaterThan(-1)
		expect(blockIndex).toBeGreaterThan(providerIndex)
	})

	it("C5.2: the block runs BEFORE the SDK runtime/session construction boundary", async () => {
		const source = await readFile(EXTENSION_PATH, "utf8")
		const blockIndex = source.indexOf(`process.env.${CAPTURE_ENV_VAR} = "1"`)
		// `initialize(storageContext)` is the FIRST SDK session boundary in
		// the activation sequence.
		const sessionIndex = source.indexOf("await initialize(storageContext)")
		expect(blockIndex).toBeGreaterThan(-1)
		expect(sessionIndex).toBeGreaterThan(-1)
		expect(blockIndex).toBeLessThan(sessionIndex)
	})

	it("C5.3: the isolated storage root is bound BEFORE the capture flag is set", async () => {
		// The provider-capture activation helper is the WRITER of
		// `CLINE_DATA_DIR` (the isolated storage root the SDK's private
		// resolver needs). The helper is SYNCHRONOUS and writes the var
		// before it returns, so the profile-default block — which runs
		// immediately after the helper call — observes an already-bound
		// storage root.
		const source = await readFile(EXTENSION_PATH, "utf8")
		const providerIndex = source.indexOf(
			"applyProviderRequestCaptureDiagnosticProfile(isDogfoodRuntime(process.env), process.env, context.globalStorageUri.fsPath)",
		)
		const blockIndex = source.indexOf(`process.env.${CAPTURE_ENV_VAR} = "1"`)
		expect(providerIndex).toBeGreaterThan(-1)
		expect(blockIndex).toBeGreaterThan(providerIndex)

		// The helper itself writes the storage root.
		const helperSource = await readFile(resolve(__dirname, "../dogfood-diagnostic-profile.ts"), "utf8")
		expect(helperSource).toContain("process.env.CLINE_DATA_DIR = resolved.dataDir")
	})
})

describe("C6: no new public configuration surface was introduced", () => {
	it("C6.1: no new settings / commands were added for this default", async () => {
		const source = await readFile(EXTENSION_PATH, "utf8")
		// The ONLY env var this change touches is the EXISTING private
		// capture opt-in.
		expect(source).toContain("CLINE_PRIVATE_COMPACTION_CANDIDATE_CAPTURE")
		// No command-palette surface.
		expect(source).not.toContain("toggleCompactionCandidateCapture")
		expect(source).not.toContain("dumpCompactionCandidateCapture")
	})
})
