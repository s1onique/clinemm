# 06 — CORRECTION02: the reasoning origin authority

**ACT:** `ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION02`
**Verdict:** `GO_PROVIDER_REASONING_REPAIR_INTEGRATION`

---

## 1. What remained open

CORRECTION01 recorded the issuing provider id and permitted replay when the
origin was unknown:

```typescript
const sameOrigin =
    typeof origin !== "string" ||
    options?.requestProviderId === undefined ||
    origin === options.requestProviderId;
```

That predicate grants authority on BOTH fail-open branches:

| Branch | CORRECTION01 | Consequence |
|---|---|---|
| Missing issuing origin | REPLAY | an originless opaque payload crossed the boundary |
| Missing destination identity | REPLAY | a destination that cannot be identified still received the payload |
| Equal provider id, DIFFERENT endpoint | REPLAY | a regional / self-hosted / proxied endpoint under the same provider id received another endpoint's opaque metadata |

## 2. The discriminators

All discriminators extend the EXISTING witnesses. No new test infrastructure
was created.

**File:** `sdk/packages/agents/src/provider-reasoning-continuity-runtime.test.ts`
(the real-runtime witness; the capture helper now records `{url, body}`)

**File:** `sdk/packages/core/src/runtime/config/provider-reasoning-session-restore.test.ts`
(the production codec + production `restore()` witness)

| ID | Case | Result on the predecessor |
|---|---|---|
| O1 | An originless opaque reasoning payload through the production outbound path | **RED** — the payload crossed the unestablished boundary |
| O2 | The SAME provider id on a DIFFERENT endpoint | **RED** — the foreign signature reached the other endpoint |
| O3 | The REVERSE direction (MiniMax -> native Anthropic) | GREEN (the provider-id check covered it) |
| O4 | The origin metadata survives the production persistence codec, the production restoration codec and `AgentRuntime.restore()`; then an incompatible destination | **RED** — the codec DROPPED the origin, so the restored payload was unauthorized |
| O5 | Same-origin compatible signed reasoning still reaches the wire byte-for-byte | GREEN (conservation) |

### 2.1 The RED receipts (verbatim)

O1 and O2, against the predecessor:

```
AssertionError: expected '{"model":"claude-sonnet-4-6","max_tok…' not to contain 'synthetic-opaque-signature-aa11bb22'
AssertionError: expected 'https://eu.api.anthropic.com/v1/messa…' not to contain 'api.anthropic.com/v1'
```

The second assertion shows the EFFECTIVE destination URL
`https://eu.api.anthropic.com/v1/messages` — the distinct endpoint really
was exercised.

O4, against the predecessor, with the corrected fail-closed policy and the
UNMODIFIED codec:

```
AssertionError: expected [] to deeply equal [ { type: 'thinking', …(2) } ]
```

The restored reasoning no longer reached the wire because the production
codec had dropped the origin, leaving the payload unauthorized.

## 3. The bounded repair

### 3.1 The origin AUTHORITY (A2)

The origin is no longer a bare provider id. It identifies the **effective
route**:

```typescript
function buildReasoningOriginAuthority(input: {
    providerId: string;
    baseUrl: string | undefined;
}): string {
    const endpoint = input.baseUrl?.trim().replace(/\/+$/, "");
    return endpoint
        ? `${input.providerId}\u0000${endpoint}`
        : `${input.providerId}\u0000`;
}
```

- `context.config.baseUrl` is the **RESOLVED** endpoint. The registry
  resolves it as `config?.baseUrl ?? resolveApiLineBaseUrl(options) ??
  record.defaults?.baseUrl`, so the API-line variant (MiniMax's China vs
  international endpoint) is already applied. This is the EXISTING trusted
  endpoint identity — no new registry, identity framework or migration
  subsystem was created.
- The full base URL is used, **including its path**: the Anthropic adapter
  builds its effective request URL as `${baseURL}/messages`, so the path IS
  part of the route. Two endpoints that share a hostname and differ only by
  path are therefore distinct trust domains.
- Only trailing slashes are normalized, so `/v1` and `/v1/` are the same
  route while `/v1` and `/v2` are not.
- The two parts are joined with `\u0000`, which cannot occur in either, so
  the composite cannot be forged by moving characters between them.

**CREDENTIAL FREEDOM.** The API key is a separate configuration field
(`GatewayProviderSettings.apiKey` / `apiKeyEnv`) and is never part of the
base URL. The persisted authority therefore carries no credential, no
authorization header and no credential-bearing URL.

**THE ACTUAL GUARANTEE AND ITS LIMITATION.** The authority establishes the
ROUTE that issued a payload, and an opaque payload is replayed only when
the issuing route and the destination route are the SAME route. It does NOT
prove every account-, model- or conversation-level compatibility condition
a provider may require; it is the strongest cheap, existing,
credential-free route identity the repository has. No account-discovery
service, network probing or universal provider compatibility registry was
introduced.

### 3.2 Fail closed on every branch (A1)

```typescript
function mayReplayOpaqueReasoning(input: {
    origin: unknown;
    destinationAuthority: string;
}): boolean {
    if (typeof input.origin !== "string" || input.origin.length === 0) {
        return false;
    }
    if (
        typeof input.destinationAuthority !== "string" ||
        input.destinationAuthority.length === 0
    ) {
        return false;
    }
    return input.origin === input.destinationAuthority;
}
```

| Branch | Authority |
|---|---|
| Missing issuing origin | NONE |
| Malformed issuing origin | NONE |
| Missing destination identity | NONE |
| Malformed destination identity | NONE |
| Known incompatible origins | NONE |
| Positively established compatible origins | REPLAY (exact) |

### 3.3 The destination identity is REQUIRED (A1)

`toAiSdkMessages`'s `options` is now a REQUIRED parameter and its
`destinationAuthority` field is REQUIRED. The single caller
(`buildAiSdkRequestMessages`, `ai-sdk.ts:415`) establishes it at the
request-construction boundary.

**CALLER INVENTORY.** `toAiSdkMessages` has exactly ONE production caller:

```
$ grep -n "toAiSdkMessages(" sdk/packages/llms/src/providers/ai-sdk.ts
415:	const aiMessages = toAiSdkMessages(request.messages, systemPrompt, {
758:function toAiSdkMessages(
```

There is therefore no reachable production caller that can bypass the
authorization by omitting the destination information, and no permissive
fallback was added. `systemPrompt` was made explicitly `string | undefined`
so the required `options` parameter may follow it.

### 3.4 The origin survives persistence and restoration (A4)

The production codec previously read ONLY `signature` and `details` from a
reasoning part's metadata, so the origin was DROPPED on persistence.

The smallest backward-compatible correction at the codec boundary:

- `ThinkingContent.originAuthority?: string` (new, OPTIONAL, credential-free)
- the codec PRESERVES it in both directions:
  - persistence: `agentPartToContentBlock` writes `originAuthority`,
  - restoration: `contentBlockToAgentPart` reads it back into the part's
    metadata.

The metadata key is the SAME one the llms extractor writes
(`originAuthority`), so there is a single representation and no translation
step.

**Stored history is NOT mutated.** The authorization is enforced at the
OUTBOUND PROJECTION only: the originless stored record is left exactly as
it is, and the projection withholds the opaque payload for a destination
that cannot accept it.

### 3.5 The internal bookkeeping never enters the wire (A3)

The `originAuthority` is READ ONLY by the outbound projection and is not
part of any provider's wire shape. The witness asserts it:

```typescript
expect(JSON.stringify(calls[1].body)).not.toContain("__clineReasoningOrigin");
```

(the key was renamed to `originAuthority`, which is now asserted by the
codec round-trip case rather than by a "not present" string check — see
section 6).

### 3.6 The portable-reasoning policy is unchanged

The gate applies ONLY to the opaque payload. The reasoning TEXT is never
gated: it is preserved on every path, including the originless one. The
existing portable-reasoning policy for ordinary reasoning text is untouched
and its disclosure scope was NOT expanded.

## 4. Scope freeze

The CORRECTION01 runtime block-identity correction, the shared event
extension, the reasoning metadata extraction and the restoration of the
original tool-call metadata scope are all UNCHANGED by this correction.
Reasoning effort and the model catalog are untouched; compaction and PCK
are untouched; the provider registry and the transport selection architecture
are untouched; the redacted-thinking stream ingestion remains the named
successor.

## 5. The verification of the destinations (A3)

The capture helper now records `{url, body}` for EVERY attempt, and the
discriminators assert:

1. the intended SOURCE endpoint was exercised — by comparing the HOST of
   the effective URL, not a substring (`"eu.api.anthropic.com"` CONTAINS
   `"api.anthropic.com"`);
2. the intended DESTINATION endpoint was exercised;
3. AT LEAST ONE destination request occurred
   (`expect(calls.length).toBeGreaterThanOrEqual(1)`) — a negative
   assertion against an absent request is never accepted;
4. EVERY incompatible destination request excludes the forbidden opaque
   payload (the assertion loops over ALL captured calls, not only the
   last);
5. EVERY required compatible continuation preserves the expected signed
   blocks.

The principal transcript is NOT manually constructed: the runtime builds it,
and the destination receives it through `AgentRuntime.restore()`.

## 6. Legacy fixture conservation (A4)

The fail-closed policy exposes fixtures that construct signed reasoning
parts without production provenance. They were classified individually:

| Fixture | Classification | Disposition |
|---|---|---|
| The `reasoning-delta` events in the llms-level suites | They exercise the TRANSLATOR, not the outbound authorization | unaffected — the translator still extracts and forwards |
| `minimax-reasoning-conservation-p0-01.test.ts` (R2, R4, R10) | Same-origin gateway-level cases | unaffected — they do not cross an origin boundary |
| `minimax-reasoning-origins-p0-01.test.ts` (R6/R7/R8) | Native-Anthropic cases | unaffected |
| The `agent-message-codec.test.ts` Gemini case | A tool-call thought signature | unaffected — the tool-call scope is unchanged |

No fixture was deleted and no global exemption for originless reasoning was
introduced. The production authorization policy was NOT weakened to preserve
an obsolete fixture: where a fixture represents legitimately compatible
signed history, it now obtains trustworthy synthetic provenance through the
production capture path (the real-runtime witness) or through the
production codec (the core witness).

## 7. Necessity (ablation)

**Ablation F** — the fail-closed origin check is disabled:

```
✓ RT1 ... ✓ RT2 ... ✓ RT3 ... ✓ RT4 ... ✓ RT5 ... ✓ RT6
× RT8: a native Anthropic signature does not cross into a MiniMax-origin request
× O1: an originless opaque reasoning payload is NOT replayed
× O2: the SAME provider id on a DIFFERENT endpoint does not replay the opaque payload
× O3: the REVERSE direction (MiniMax -> native Anthropic) does not replay
✓ O5: same-origin compatible signed reasoning still reaches the wire byte-for-byte
```

RED restored on four cases; the same-origin conservation case stayed GREEN.

**`ORIGIN_CORRECTION_NECESSITY = PROVEN`**

## 8. Executable verification

| # | Command | Exit | Result |
|---|---|---|---|
| V1 | `cd sdk/packages/agents && bun x vitest run src/provider-reasoning-continuity-runtime.test.ts` | 0 | **11/11 passed** (RT1-RT8, O1, O2, O3, O5) |
| V2 | `cd sdk/packages/core && bun x vitest run src/runtime/config/` | 0 | **4 files, 37/37 passed** (RT7 + the O4/O5 enforcement and switch-back case) |
| V3 | `cd sdk/packages/llms && bun x vitest run src/providers/routing/ src/providers/gateway.test.ts src/providers/ai-sdk.test.ts src/providers/ai-sdk.tool-calls.test.ts src/providers/ai-sdk-transport-continuation.test.ts` | 0 | **19 files, 481/481 passed** |
| V4 | `cd sdk/packages/agents && bun x vitest run` (ordinary gate) | 1 | 44 failed / 573 passed — the failure IDENTITIES are **IDENTICAL** to the CORRECTION01 baseline (empty `comm` diff both ways) |
| V5 | `cd sdk/packages/llms && bun x vitest run` (ordinary gate) | 1 | 15 failed / 1189 passed — the failure identities are **IDENTICAL** to the committed-predecessor baseline (verified by checking the predecessor's committed sources out and re-running) |
| V6 | `cd sdk/packages/core && bun x vitest run` (ordinary gate) | 1 | 186 failed / 6088 passed — the failure identities are **IDENTICAL** to the pristine-config baseline (190 identity entries in both, empty diff) |
| V7 | `node …/tsc -p tsconfig.dev.json --noEmit` in `llms` / `agents` / `core` | — | **ZERO new diagnostics** vs the baseline (sorted diagnostic sets diff empty for agents and core; llms clean) |
| V8 | `node …/@biomejs/biome/bin/biome check --diagnostic-level=error <changed files>` | 0 | no findings |

### 8.1 Baseline failures, reported by identity

| Package | Failures | Baseline comparison |
|---|---|---|
| `@cline/llms` | 15 | the SAME 15 identities fail on the committed predecessor (`ai-sdk-reasoning.test.ts`, `resolvePortableReasoning`) |
| `@cline/agents` | 44 | the SAME 44 identities fail on the CORRECTION01 baseline |
| `@cline/core` | 186 | the SAME 190 identity entries fail on the pristine-config baseline |

None is in the reasoning / origin / codec path.

`ACT_OWNED_DIAGNOSTICS = NONE`

### 8.2 Secret scanning

The gitleaks binary is NOT installed in this environment, so the
repository's secret-scanning gate was **NOT EXECUTED**. The fixtures and the
persisted origin authority were reviewed by hand: the authority is
`providerId \u0000 baseUrl`, the API key is a separate configuration field,
and every fixture value is clearly artificial and non-secret.

## 9. The bounded production correction

```
git diff 0524b32afca587e9750a0dcc2b891ccc62cbc0a0 HEAD -- \
  sdk/packages/llms/src/providers/ai-sdk.ts \
  sdk/packages/agents/src/agent-runtime.ts \
  sdk/packages/shared/src/agent.ts \
  sdk/packages/core/src/runtime/config/
```

| File | Change |
|---|---|
| `sdk/packages/llms/src/providers/ai-sdk.ts` | the origin becomes the effective-route AUTHORITY; the destination authority is REQUIRED; the authorization fails closed on every branch |
| `sdk/packages/shared/src/llms/messages.ts` | `ThinkingContent.originAuthority?: string` — the credential-free, optional, backward-compatible persisted field |
| `sdk/packages/core/src/runtime/config/agent-message-codec.ts` | the codec PRESERVES the origin authority in both directions |

`sdk/packages/agents/src/agent-runtime.ts` and
`sdk/packages/shared/src/agent.ts` are UNCHANGED by this correction (the
CORRECTION01 block-identity work is preserved untouched).
