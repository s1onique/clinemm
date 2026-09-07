/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION05
 *
 * LIVE-FOUND P0 RED witness: legacy persisted openAiHeaders={} must
 * NOT be classified as MALFORMED by the bootstrap normalizer.
 *
 * The runtime authority is `...(openAiHeaders || {})` in the OpenAI
 * provider; absent and empty are both semantically equivalent to
 * "no custom headers". The bootstrap normalizer (CORRECTION03) added
 * a `zero string-valued entries` check that refused the empty
 * plain object as malformed, which surfaced as
 * CURRENT_CONFIGURATION_UNSUPPORTED + "openAiHeaders are malformed"
 * in the live first-run dogfood (zero-profiles user with a valid
 * MiniMax/OpenAI-compatible configuration whose legacy persisted
 * openAiHeaders happened to be {}).
 *
 * CORRECTION05 canonicalizes empty header representations
 * (plain-object {} AND JSON "{}") to ABSENT so the bootstrap
 * succeeds and the persisted instance has connection.headers
 * strictly absent (NOT {}, NOT null). Genuinely malformed non-empty
 * payloads continue to refuse per MALFORMED_HEADERS_POLICY.
 *
 * EVIDENCE-PRECISION NOTES (per reviewer P2, 2026-09-09):
 *
 *   BOOTSTRAP_PERSISTED_SHAPE_PARITY = EXECUTED
 *     This test suite asserts that {} and undefined produce
 *     IDENTICAL persisted instance.connection shapes. That is
 *     fully proven below (no live provider call is made).
 *
 *   RUNTIME_BEHAVIOR_EQUIVALENCE = STRUCTURALLY_CORROBORATED
 *     The assertion that the user observes "identical runtime
 *     behavior" between {} and undefined is NOT proven by these
 *     tests. It is structurally corroborated by reading the
 *     runtime composes `...(openAiHeaders || {})`, which is
 *     exactly the absent-equivalence rule the empty-canonicalize
 *     fix restores at the bootstrap layer. Outbound HTTP
 *     behavior parity is upstream evidence (OpenAI-Compatible
 *     provider), not asserted in this file.
 *
 *   PARTIALLY_MALFORMED_HEADERS_POLICY = PINNED (non-blocking P1)
 *     The MPFRB01_C05_P1_PARTIALLY_MALFORMED_ASYMMETRY_* witnesses
 *     pin the CURRENT observed parser asymmetry (silent-drop of
 *     non-string-valued entries) as a freeze, not an endorsement.
 *     See freeze #6 in the production file header. The likely
 *     CORRECTION06 (post-dogfood) will refuse partially-malformed
 *     input rather than silently drop bad entries.
 *
 * Run via:
 *   cd apps/vscode && TMPDIR=/tmp bun test \
 *     src/sdk/__tests__/bootstrap-empty-headers-as-absent.mpfrb01-correction05.test.ts
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { InstancesStore } from "../instance-store/instances-store"
import {
  type BootstrapModelProfileDeps,
  bootstrapModelProfileFromCurrentConfiguration,
} from "../profile-store/bootstrap"
import { ProfilesStore } from "../profile-store/profiles-store"

function tmpDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mpfrb01-c05-eh-"))
}

function makeDeps(dataDir: string, config: Record<string, unknown>): BootstrapModelProfileDeps {
  const instancesStore = new InstancesStore({ filePath: path.join(dataDir, "instances.json") })
  const profilesStore = new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
  return {
    getApiConfiguration: () => config as never,
    getMode: () => "act",
    setInstanceSecret: () => {},
    flushInstanceSecrets: async () => {},
    instancesStore,
    profilesStore,
  }
}

describe("ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION05 / EMPTY-HEADERS-AS-ABSENT", () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = tmpDataDir()
  })

  afterEach(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  // ---------- RED witnesses (live-failure matrix) ----------

  it("MPFRB01_C05_H1_UNDEFINED: openAiHeaders=undefined -> CREATED, connection.headers absent", async () => {
    const deps = makeDeps(dataDir, {
      actModeApiProvider: "openai",
      actModeOpenAiModelId: "MiniMax-M3",
      openAiApiKey: "sk-XXXXX",
      openAiBaseUrl: "https://api.MiniMax.example/v1",
      // openAiHeaders intentionally absent
    })
    const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "Headerless")
    expect(result.status).toBe("CREATED")
    if (result.status !== "CREATED") throw new Error("unreachable: status guard")
    const persisted = deps.instancesStore.list()[result.instanceId]
    expect(persisted.connection.headers).toBeUndefined()
    expect("headers" in persisted.connection).toBe(false)
  })

  it("MPFRB01_C05_H2_EMPTY_PLAIN_OBJECT: openAiHeaders={} -> CREATED, connection.headers absent (NOT MALFORMED)", async () => {
    // The load-bearing regression witness: legacy persisted {} must
    // succeed, NOT refuse with CURRENT_CONFIGURATION_UNSUPPORTED.
    const deps = makeDeps(dataDir, {
      actModeApiProvider: "openai",
      actModeOpenAiModelId: "MiniMax-M3",
      openAiApiKey: "sk-XXXXX",
      openAiBaseUrl: "https://api.MiniMax.example/v1",
      openAiHeaders: {},
    })
    const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "MiniMax no headers")
    expect(result.status).toBe("CREATED")
    if (result.status !== "CREATED") throw new Error("unreachable: status guard")
    const persisted = deps.instancesStore.list()[result.instanceId]
    // EMPTY_OBJECT = ABSENT -> connection.headers MUST be strictly
    // absent (NOT {}, NOT null, NOT a header map).
    expect(persisted.connection.headers).toBeUndefined()
    expect("headers" in persisted.connection).toBe(false)
  })

  it("MPFRB01_C05_H3_EMPTY_JSON_STRING: openAiHeaders='{}' -> CREATED, connection.headers absent", async () => {
    const deps = makeDeps(dataDir, {
      actModeApiProvider: "openai",
      actModeOpenAiModelId: "MiniMax-M3",
      openAiApiKey: "sk-XXXXX",
      openAiBaseUrl: "https://api.MiniMax.example/v1",
      openAiHeaders: "{}",
    })
    const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "Empty JSON")
    expect(result.status).toBe("CREATED")
    if (result.status !== "CREATED") throw new Error("unreachable: status guard")
    const persisted = deps.instancesStore.list()[result.instanceId]
    expect(persisted.connection.headers).toBeUndefined()
    expect("headers" in persisted.connection).toBe(false)
  })

  it("MPFRB01_C05_H4_NONEMPTY_OBJECT: openAiHeaders={'X-Tenant':'foo'} -> CREATED, headers captured", async () => {
    const deps = makeDeps(dataDir, {
      actModeApiProvider: "openai",
      actModeOpenAiModelId: "MiniMax-M3",
      openAiApiKey: "sk-XXXXX",
      openAiBaseUrl: "https://api.MiniMax.example/v1",
      openAiHeaders: { "X-Tenant": "foo" },
    })
    const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "With tenant")
    expect(result.status).toBe("CREATED")
    if (result.status !== "CREATED") throw new Error("unreachable: status guard")
    const persisted = deps.instancesStore.list()[result.instanceId]
    expect(persisted.connection.headers).toEqual({ "X-Tenant": "foo" })
  })

  it("MPFRB01_C05_H5_NONEMPTY_JSON_STRING: openAiHeaders='{\"X-Tenant\":\"foo\"}' -> CREATED, headers captured", async () => {
    const deps = makeDeps(dataDir, {
      actModeApiProvider: "openai",
      actModeOpenAiModelId: "MiniMax-M3",
      openAiApiKey: "sk-XXXXX",
      openAiBaseUrl: "https://api.MiniMax.example/v1",
      openAiHeaders: '{"X-Tenant":"foo"}',
    })
    const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "Tenant JSON")
    expect(result.status).toBe("CREATED")
    if (result.status !== "CREATED") throw new Error("unreachable: status guard")
    const persisted = deps.instancesStore.list()[result.instanceId]
    expect(persisted.connection.headers).toEqual({ "X-Tenant": "foo" })
  })

  // ---------- GREEN guards: genuinely malformed payloads STILL refuse ----------

  it("MPFRB01_C05_H6_INVALID_JSON: openAiHeaders='{broken json' -> CURRENT_CONFIGURATION_UNSUPPORTED", async () => {
    const deps = makeDeps(dataDir, {
      actModeApiProvider: "openai",
      actModeOpenAiModelId: "MiniMax-M3",
      openAiApiKey: "sk-XXXXX",
      openAiBaseUrl: "https://api.MiniMax.example/v1",
      openAiHeaders: "{broken json",
    })
    const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "Broken JSON")
    expect(result.status).toBe("CURRENT_CONFIGURATION_UNSUPPORTED")
    if (result.status !== "CURRENT_CONFIGURATION_UNSUPPORTED") throw new Error("unreachable: status guard")
    expect(result.message).toMatch(/openAiHeaders are malformed/i)
    // Conservation: nothing was committed.
    expect(Object.keys(deps.instancesStore.list())).toHaveLength(0)
    expect(Object.keys(deps.profilesStore.list())).toHaveLength(0)
  })

  it("MPFRB01_C05_H7_NONEMPTY_OBJECT_NO_STRING_ENTRIES: openAiHeaders={X:123} -> CURRENT_CONFIGURATION_UNSUPPORTED", async () => {
    // A non-empty plain object whose values are all non-strings is
    // genuinely malformed-present (the user stored garbage). The
    // bootstrap MUST refuse per MALFORMED_HEADERS_POLICY. The H7
    // guard confirms we did not over-generalize the empty-canonicalize
    // fix into "swallow all malformed-present cases".
    const deps = makeDeps(dataDir, {
      actModeApiProvider: "openai",
      actModeOpenAiModelId: "MiniMax-M3",
      openAiApiKey: "sk-XXXXX",
      openAiBaseUrl: "https://api.MiniMax.example/v1",
      openAiHeaders: { X: 123 as unknown as string },
    })
    const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "Garbage non-string values")
    expect(result.status).toBe("CURRENT_CONFIGURATION_UNSUPPORTED")
    if (result.status !== "CURRENT_CONFIGURATION_UNSUPPORTED") throw new Error("unreachable: status guard")
    expect(result.message).toMatch(/openAiHeaders are malformed/i)
    expect(Object.keys(deps.instancesStore.list())).toHaveLength(0)
  })

  // ---------- Migration / conservation witnesses ----------

  it("MPFRB01_C05_LEGACY_MIGRATION: legacy persisted {} -> bootstrap succeeds, persisted connection.headers is strictly absent", async () => {
    // Witness: the exact migration the user observed live. Source
    // config openAiHeaders = {} (legacy persisted). Bootstrap path
    // must commit. The persisted instance MUST have connection.headers
    // absent (NOT {}, NOT null) so identity-collapse tests (which
    // distinguish absent from header-bearing) continue to work.
    const deps = makeDeps(dataDir, {
      actModeApiProvider: "openai",
      actModeOpenAiModelId: "MiniMax-M3",
      openAiApiKey: "sk-XXXXX",
      openAiBaseUrl: "https://api.MiniMax.example/v1",
      openAiHeaders: {},
    })
    const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "Legacy persisted")
    expect(result.status).toBe("CREATED")
    if (result.status !== "CREATED") throw new Error("unreachable: status guard")
    const persisted = deps.instancesStore.list()[result.instanceId]
    // Strictly absent - matches the runtime authority where
    // openAiHeaders=undefined and openAiHeaders={} produce identical
    // outbound request behavior.
    expect(persisted.connection.headers).toBeUndefined()
    expect("headers" in persisted.connection).toBe(false)
  })

  it("MPFRB01_C05_BOOTSTRAP_PERSISTED_SHAPE_PARITY: openAiHeaders={} and openAiHeaders=undefined produce IDENTICAL persisted instance.connection shape", async () => {
    // EVIDENCE-PRECISION (reviewer P2, 2026-09-09):
    //   BOOTSTRAP_PERSISTED_SHAPE_PARITY = EXECUTED here.
    //   RUNTIME_BEHAVIOR_EQUIVALENCE    = STRUCTURALLY_CORROBORATED
    //     (upstream OpenAI-Compatible provider composes
    //      ...(openAiHeaders || {}); not asserted in this test).
    //
    // This test proves the bootstrap writes the same persisted
    // connection shape for both empty-plain-object and absent
    // representations. It does NOT execute a real provider call.
    const cfgEmptyObj = {
      actModeApiProvider: "openai" as const,
      actModeOpenAiModelId: "MiniMax-M3",
      openAiApiKey: "sk-XXXXX",
      openAiBaseUrl: "https://api.MiniMax.example/v1",
      openAiHeaders: {} as Record<string, string>,
    }
    const cfgUndefined = { ...cfgEmptyObj, openAiHeaders: undefined }
    const deps1 = makeDeps(tmpDataDir(), cfgEmptyObj)
    const deps2 = makeDeps(tmpDataDir(), cfgUndefined)
    const r1 = await bootstrapModelProfileFromCurrentConfiguration(deps1, "EmptyObj")
    const r2 = await bootstrapModelProfileFromCurrentConfiguration(deps2, "Undefined")
    expect(r1.status).toBe("CREATED")
    expect(r2.status).toBe("CREATED")
    if (r1.status !== "CREATED" || r2.status !== "CREATED") throw new Error("unreachable")
    const p1 = deps1.instancesStore.list()[r1.instanceId]
    const p2 = deps2.instancesStore.list()[r2.instanceId]
    // The persisted connection shape is identical: both have
    // connection.headers strictly absent, neither has a stale {}
    // residue.
    expect("headers" in p1.connection).toBe(false)
    expect("headers" in p2.connection).toBe(false)
    expect(p1.connection.headers).toBeUndefined()
    expect(p2.connection.headers).toBeUndefined()
    // The rest of the connection tuple is identical (modelId, baseUrl).
    expect(p1.connection.modelId).toBe(p2.connection.modelId)
    expect(p1.connection.baseUrl).toBe(p2.connection.baseUrl)
  })

  // -----------------------------------------------------------------
  // P1 PARTIALLY_MALFORMED_HEADERS_POLICY pinning witnesses
  //   Per reviewer P1 (2026-09-09): freeze the CURRENT observed
  //   asymmetry of the parser (silent-drop of non-string-valued
  //   entries) so future contributors cannot silently change it.
  //   Likely CORRECTION06 (post-dogfood, NOT this ACT) will
  //   change these witnesses from GREEN to RED->GREEN when the
  //   parser refuses partially-malformed input instead of silently
  //   dropping bad entries. Reviewer directive: "Do NOT fix before
  //   live retest. It is not the user's observed geometry."
  // -----------------------------------------------------------------

  it("MPFRB01_C05_P1_PARTIALLY_MALFORMED_ASYMMETRY_PLAIN_OBJECT: openAiHeaders={'X-Good':'foo', 'X-Bad':123} -> CAPTURED with 'X-Good' only (CURRENT asymmetric behavior pinned)", async () => {
    // CURRENT asymmetry: parser keeps string-valued entries and
    // SILENTLY drops non-string-valued entries. This is asymmetric
    // with freeze #5 ("NON-EMPTY + ALL-VALUES-UNUSABLE refuses")
    // because partially-malformed input does NOT refuse.
    //
    // Likely desired (CORRECTION06): MALFORMED + refuse rather
    // than silently drop. Until then, this witness pins the
    // current behavior.
    const cfg = {
      actModeApiProvider: "openai" as const,
      actModeOpenAiModelId: "MiniMax-M3",
      openAiApiKey: "sk-XXXXX",
      openAiBaseUrl: "https://api.MiniMax.example/v1",
      openAiHeaders: { "X-Good": "foo", "X-Bad": 123 } as Record<string, unknown>,
    }
    const deps = makeDeps(tmpDataDir(), cfg)
    const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "PartiallyMalformed")
    expect(result.status).toBe("CREATED")
    if (result.status !== "CREATED") throw new Error("unreachable")
    const profile = deps.instancesStore.list()[result.instanceId]
    // CURRENT pinned behavior: connection.headers exists, contains
    // only "X-Good", "X-Bad" was silently dropped.
    expect(profile.connection.headers).toEqual({ "X-Good": "foo" })
    // Explicit anti-assertion so future CORRECTION06 visibility:
    // when CORRECTION06 lands, this expect will FAIL because the
    // status will be CURRENT_CONFIGURATION_UNSUPPORTED instead of
    // CREATED. That RED is the intended gate for the next ACT.
    expect(result.status).not.toBe("CURRENT_CONFIGURATION_UNSUPPORTED")
  })

  it("MPFRB01_C05_P1_PARTIALLY_MALFORMED_ASYMMETRY_JSON_STRING: openAiHeaders='{\"X-Good\":\"foo\",\"X-Bad\":123}' -> CAPTURED with 'X-Good' only (CURRENT asymmetric behavior pinned)", async () => {
    // Mirror of the plain-object witness, exercising the JSON-string
    // form (legacy settings-panel storage). Pins the same
    // silent-drop asymmetry on the parse path.
    const cfg = {
      actModeApiProvider: "openai" as const,
      actModeOpenAiModelId: "MiniMax-M3",
      openAiApiKey: "sk-XXXXX",
      openAiBaseUrl: "https://api.MiniMax.example/v1",
      openAiHeaders: '{"X-Good":"foo","X-Bad":123}' as unknown as Record<string, string>,
    }
    const deps = makeDeps(tmpDataDir(), cfg)
    const result = await bootstrapModelProfileFromCurrentConfiguration(deps, "PartiallyMalformedJson")
    expect(result.status).toBe("CREATED")
    if (result.status !== "CREATED") throw new Error("unreachable")
    const profile = deps.instancesStore.list()[result.instanceId]
    expect(profile.connection.headers).toEqual({ "X-Good": "foo" })
    expect(result.status).not.toBe("CURRENT_CONFIGURATION_UNSUPPORTED")
  })
})
