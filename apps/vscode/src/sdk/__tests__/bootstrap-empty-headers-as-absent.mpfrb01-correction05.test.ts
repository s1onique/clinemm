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

  it("MPFRB01_C05_RUNTIME_PARITY: a user with openAiHeaders={} observes identical runtime behavior to openAiHeaders=undefined", async () => {
    // Witness: the runtime composes ...(openAiHeaders || {}), so
    // both representations produce zero outbound custom headers.
    // The bootstrap must produce the SAME persisted connection shape
    // for both.
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
})
