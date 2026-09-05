# 04 — UI Model Indicator Chain (Q4)

This file answers ACT §5's "rendered model/provider label → ExtensionState
/ RPC source → session/config source → actual runtime/provider handler"
trace for the live UX target `minimax:MiniMax-M3`.

PRODUCTION HEAD = 97f49582e

## What the footer label currently represents

The footer label is rendered by the chat view from
`apiConfiguration` fields pushed via state.postStateToWebview.
There is NO footer-specific RPC. The chain is:

```text
webview:
  useExtensionState().apiConfiguration
  → chat-view footer reads `apiConfiguration.{planModeApiProvider,actModeApiProvider}`
    + `apiConfiguration.{planModeXModelId,actModeXModelId}` (per-provider)
  → renders "<provider>:<model>"
```

## Truth of the displayed label

| Source                                         | Latency              | Authoritative for what?                  |
|------------------------------------------------|----------------------|------------------------------------------|
| `apiConfiguration.{plan,act}ModeApiProvider`   | after postState      | which provider the next session starts with |
| `apiConfiguration.{plan,act}ModeXModelId`      | after postState      | which model the next session uses        |
| `session.startResult.manifest.{provider,model}`| always (live session)| what the SESSION was started with        |
| `session.startConfig.{providerId,modelId}`     | always (live session)| what the SESSION was started with (fallback) |
| `task.api.getModel().id`                       | runtime truth        | the model the current model handler uses  |

## What it means to "show the current model"

In the webview today there are three observable "model" values, and they
can disagree transiently:

1.  The Settings selection (`apiConfiguration` pushed via postState).
2.  The session-stored model (`session.startResult.manifest.model` or
    `session.startConfig.modelId`).
3.  The runtime model handler's current model (`task.api.getModel().id`).

`SdkController.getTaskModelId() ?? getSessionModelId()`
(`apps/vscode/src/sdk/SdkController.ts:2558, 2573`) is the canonical
resolver used by error/telemetry side-channels. The webview footer
itself does NOT use this resolver — it reads from
`apiConfiguration` directly.

## Implication for Model Profiles

The footer label is **driven by state, not by session** today. After a
profile is applied:

-   If `commitSelection` runs, it writes state (`apiConfiguration`)
    and `postStateToWebview()` is called.
-   The footer will reflect the NEW label as soon as the webview
    receives the postState.
-   The actual runtime model will change on the NEXT request via
    `updateSessionConnection` (in-place) or after the session restart
    (provider change).

So **the footer label and the runtime model converge in O(next-request)**
when the active provider matches. When the active provider differs and
the session restarts, the label and runtime converge in
O(replaceActiveSession completion) — also fast, but a discrete hop.

The model picker MUST NOT update the global selection while leaving the
active runtime unchanged. This is what `commitSelection` already
guarantees (state write + postState is always paired with the in-place
or restart path). The implementation ACT must keep this invariant.

## Freeze

```text
FOOTER_LABEL_REPRESENTATION          = apiConfiguration.{plan,act}ModeApiProvider
                                        + apiConfiguration.{plan,act}ModeXModelId
FOOTER_UPDATE_TRIGGER                = postStateToWebview (after every commitSelection
                                        or updateApiConfiguration* call)
FOOTER_CONVERGENCE_GUARANTEE         = O(next request) for same-provider switch
                                        O(replaceActiveSession) for provider switch
NEVER_MUTATE_INFLIGHT_REQUEST        = YES (orchestrator: "subsequent runs" comment)
```

EVIDENCE CLASS = STRUCTURAL. NOT_EXECUTED for a real click trace.
                 The convergence guarantee is INFERRED from the
                 commitSelection handler and orchestrator comments.
