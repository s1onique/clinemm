/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R4
 *
 * RED->GREEN witness for the instance-secret namespace.
 *
 * Recon freeze (commit 191dd639b, evidence 06a):
 *
 *   CREDENTIAL_STORAGE_PRIMITIVE  = C (instance: prefix in secrets.json)
 *   New typed accessor pair (getInstanceSecret / setInstanceSecret)
 *   InstanceSecretNameSchema = /^instance:.+$/
 */

import { describe, expect, it } from "vitest"
import {
	INSTANCE_SECRET_NAME_PATTERN,
	InstanceSecretError,
	type InstanceSecretName,
	nameFor,
	parseInstanceSecretName,
} from "../instance-secret"

describe("ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R4", () => {
	it("R4-01: parseInstanceSecretName accepts only the 'instance:' prefix", () => {
		expect(parseInstanceSecretName("instance:foo")).toBe("instance:foo")
		expect(parseInstanceSecretName("instance:corp-llm-key")).toBe(
			"instance:corp-llm-key",
		)
	})

	it("R4-02: parseInstanceSecretName rejects non-prefixed names (fail closed)", () => {
		expect(() => parseInstanceSecretName("foo")).toThrow(InstanceSecretError)
		expect(() => parseInstanceSecretName("openaiApiKey")).toThrow(
			InstanceSecretError,
		)
		expect(() => parseInstanceSecretName("")).toThrow(InstanceSecretError)
		expect(() => parseInstanceSecretName("instance:")).toThrow(InstanceSecretError)
	})

	it("R4-03: parseInstanceSecretName rejects a non-string (fail closed)", () => {
		expect(() =>
			parseInstanceSecretName(123 as unknown as string),
		).toThrow(InstanceSecretError)
		expect(() =>
			parseInstanceSecretName(null as unknown as string),
		).toThrow(InstanceSecretError)
		expect(() =>
			parseInstanceSecretName(undefined as unknown as string),
		).toThrow(InstanceSecretError)
	})

	it("R4-04: nameFor builds a namespaced key from an instanceId", () => {
		const name = nameFor("inst-A")
		expect(name).toBe("instance:inst-A")
		expect(INSTANCE_SECRET_NAME_PATTERN.test(name)).toBe(true)
	})

	it("R4-05: nameFor rejects empty instanceId (fail closed)", () => {
		expect(() => nameFor("")).toThrow(InstanceSecretError)
	})

	it("R4-06: the regex matches what the schema says it matches", () => {
		// Positive cases
		expect(INSTANCE_SECRET_NAME_PATTERN.test("instance:x")).toBe(true)
		expect(INSTANCE_SECRET_NAME_PATTERN.test("instance:corp-llm-key")).toBe(true)
		// Negative cases
		expect(INSTANCE_SECRET_NAME_PATTERN.test("x")).toBe(false)
		expect(INSTANCE_SECRET_NAME_PATTERN.test("")).toBe(false)
		expect(INSTANCE_SECRET_NAME_PATTERN.test("instance:")).toBe(false)
		expect(INSTANCE_SECRET_NAME_PATTERN.test(" Instance:x")).toBe(false) // no leading space
	})

	it("R4-07: InstanceSecretName is brand-distinct from arbitrary string at the type level", () => {
		// This is a compile-time check: the brand is erased at runtime,
		// but at the type level a `string` cannot be assigned to
		// `InstanceSecretName` without going through parseInstanceSecretName
		// or `nameFor`. Verified by the type system; runtime sanity below.
		const a: InstanceSecretName = nameFor("inst-A")
		const b: InstanceSecretName = parseInstanceSecretName("instance:inst-B")
		expect(a).toBe("instance:inst-A")
		expect(b).toBe("instance:inst-B")
	})
})
