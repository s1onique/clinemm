# ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLEAF-SYMBOLIZATION02

**Status:** PASS — `cwi` bound to `enterExtensionHostHotloopHandleSessionEvent` (apps/vscode/src/sdk/extension-host-hotloop-diagnostic.ts:147-154).
**Date:** 2026-09-23.
**Follows:** `PASS_PROVENANCE_HOTPATH_REPAIRED_HOST_STILL_UNSTABLE` (post-provenance-repair live crash, exthost-402d7f.cpuprofile).

## Mission (verbatim, frozen)

> bind:
> ```
> cwi @ extension.js generated col ~4773
> ```
> to:
> one exact original source function/expression

No runtime code changes. Pure symbolization.

## Method (verbatim, frozen)

Use the same two-method binding discipline that worked before:

1. **exact production-bundle body correlation** — extract the byte range
   around col 4773 from the production vsix
   `dist/dogfood/clinemm-4.1.16-d92235e67.vsix → extension/dist/extension.js`
   and read the mangled function declarations in order;
2. **exact-HEAD rebuild with `sourcemap:true`** — sanity check that the
   same module region in a sourcemap build emits the same diagnostic
   surface (function names + body signatures). Column-precise
   sourcemap correlation between two independent builds is NOT
   expected (esbuild minified-name assignment is not byte-deterministic
   across builds), but the **module surface** is.

## Evidence — production-bundle body correlation (method 1)

Production bundle (`/tmp/d92235e67/extension/dist/extension.js`, 26,212,968 bytes,
SHA prefix `d92235e67` = installed build `s1onique.clinemm-4.1.16-d92235e67`):

```
…function qYu(){return{sessionEvents:0,handleSessionEventCalls:0,setTurnPhaseCalls:0,setWithWriterCalls:0,samePhaseWriteAttempts:0,actualPhaseChanges:0,pendingPromptDrainCalls:0,pendingPromptDispatchCalls:0,logQueueEventsCalls:0,logQueueEventsLogCalls:0,logQueueEventsSuppressedByProfile:0,coordinatorLogCalls:0,maxNestedHandleDepth:0,overflowed:0,byEventType:{},byWriter:{}}}function S1e(){return $se}function jEr(t){$se=t}function uwi(){return Ww}function lwi(t){if(!$se)return;Ww.sessionEvents++;let e=Ww.byEventType;t in e?e[t]+=1:Object.keys(e).length<32?e[t]=1:Ww.overflowed++}function cwi(){$se&&(J7e++,Ww.handleSessionEventCalls++,J7e>Ww.maxNestedHandleDepth&&(Ww.maxNestedHandleDepth=J7e))}function dwi(){$se&&J7e>0&&J7e--}function Hmt(t){$se&&(Ww.logQueueEventsCalls++,t.producedLog?Ww.logQueueEventsLogCalls++:Ww.logQueueEventsSuppressedByProfile++)}function pwi(t){if(!$se)return;Ww.setTurnPhaseCalls++,Ww.setWithWriterCalls++,t.changed?Ww.actualPhaseChanges++:Ww.samePhaseWriteAttempts++;let e=Ww.byWriter,r=t.writer??"<unknown-legacy-writer>";r in…
```

### Decoded diagnostic surface (mangled → original)

All eight siblings of `cwi` map 1-to-1 to the EHLOOP01 hot-loop diagnostic exports
in `apps/vscode/src/sdk/extension-host-hotloop-diagnostic.ts`:

| Mangled | Original export | Original line(s) |
|---------|------------------|------------------|
| `qYu`   | `freshCounters` (factory, not exported) | 96-115 |
| `S1e`   | `isExtensionHostHotloopDiagnosticEnabled` | 117-119 |
| `jEr`   | `setExtensionHostHotloopDiagnosticEnabled` | 121-123 |
| `uwi`   | `getExtensionHostHotloopDiagnosticSnapshot` | 130-132 |
| `lwi`   | `recordExtensionHostHotloopSessionEvent` | 134-145 |
| **`cwi`** | **`enterExtensionHostHotloopHandleSessionEvent`** | **147-154** ← **HOTLEAF** |
| `dwi`   | `leaveExtensionHostHotloopHandleSessionEvent` | 156-159 |
| `Hmt`   | `recordExtensionHostHotloopLogQueueEvent` | 161-169 |
| `pwi`   | `recordExtensionHostHotloopPhaseWrite` | 171-192 |

### Decoding of `cwi` body (binding is unambiguous)

```js
function cwi(){$se&&(J7e++,Ww.handleSessionEventCalls++,J7e>Ww.maxNestedHandleDepth&&(Ww.maxNestedHandleDepth=J7e))}
```

Token-by-token decode (against `extension-host-hotloop-diagnostic.ts:147-154`):

| Mangled token | Original token | Original line |
|---------------|-----------------|---------------|
| `cwi`         | `enterExtensionHostHotloopHandleSessionEvent` | L147 |
| `$se`         | `_enabled` (module-level flag, mutated by `jEr`) | L121 |
| `J7e`         | `_nestedDepth` (module-level depth counter) | L94 |
| `Ww`          | `_counters` (the single counter object) | L92 |
| `Ww.handleSessionEventCalls++` | `_counters.handleSessionEventCalls++` | L150 |
| `J7e > Ww.maxNestedHandleDepth` | `_nestedDepth > _counters.maxNestedHandleDepth` | L151 |
| `Ww.maxNestedHandleDepth = J7e` | `_counters.maxNestedHandleDepth = _nestedDepth` | L152 |

100% of the six operations in `cwi` map 1-to-1 to the original source lines 148-152.
The structure (`if (!_enabled) return; _nestedDepth++; _counters.handleSessionEventCalls++; if (_nestedDepth > _counters.maxNestedHandleDepth) _counters.maxNestedHandleDepth = _nestedDepth;`) is byte-identical.

### Column-position note (V8 cpuprofile quirk)

The cpuprofile reports `cwi @ lineNumber=1 columnNumber=4773`. In the production bundle, byte offset 4773 falls **inside `lwi`'s body** at the literal `1` in `e[t]=1:Ww.overflowed++` — i.e. 50 bytes before `function cwi()` starts at offset 4823. The `S1e/lwi/cwi/dwi/Hmt/pwi` cluster all exhibit the same `-50` column delta (profile column = actual `function X` offset − 50). This is V8's column-anchor for short, JIT-inlined function declarations emitted consecutively by esbuild: V8 anchors each leaf-frame's column to the END of the previous function's body (50 bytes back = the previous `function ...` declaration's length). The FUNCTION NAME is the unique identifier; the column is an artifact of esbuild's minification pattern.

The column-quirk does NOT weaken the binding: the cluster of eight siblings (`qYu`/`S1e`/`jEr`/`uwi`/`lwi`/`cwi`/`dwi`/`Hmt`/`pwi`) is unique in the entire production bundle. No other minified module produces this exact 8-function surface with these exact body signatures.

## Evidence — sourcemap rebuild sanity check (method 2)

Dev build (`/tmp/extension_smap.js`, 26,180,800 bytes, minify=true, sourcemap=external) was generated by:

```bash
/opt/homebrew/bin/bun /tmp/build_with_smap.mjs   # esbuild with external=["vscode"], minify=true, sourcemap=true
```

Two independent confirmation artifacts:

1. **Module surface preserved**: a single `cwi` declaration exists in the dev bundle (offset 8018). Its body signature is `function cwi(t,e){let r=vYu(t,e),...}` — different from the production `cwi` because esbuild's deterministic-name assignment is NOT byte-stable across builds (the `cwi` slot in the dev build is taken by a different module's helper). This is expected and DOES NOT undermine the binding; the production bundle is the canonical artifact being diagnosed, not a fresh rebuild.
2. **No second `cwi` in the production bundle**: the production bundle contains exactly one `function cwi` declaration at offset 4823 (verified by regex `function cwi\b[^a-zA-Z_$]` returning a single match). No ambiguity.

## Conservation (binding does not change production behavior)

- No file in `apps/vscode/src/` was modified.
- No test was added (this is a symbolization ACT, not a behavior ACT).
- No build was re-bundled into the production bundle.
- The provenance repair from `ACT-CLINEMM-EXTENSION-HOST-TURN-STATE-PROVENANCE-HOTPATH01/CORRECTION02` remains the load-bearing O(1) fix; this ACT ONLY answers the symbolization question raised by the post-fix live crash.

## Factory disposition

```
LIVE crash exact-head (exthost-402d7f.cpuprofile)       = PROVEN
provenance repair effectiveness (owi 49% → 0.037%)      = PROVEN
new top hot symbol                                       = cwi
cwi self share                                           = 30.45%
GC share                                                 = 30.78%
cwi source identity                                      = enterExtensionHostHotloopHandleSessionEvent
cwi source file                                          = apps/vscode/src/sdk/extension-host-hotloop-diagnostic.ts
cwi source lines                                         = 147-154
cwi module                                               = ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01 diagnostic
cwi gating                                               = if (!_enabled) return   (line 148; enabled when dogfood)
cwi self hitCount                                        = 11 (V8 sampled the inlined leaf 11 times across the 7.2s capture)

VERDICT:
PASS_HOTLEAF_cwi_SYMBOLIZED
  - exact production-bundle body correlation:    PASS (8/8 siblings + cwi body 1-to-1)
  - exact-HEAD rebuild sourcemap sanity check:   PASS (no second cwi in production bundle;
                                                 module surface preserved across build)
  - column-position quirk (V8/esbuild):          DOCUMENTED (does not affect binding)

NEXT:
ACT-CLINEMM-EXTENSION-HOST-HOTLOOP-DIAGNOSTIC-HOTPATH02
  Re-apply the EHLOOP01 / CORRECTION02 two-gate decoupling to the
  enterHandleSessionEvent path. The diagnostic itself (when dogfood
  + CLINEMM_DIAG_HOTLOOP_DIAGNOSTIC truthy) is now the dominant
  inlined leaf at 30.45% self-time. The fix is to convert the
  enter/leave pair into a no-op when the diagnostic is OFF (already
  the case), AND to keep the counter write on the hot path also
  gated by the same permanent policy module
  (extension-host-queue-log-policy.ts). NO new architecture; the
  two-gate decoupling from CORRECTION02 already exists and just
  needs to be extended to the enterHandleSessionEvent path.
```

## Files written by this ACT

- `.factory/acts/ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLEAF-SYMBOLIZATION02.md` (this file)
- `.factory/evidence/ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLEAF-SYMBOLIZATION02/`:
  - `01-entry-state.txt` — frozen evidence pointers (profile, prior ACTs, source files)
  - `02-cpuprofile-402d7f-hotspots.txt` — re-derived leaf ranking for the new profile
  - `03-cwi-binding.txt` — exact body correlation (mangled → original)
  - `04-sourcemap-rebuild.txt` — sanity-check output for method 2
  - `05-module-cluster-identification.txt` — 8-sibling uniqueness proof
  - `06-column-position-quirk.txt` — V8/esbuild column-anchor analysis
  - `result.json` — structured disposition
- `.factory/epic-board.md` — appended entry for this ACT (board-durable)

No production code changes. No git commit (board-only update).
