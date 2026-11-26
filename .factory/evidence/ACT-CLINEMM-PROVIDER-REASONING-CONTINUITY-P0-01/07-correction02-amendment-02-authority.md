# 07 — CORRECTION02 / AMENDMENT-02: the fail-closed, credential-free route authority

**ACT:** `ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION02`
**Amendment:** `AMENDMENT-02`
**Verdict:** `GO_PROVIDER_REASONING_REPAIR_INTEGRATION`

---

## 1. What remained open after CORRECTION02

CORRECTION02 replaced the bare provider id with an effective-route authority,
but two defects survived:

| # | Defect | Consequence |
|---|---|---|
| A1 | The authority for an UNRESOLVED route was the NONEMPTY SENTINEL `"<providerId>\u0000"` | Two DIFFERENT unresolved routes compared EQUAL, so the replay predicate granted authority across a boundary that was never established |
| A2 | The authority persisted the COMPLETE configured base URL | A credential-bearing base URL (user information, query string, fragment) was written verbatim into the persisted content block |

### 1.1 The predecessor's A1 code

```typescript
const endpoint = input.baseUrl?.trim().replace(/\/+$/, "");
return endpoint
    ? `${input.providerId}\u0000${endpoint}`
    : `${input.providerId}\u0000`;      // <-- the NONEMPTY SENTINEL
```

The predicate accepts equal nonempty strings, so `"anthropic\u0000"` (the
sentinel) equalled `"anthropic\u0000"` (the sentinel) for two DIFFERENT
unresolved routes.

### 1.2 The predecessor's A2 code

The authority was `providerId \u0000 <the whole base URL>`, and that value is
**PERSISTED** on the thinking content block
(`ThinkingContent.originAuthority`, preserved by
`sdk/packages/core/src/runtime/config/agent-message-codec.ts`).

## 2. Production reachability (established, not assumed)

### 2.1 A1 — the unresolved route is production-reachable

The registry resolves the base URL as
`config?.baseUrl ?? resolveApiLineBaseUrl(options) ?? record.defaults?.baseUrl`
(`sdk/packages/llms/src/providers/registry.ts:329-332`). The AI SDK translator
reads `context.config.baseUrl` at the single request-construction boundary
(`sdk/packages/llms/src/providers/ai-sdk.ts:421-424`).

MEASURED — the builtins that resolve NO base URL at all:

```
NO_BASE_URL_PROVIDERS: [ "claude-code", "vertex", "bedrock", "opencode", "dify", "sapaicore" ]
```

MEASURED — the authority constructor is actually reached with
`baseUrl === undefined` on the real production path (the instrumented
`buildReasoningOriginAuthority` was called by the real runtime for each of
these providers):

```
PROVIDERS_PROBED: 6
UNRESOLVED: [ ["vertex",["undefined"]], ["bedrock",["undefined"]],
              ["dify",["undefined"]], ["sapaicore",["undefined"]] ]
```

The `claude-code` and `opencode` builtins additionally declare
`defaults: { baseUrl: "" }` — an EMPTY base URL, which is the same
unresolved-route condition by another route.

### 2.2 A2 — a credential-bearing base URL reaches the authority and the persisted block

The provider configuration schema is
`baseUrl: z.string().url().optional()`
(`sdk/packages/shared/src/agents/types.ts:1071`). MEASURED — that schema
ACCEPTS every credential-bearing URL shape:

```
"https://user:secret@example.com/v1"       -> ACCEPTED
"https://example.com/v1?api_key=SECRET123" -> ACCEPTED
"https://example.com/v1/SECRETTOKEN/path"  -> ACCEPTED
"https://example.com/v1#frag-secret"       -> ACCEPTED
"not a url"                                -> REJECTED
```

MEASURED — end to end through the REAL runtime and the REAL production
persistence codec, the credential reached the persisted record:

```
URL: https://user:supersecret@example.com/v1/messages
PERSISTED: [
  { "id": "msg_lHMDmJsd", "role": "assistant", "content": [
      { "type": "thinking", "thinking": "SYN", "signature": "SIG-A",
        "originAuthority": "anthropic\u0000https://user:supersecret@example.com/v1" } ] },
  ...
]
```

**The credential was in the persisted production content block.**

### 2.3 The configuration contract — where credentials live

`GatewayProviderSettings` (`sdk/packages/shared/src/llms/gateway.ts:217-228`)
carries credentials in `apiKey` / `apiKeyResolver` / `apiKeyEnv` / `headers`.
The base URL is the ROUTE. The repository never places a credential in the
base URL path (the path segments in use are deployment ids — Azure
`/openai/deployments/<id>`, SAP AI Core `/v2/inference/deployments/<id>`).

## 3. The bounded repair

### 3.1 A1 — absence is EXPLICIT

```typescript
function buildReasoningOriginAuthority(input: {
    providerId: string;
    baseUrl: string | undefined;
}): string | undefined {
    const providerId = input.providerId?.trim();
    if (!providerId) return undefined;
    const rawBaseUrl = input.baseUrl?.trim();
    if (!rawBaseUrl) return undefined;
    let url: URL;
    try { url = new URL(rawBaseUrl); } catch { return undefined; }
    if (url.username.length > 0 || url.password.length > 0) return undefined;
    if (url.search.length > 0) return undefined;
    if (url.hash.length > 0) return undefined;
    const origin = url.origin;
    if (!origin || origin === "null") return undefined;
    const path = url.pathname.replace(/\/+$/, "");
    return `${providerId}\u0000${origin}\u0000${path}`;
}
```

The authority is now `string | undefined`. `undefined` means "this route is
UNRESOLVED". **There is no nonempty sentinel**, so two unresolved routes have
nothing to compare.

The destination-authority PARAMETER remains REQUIRED (no production caller
can omit it), while its VALUE may be `undefined` — which is exactly how an
unresolved destination route is represented.

`mayReplayOpaqueReasoning` denies on an absent or malformed origin, on an
absent or malformed destination authority, and on any inequality. It fails
closed on every branch.

### 3.2 A2 — credential exclusion, by INSPECTION and fail-closed

The URL is parsed and then INSPECTED. A URL carrying ANY of the following
produces **NO authority at all** — so nothing credential-bearing is ever
persisted, and nothing identity-bearing is silently stripped:

| Component | Disposition | Reason |
|---|---|---|
| USER INFORMATION | NO AUTHORITY | a credential; not route identity; stripping it would make two effective routes indistinguishable |
| QUERY STRING | NO AUTHORITY | the canonical credential carrier in a URL; indistinguishable from route identity by shape |
| FRAGMENT | NO AUTHORITY | never transmitted to the server, so it cannot be route identity; may carry a credential |
| unparseable URL | NO AUTHORITY | an invalid endpoint is an unresolved route |
| ORIGIN (scheme + host + port) | RETAINED | credential-free and route-identity |
| PATH | RETAINED IN FULL | route identity under this repository's configuration contract; retaining it is what keeps a same-host / different-path pair two DISTINCT routes |

No raw credential-bearing URL is persisted. Nothing is hashed (an ordinary
unkeyed hash of a credential-bearing URL is not credential-free). No new
credential store and no identity service was introduced. When a trustworthy,
credential-free route identity cannot be established, the route **fails
closed**.

### 3.3 The scope of the claim (stated explicitly)

The authority establishes ROUTE identity only. It does not claim universal
account, model or conversation compatibility. The redacted-thinking successor
remains open and untouched.

## 4. The discriminators

No new test infrastructure was created. The EXISTING witnesses were extended.

### 4.1 A1 — the route-authority controls

| ID | Control | File | Result on the predecessor |
|---|---|---|---|
| A1 | an UNRESOLVED route records NO origin authority | agents witness | **RED** — `expected 'unresolved-route\u0000' to be undefined` |
| A1 | TWO unresolved routes do NOT share an authority | agents witness | **RED** — `expected 'unresolved-a\u0000' to be undefined` |
| A1 | an opaque payload issued by an UNRESOLVED route is NOT replayed to an UNRESOLVED destination | agents witness | **RED** — `expected '{"model":"claude-sonnet-4-6",…' not to contain 'synthetic-opaque-signature-aa11bb22'` |
| A1 | an EMPTY base URL produces NO authority | core witness | GREEN (the predecessor trimmed it away) |
| A1 | a WHITESPACE-ONLY base URL produces NO authority | core witness | GREEN |
| A1 | an INVALID base URL produces NO authority | core witness | **RED** — `expected 'anthropic\u0000not a url' to be undefined` |
| A1 | a MISSING / INVALID provider identity produces NO authority | core witness | GREEN |
| A1 | a VALID route produces a NONEMPTY authority and equal routes MATCH | core witness | GREEN (conservation) |

### 4.2 A2 — the credential controls

| ID | Control | Result on the predecessor |
|---|---|---|
| A2 | USER INFORMATION persists NO credential | **RED** — `expected 'anthropic\u0000https://user:SYNTHETIC…' to be undefined` |
| A2 | a CREDENTIAL-BEARING QUERY persists NO credential | **RED** — `expected 'anthropic\u0000https://api.anthropic.…' to be undefined` |
| A2 | a FRAGMENT persists NO credential | **RED** — `expected 'anthropic\u0000https://api.anthropic.…' to be undefined` |
| A2 | the PERSISTED record of a credential-bearing route carries NO credential | **RED** — `expected '[{"id":"msg__z_Uph4i",…' not to contain 'SYNTHETIC-CREDENTIAL-a1b2c3'` |
| A2 | a CREDENTIAL-BEARING PATH COMPONENT keeps the PATH and no other component | GREEN — the PATH is route identity, and the disposition is stated explicitly |
| A2 | the PERSISTED authority of an ordinary route carries NO credential | GREEN |

The credential is the obviously-fake synthetic value
`SYNTHETIC-CREDENTIAL-a1b2c3`. It is NOT a secret; it exists so the
discriminator can prove that a credential-bearing URL never reaches the
persisted record.

### 4.3 The acceptance authority is the PERSISTED block

The A2 discriminators observe the **persisted production content block**
(`agentMessageToMessageWithMetadata` → `JSON.stringify`), NOT merely the
outbound provider body. The A1 behavioural discriminator observes the
**captured outbound HTTP request body** produced by the real gateway, the
real translator, the real runtime and the real provider serializer.

### 4.4 The clean RED receipt (A3.4)

The A1 behavioural discriminator fails on the predecessor for exactly the
required reason — the foreign opaque payload reached the destination, NOT an
incorrect URL substring assertion:

```
AssertionError: expected '{"model":"claude-sonnet-4-6","max_tok…' not to contain 'synthetic-opaque-signature-aa11bb22'
```

The destination route WAS exercised (the request collection is asserted
non-empty before the loop), and the failure is the payload exclusion.

## 5. The corrected test oracles (A3)

| # | Correction | Where |
|---|---|---|
| 1 | The obsolete `__clineReasoningOrigin` exclusion assertion was replaced with an assertion against the ACTUAL `originAuthority` field | `provider-reasoning-continuity-runtime.test.ts` (RT2) |
| 2 | The compatible switch-back request collection is asserted NON-EMPTY before it is looped over | `provider-reasoning-session-restore.test.ts` (O4/O5) |
| 3 | O2 was EXTENDED with a same-host / different-path case (O2b) that asserts the ACTUAL requested PATH (`/tenant-b/v1/messages`) and the forbidden-payload exclusion on EVERY destination attempt | `provider-reasoning-continuity-runtime.test.ts` |
| 4 | The clean O2 predecessor RED receipt is preserved (section 4.4) | `provider-reasoning-continuity-runtime.test.ts` |
| 5 | The unused, eagerly evaluated `bodies` and `urls` capture arrays were REMOVED (they had no callers, and `calls.map(...)` at return time captured an EMPTY array) | `provider-reasoning-continuity-runtime.test.ts` |

No new test infrastructure was created. The shared `anthropicTurn` /
`plainTurn` fixtures were hoisted to module scope so the origin-authority and
unresolved-route discriminator groups share ONE fixture.

## 6. Scope freeze (A4)

UNCHANGED by this amendment:

- AgentRuntime block accumulation
- Reasoning effort
- The model catalog
- Compaction and PCK
- The provider registry architecture
- Redacted-thinking ingestion (the named successor ACT)
- Factory / Leamas

`git diff` over the affected production scope is two files:
`sdk/packages/llms/src/providers/ai-sdk.ts` and
`sdk/packages/shared/src/llms/messages.ts` (a documentation comment only).
`agent-message-codec.ts` is UNCHANGED by this amendment — the CORRECTION02
codec work is preserved untouched.

## 7. Executable verification

| # | Command | Exit | Result |
|---|---|---|---|
| V1 | `cd sdk/packages/agents && bun x vitest run src/provider-reasoning-continuity-runtime.test.ts` | 0 | **15/15 passed** (RT1-RT8, O1, O2, O2b, O3, O5, and the three A1 unresolved-route cases) |
| V2 | `cd sdk/packages/core && bun x vitest run src/runtime/config/` | 0 | **4 files, 47/47 passed** (RT7, the O4/O5 enforcement + switch-back case, and the nine A1/A2 authority cases) |
| V3 | `cd sdk/packages/llms && bun x vitest run src/providers/routing/ src/providers/gateway.test.ts src/providers/ai-sdk.test.ts src/providers/ai-sdk.tool-calls.test.ts src/providers/ai-sdk-transport-continuation.test.ts src/providers/ai-sdk-reasoning.test.ts` | 1 | **19 files, 499/514 passed**; the 15 failures are the IDENTICAL pre-existing `resolvePortableReasoning` baseline (verified by re-running on the predecessor) |
| V4 | `cd sdk/packages/llms && bun x tsc -p tsconfig.dev.json --noEmit` | 0 | **no diagnostics** |
| V5 | `cd sdk/packages/shared && bun x tsc --noEmit` | 0 | **no diagnostics** |
| V6 | `cd sdk/packages/agents && bun x tsc -p tsconfig.dev.json --noEmit` | 0 | **no diagnostics** |
| V7 | `cd sdk/packages/core && bun x tsc -p tsconfig.dev.json --noEmit` | 1 | **ZERO new diagnostics** — the sorted diagnostic set is byte-identical to the predecessor's (empty diff, 74 lines both sides) |
| V8 | `bun node_modules/@biomejs/biome/bin/biome check --diagnostic-level=error <the 5 changed files>` | 0 | **no findings** |

### 7.1 The ordinary gates (one run each, after the final production change)

| Package | Predecessor | With the correction | Failure-identity diff |
|---|---|---|---|
| `@cline/llms` | 19 failure identities | 19 failure identities | **EMPTY** (identical identities) |
| `@cline/agents` | 43 failed / 574 passed | 43 failed / **578** passed | the failure set is IDENTICAL; the 4 extra passes are the 4 new tests |
| `@cline/core` | 138 failed / 6187 passed | 139 failed / 6196 passed | ONE added identity: `src/extensions/plugin/plugin-registry.test.ts > PluginRegistry > times out and stops commands, rule content, and message builders` |

The one added core identity is a **LOAD-SENSITIVE PLUGIN-WORKER TIMEOUT
TEST**, entirely outside the reasoning / origin / codec path. It was proved
PRE-EXISTING: it fails IDENTICALLY on the predecessor when run in isolation
(`bun x vitest run src/extensions/plugin/plugin-registry.test.ts` → the same
`× times out and stops commands, rule content, and message builders` on both
sides). It is a wall-clock timeout under parallel load, not a behavioural
regression.

`ACT_OWNED_DIAGNOSTICS = NONE`

### 7.2 Secret scanning

The `gitleaks` binary is **NOT installed** in this environment
(`which gitleaks` → not found; no `node_modules/.bin/gitleaks`). The
repository's secret-scanning gate was therefore **NOT EXECUTED**, and the
**explicit NOT_EXECUTED disposition is retained** for the integration
environment.

The fixtures and the persisted authority were reviewed by hand: the only
credential-shaped values are the synthetic `SYNTHETIC-CREDENTIAL-a1b2c3` /
`supersecret` fixtures, every one of which is clearly artificial, is used only
to PROVE EXCLUSION, and never reaches a persisted record (the A2
discriminator asserts exactly that).

## 8. The bounded production correction

```
git diff c5ed60513ce8d0b2a38ec9b4372e5f70c2668576 -- \
  sdk/packages/llms/src/providers/ai-sdk.ts \
  sdk/packages/shared/src/llms/messages.ts
```

| File | Change |
|---|---|
| `sdk/packages/llms/src/providers/ai-sdk.ts` | the authority becomes `string \| undefined` (absence is explicit); the base URL is parsed and INSPECTED, and a credential-bearing or invalid URL produces NO authority; the route identity is the provider id + the URL origin + the URL path; the destination authority's VALUE may be `undefined` |
| `sdk/packages/shared/src/llms/messages.ts` | the `ThinkingContent.originAuthority` documentation records the new credential-free representation |

`sdk/packages/core/src/runtime/config/agent-message-codec.ts` and
`sdk/packages/agents/src/agent-runtime.ts` are **UNCHANGED** by this
amendment.
