# RED Report — ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01

> RED suite:
> `apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts`

## 1. RED test list

| ID  | Inputs (canonicalShadow / currentLegacy / seq)              | Expected (post-repair) phase / source | Pre-repair actual (HEAD = 7caca443b) | Status   |
| --- | ----------------------------------------------------------- | ------------------------------------- | ------------------------------------ | -------- |
| THCP11_RED                 | "idle" / "streaming" / 5           | "streaming" / "legacy"     | "idle" / "shadow"     | RED FAIL |
| THCP11_RED_INVERSE         | "streaming" / "completed" / 12     | "completed" / "legacy"     | "streaming" / "shadow" | RED FAIL |
| THCP11_RED_FRESH_SHADOW_PRESERVED | "streaming" / "streaming" / 5 | "streaming" / "shadow"     | "streaming" / "shadow" | PASS (conservation) |
| THCP11_THINKING_RED        | shadow(modelStreaming=false) / "streaming" / 5 | modelStreaming=true / "legacy" | modelStreaming=false / "shadow" | RED FAIL |

## 2. vitest run (2026-08-31, current HEAD)

```text
$ bun run test:vitest -- src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts

 RUN  v4.1.10 /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode

 ❯ src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts (4 tests | 3 failed) 5ms
     × THCP11_RED: stale shadow 'idle' MUST NOT override fresh legacy 'streaming' 3ms
     × THCP11_RED_INVERSE: stale shadow 'streaming' MUST NOT override fresh legacy 'completed' 0ms
     ✓ THCP11_RED_FRESH_SHADOW_PRESERVED 0ms
     × THCP11_THINKING_RED 1ms

 Test Files  1 failed (1)
      Tests  3 failed | 1 passed (4)
```

## 3. RED → causal discriminator

The three RED failures reproduce the exact contradiction documented
in entry-fact 4 (publication 15/17 of taskId 1788189447617_rw5zx):
`turnState.phase="streaming"` alongside
`taskHeaderPresentation.phase="idle"` from the same publication.

The fourth test (`THCP11_RED_FRESH_SHADOW_PRESERVED`) is the
conservation baseline — it MUST stay green after the repair,
proving the "shadow is authoritative when fresh" property is not
regressed by the fix.

## 4. RED → ablation expectation

The proposed repair adds ONE parameter — the shadow's
last-observation sequence — to `selectTaskHeaderPresentation` and
`selectThinkingPresentation`. With that parameter in scope:

- When `canonicalShadowSeq < seq` (shadow older than the last
  legacy transition), the legacy branch wins. RED goes GREEN.
- When `canonicalShadowSeq >= seq` (shadow fresh or equal), the
  shadow branch wins. THCP11_RED_FRESH_SHADOW_PRESERVED stays GREEN.

The ablation is implemented in `tcr01.ablation.test.ts` (next).
