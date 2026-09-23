# LIVE Qualification — ACT-CLINEMM-EXTENSION-HOST-WEBVIEW-STATE-SESSION-LISTING-REENUMERATION-REPAIR01

## Status

**LIVE_NOT_EXECUTED.** Per ACT §30 ("Required LIVE evidence") this ACT
would require a dogfood workload with `CLINEMM_DIAG_ALLOCATION_PROFILE=1`
to produce a fresh capture. The author sandbox does not have a VS Code
instance preinstalled with the env knob and the qualified background
notifier workload harness (see `apps/vscode/scripts/dogfood-runtime-*`
and the predecessor ACT's LIVE capture from `muei4q39-75147dd0af7aa000`).

This is a `CAPTURE_INSUFFICIENT` outcome for the LIVE qualification
half of the ACT. The composition half (RED/GREEN/conservation/allocation
shrinkage in the same process) is GREEN.

## Predecessor frozen LIVE baseline

```
listSessionsCalls                = 6
queryAllCalls                    = 18
readSessionManifestTitleCalls    = 894
distinctSessionIdsSeenInCapture  = 149
repeatReadsSameSessionId         = 745
byCaller.webview_state_projection = 6 / 6
installed build                  = 4.1.16-2a18ccea1
capture_id                       = muei4q39-75147dd0af7aa000
```

## Expected post-fix shape (with no session-history mutation after initial load)

The repair changes the cache contract from "fresh if age < 10 s" to
"fresh if (cache present) AND (age < 5 min)" with mutation authority
preserved at the existing 5 invalidation sites. In the LIVE
30-second workload, this collapses webview-triggered listSessions
cardinality from 6 to approximately 1 (no mutation) or 2 (one
legitimate mutation). The corresponding manifest-title reads collapse
from 894 to ~149 (no mutation) or ~298 (one mutation).

| Metric                                   |                Before | After (expected, no mutation) |
| ---------------------------------------- | --------------------: | ---------------------------: |
| webview projections causing listSessions |                     6 |                          ~1 |
| listSessions calls                       |                     6 |                          ~1 |
| manifest-title reads                     |                   894 |                         ~149 |
| sampled bytes under listSessions         |              baseline |               material drop |

These are **expected** numbers. They have not been measured against a
fresh dogfood capture in this environment.

## Host responsiveness

Cannot be evaluated without a LIVE capture. Per ACT §31, if the
cardinality collapse is observed but the host still becomes
unresponsive, the verdict becomes `PASS_SESSION_LISTING_REPAIR_EFFECTIVE_HOST_FAILURE_REMAINS`
and the next ACT is `ACT-CLINEMM-EXTENSION-HOST-I_-HOTLEAF-SYMBOLIZATION01`
(to symbolize the remaining minified `i_` hot signal from the CPU
profile).

## What the next operator should do

1. Build the post-fix VSIX from this branch (HEAD = current working
   tree).
2. Launch with the qualified env:
   ```
   CLINEMM_RUNTIME_PROFILE=dogfood \
   CLINEMM_PTAD=1 \
   CLINEMM_DIAG_ALLOCATION_PROFILE=1 \
   codium-clinemm
   ```
4. Execute the background-notify workload:
   ```
   sh -c 'echo STARTED; sleep 30; echo FINISHED'
   ```
5. Wait 30 seconds; collect the latest `*.meta.json` and `*.heapprofile.json`.
6. Compare the post-fix capture against the predecessor's frozen
   baseline. Pass criterion: webview_triggered listSessions cardinality
   collapses materially (from 6 toward 1) AND the
   `listSessions`/`readSessionManifestTitle` allocation subtree
   shrinks materially in the heapprofile.
