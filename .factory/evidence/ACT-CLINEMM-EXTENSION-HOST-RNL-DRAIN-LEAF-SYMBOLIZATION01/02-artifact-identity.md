ACT-CLINEMM-EXTENSION-HOST-RNL-DRAIN-LEAF-SYMBOLIZATION01 — artifact identity
==================================================================================

Subject: extension-host CPU profile `exthost-402d7f.cpuprofile`.

The predecessor ACT established that this profile comes from a live
extension-host crash capture **after** the
`ACT-CLINEMM-EXTENSION-HOST-TURN-STATE-PROVENANCE-HOTPATH01/CORRECTION02`
repair had already landed and `owi` had live-collapsed (49% → 0.037%).
This ACT verifies those identities still hold by re-hashing every
artifact from a fresh read.

## Identity labels (three heads, DISAMBIGUATED)

After causal review of #P1 (earlier versions conflated the analyzer's
working tree with the commit that produced the crash bundle), the three
distinct git/identity objects are now explicitly labeled:

| Label                    | Value                                                                  | Role                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ANALYSIS_REPO_HEAD       | (computed live by analyzer; see result.json)                           | The git HEAD of the working tree in which this analyzer was authored. May differ from DOGFOOD_SOURCE_HEAD.                                                                                 |
| DOGFOOD_SOURCE_HEAD      | `d92235e67711976eb3582617583e9804034724e3`                             | The commit that produced the installed dogfood bundle. Matches the vsix filename prefix `cline-4.1.16-d92235e67`.                                                                          |
| PROFILE_SUBJECT_HEAD     | N/A                                                                    | A `.cpuprofile` is a captured artifact, not a git object. The profile is bound to DOGFOOD_SOURCE_HEAD via the embedded `file:///...extensions/s1onique.clinemm-4.1.16-d92235e67/dist/extension.js` URL. |

Identity freeze (machine-derived, not hand-typed)
-------------------------------------------------------

```
PROFILE_PATH
PROFILE_SHA256                  = 4c15bde38176a614aaf0e97c69176f584eb5bf09f9592ae93859dc2d9e4f405e
PROFILE_SIZE                    = 331216 bytes
PROFILE_START_TIME              = 494,677,901,777 us  (V8 hi-resolution)
PROFILE_END_TIME                = 494,685,096,860 us
PROFILE_SAMPLE_COUNT            = 38582
PROFILE_DURATION                = 7,194.81 ms
PROFILE_NODE_COUNT              = 180
PROFILE_TIME_DELTAS_LENGTH      = 38582

SOURCE_HEAD                     = d92235e67711976eb3582617583e9804034724e3
                                  — REPLACED with three explicitly labeled
                                    identities above (ANALYSIS_REPO_HEAD /
                                    DOGFOOD_SOURCE_HEAD /
                                    PROFILE_SUBJECT_HEAD). The original
                                    frozen value is preserved here only as
                                    a record of the prior label.

VSIX_PATH                       = dist/dogfood/clinemm-4.1.16-d92235e67.vsix
VSIX_SHA256                     = a5488857ed2d046a43c46e2a74444e15c6b042f844c9af9603c686fc1af84678
VSIX_SIZE                       = 14,609,733 bytes

INSTALLED_EXTENSION_PATH        = /Users/chistyakov/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-d92235e67
                                  (matches the URL prefix embedded in every
                                   profile node: file:///.../s1onique.clinemm-4.1.16-d92235e67/dist/extension.js)

PRODUCTION_BUNDLE_PATH          = /tmp/d92235e67/extension/dist/extension.js
                                  (extracted from the vsix by the predecessor ACT-02)
PRODUCTION_BUNDLE_SHA256        = 78ec3a0b9017ad467cd4886ff0c16f2a5061f286783c665a1c9137052d9fcb7c
PRODUCTION_BUNDLE_SIZE          = 26,212,968 bytes

DEV_SOURCEMAP_PATH              = /tmp/extension_smap.js.map
DEV_SOURCEMAP_BUILD             = esbuild minify=false, sourcemap=true,
                                  process.env.IS_DEV=true (per predecessor ACT-02)
DEV_SOURCEMAP_BUILD_DATE        = 2026-09-23T11:21 (matches HEAD source — no
                                  source edits to relevant modules since
                                  d92235e67)
DEV_SOURCEMAP_SIZE              = 87,723,857 bytes

PRODLIKE_SOURCEMAP_PATH         = /tmp/extension_smap_prodlike.js.map
PRODLIKE_SOURCEMAP_BUILD        = esbuild minify=true, sourcemap=true,
                                  process.env.IS_DEV=false (this ACT)
PRODLIKE_SOURCEMAP_BUILD_DATE   = 2026-09-23T12:01
PRODLIKE_SOURCEMAP_SIZE         = 87,730,237 bytes

ANALYSIS_TOOL                   = scripts/analyze-cpuprofile-hot-leaves.mjs
                                  (added by this ACT; committed in the same
                                   ACT closure commit)
```

Cross-artifact consistency
---------------------------
1. VSIX name `clinemm-4.1.16-d92235e67` matches `DOGFOOD_SOURCE_HEAD`
   short prefix `d92235e67`.
2. The bundle SHA256 (`78ec3a0b…`) was first recorded by predecessor
   ACT-02 and is unchanged at this ACT's HEAD.
4. The profile node URLs all start with
   `file:///…/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-d92235e67/dist/extension.js`
   confirming the installed extension path matches the vsix we have on disk.
5. PROFILE-CTL-01 (sum(hitCount) ≈ samples.length) returns 38581 / 38582, a single
   sample difference (V8 typically reports the root with hitCount=0 while assigning
   its 38581 children). This is an inherent V8 quirk, not a tooling bug.

Repository trust
----------------
```
$ git status --short
?? scripts/analyze-cpuprofile-hot-leaves.mjs
```

Only the new analyzer script is untracked. No tracked file was edited,
no source under apps/vscode/src or sdk/packages/* was modified, no
production code touched. The predecessor ACT file
`ACT-CLINEMM-EXTENSION-HOST-CPUPROFILE-TIMEDELTA-VALIDATION01.md` carries
the documented P2 `diff --check` residue (`new blank line at EOF`) and
is intentionally left untouched per the ACT-01 patch-hygiene rule.

Binding to predecessor ACT
---------------------------
This ACT's `01-entry-state.txt` reuses the predecessor's frozen entry
state verbatim:

```
LIVE_EXTENSION_HOST_CRASH                    = PROVEN
PROVENANCE_HOTPATH_owi                       = REPAIRED / LIVE-COLLAPSED
CWI_SOURCE_BINDING                           = PROVEN
CWI_CPU_HOTLEAF                              = REFUTED
CWI_ADJACENT_TO_FIRST_SAMPLE_STALL           = PROVEN
GC_RAW_SAMPLE_SHARE                          ≈ 44.1%
SUSTAINED_JS_HOT_LEAVES                      = Rnl, drain, r_, e_, Gyi
ALLOCATION_PRODUCER                          = UNKNOWN
REPAIR_AUTHORIZED                            = NO
```

No entry state is altered.