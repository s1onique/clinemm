# ACT-CLINEMM-M31-CATALOG-SNAPSHOT-REFRESH01 — PASS_STRUCTURAL_ONLY

**Status:** CLOSED with verdict **`PASS_STRUCTURAL_ONLY`**.

**ENTRY_HEAD / SOURCE_HEAD:** `62cfffea7b86d94657e0efcf8bb284857841e342` (main).

**Why this ACT exists.** The bundled MiniMax model catalog did not publish the
exact production model id `MiniMax-M3.1-Flash`. Upstream (models.dev) does
publish it, so the bundled snapshot was missing an upstream-authoritative entry
that the live MiniMax API accepts.

**The contract.** Add EXACTLY ONE upstream-authoritative entry to
`sdk/packages/llms/src/catalog/catalog.generated.ts`. Change nothing else.
Do not modify the permanent generator.

---

## C1 — Why a full regeneration was refused

`bun -F @cline/llms generate:models` rewrites the ENTIRE catalog from the live
payload. Measured against this snapshot that is ~6,271 changed model entries
across ~204 providers, and it DROPS the MiniMax M2.x records that upstream has
since marked `deprecated` while the checked-in snapshot still publishes them.
The refresh therefore had to be bounded.

`bun -F @cline/llms generate:models --providers=minimax` does NOT forward the
flag as expected and triggers the same full regeneration. It was not used.

## C2 — How the single entry was derived

`refresh-minimax-m31-flash.ts` (this directory) derives the entry with the
REAL production normalizer —
`sdk/packages/llms/src/catalog/catalog-live.ts :: normalizeModelsDevProviderModels`
— and never re-implements the models.dev → `ModelInfo` mapping.

The helper proves three things before it writes anything:

1. **The normalizer is run twice** — once on the full upstream payload, once on
   a payload scoped to `minimax` — and the two normalized `minimax` results are
   IDENTICAL. Scoping does not change the derived entry.
2. **The checked-in providers JSON round-trips** through the generator's own
   serialization shape (`JSON.stringify(value, null, 2)`), so the refreshed file
   is in the generator's format, not a hand-written approximation.
3. **The delta is exactly one model**: zero model ids added other than
   `MiniMax-M3.1-Flash`, zero removed, and every other model byte-identical.

The helper is a one-off evidence tool. It is NOT product code, and the
permanent generator is UNCHANGED.

### Reproducibility and idempotence

- **Reproducible from HEAD.** `catalog.generated.ts` was restored from `HEAD`
  and the helper re-run with `--apply`. Two independent runs produce
  **semantically identical providers JSON**; the only difference between them
  is the generation timestamp (the version marker), which the generator always
  advances.
- **Idempotent.** Re-running the helper on an already-refreshed snapshot is a
  verified **NO-OP**: it compares the existing entry against the freshly derived
  one and refuses to continue if they differ, so it can never double-insert or
  silently rewrite the entry.


## C3 — Upstream provenance

```text
url             https://models.dev/api.json
retrievedAt     2026-10-29T11:43:24.088Z
payloadBytes    5,940,980
payloadSha256   666dfc620821827f07c3ef274b14899691aec4d1e7a8da0d5db02d27a8d5613e
providerKey     minimax
modelId         MiniMax-M3.1-Flash
```

The full raw upstream record and the derived entry are recorded in
`provenance.json`.

## C4 — The published entry

```text
id              MiniMax-M3.1-Flash
name            MiniMax-M3.1-Flash
contextWindow   1,000,000     (NOT 1,048,576)
maxInputTokens  1,000,000
maxTokens       524,288
releaseDate     2026-10-19
family          minimax
pricing.input       0.15
pricing.output      0.6
pricing.cacheRead   0.015
pricing.cacheWrite  0
reasoningOptions    [{ type: "effort", values: [low, medium, high, xhigh, max] }]
capabilities        [images, video, tools, reasoning, temperature, prompt-cache]
```

No price was fabricated — every value above is upstream's own.

## C5 — Conservation proof

Measured by re-parsing the committed file against `HEAD`'s copy:

```text
providers before / after        191 / 191
provider key sets identical     True
models before / after           5702 / 5703
ADDED (provider, model)         [('minimax', 'MiniMax-M3.1-Flash')]
REMOVED (provider, model)       []
models whose content changed    []
every NON-minimax provider      byte-identical
minimax pre-existing entries    unchanged
```

The generated-file diff is `36 insertions(+), 1 deletion(-)` — the 35-line
entry plus the generation-timestamp line the generator always advances.


## C6 — Gates

| Gate | Result |
| --- | --- |
| New focused witness `catalog-m31-flash-snapshot01.test.ts` | **4/4 PASS** |
| Full `@cline/llms` package suite | **49 files passed / 4 skipped; 790 passed / 4 skipped / 0 failed** (was 786; +4 = the new witness) |
| Existing MiniMax witnesses (exact-ID, unregistered, unsupported-off, wire, probe) | **34/34 PASS** |
| `@cline/llms` typecheck | **PASS** |
| `@cline/llms` build | **PASS** |
| Biome check on the new witness | **PASS** |
| `apps/vscode` model-catalog suites (excluding the pre-existing probe) | **10 files / 156 PASS** |

### The pre-existing untracked probe is NOT addressed here

`apps/vscode/src/sdk/model-catalog/startup-model-metadata-authority.m31smma01.test.ts`
is an UNTRACKED probe that existed before this ACT and is OUT OF SCOPE for it.
It fails 8/9 — and it fails **identically with this ACT's catalog change
reverted** (the catalog was temporarily restored to `HEAD` and the same 8
failures were observed). It is therefore a baseline condition, not a regression
introduced by this ACT. The probe is PRESERVED, unmodified, and uncommitted.

### A `--pool=threads` artifact, not a regression

`src/providers/gateway.test.ts` fails under `--pool=threads` with
`TypeError: process.chdir() is not supported in workers`. Under the default
forks pool the same file passes **154/154**. The full suite above was measured
with the default pool.

## C7 — What is NOT claimed

- No VSIX was built or installed, so the **installed artifact is not
  exact-head**. The result is source-level only.
- No live MiniMax API call was made by this ACT. The upstream provenance is
  the models.dev catalog, which is the authority this ACT binds to.
- The permanent generator was **not** changed. A future full regeneration will
  still rewrite the whole catalog; that remains an open, separate concern.

## Evidence

- `provenance.json` — upstream URL, retrieval time, payload SHA-256, the raw
  upstream record, the derived entry, and the conservation measurements.
- `refresh-minimax-m31-flash.ts` — the one-off bounded refresh helper.
- `SHA256SUMS` — checksums for the two files above.
- `sdk/packages/llms/src/catalog/catalog-m31-flash-snapshot01.test.ts` — the
  focused witness (committed with the change).
