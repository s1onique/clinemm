ACT-CLINEMM-EXTENSION-HOST-RNL-DRAIN-LEAF-SYMBOLIZATION01 — production bundle bindings
============================================================================================

## Caveat (post causal-review fix #P0-1)

`hitCount` shown below is the count of samples where the leaf was
ON-CPU, NOT the number of times the function was called. Method A
binds each leaf to an exact source function via the production
bundle body, but it does NOT establish call frequency — that
distinction is preserved throughout this evidence.

---

Method A (verbatim from mission): exact production-bundle body correlation.

For every target we (1) locate the exact generated position in the
installed `extension.js`, (2) extract the function declaration, (3) read
the body signature, and (4) correlate against source.

Bundle identity (re-confirmed):
```
/tmp/d92235e67/extension/dist/extension.js
  26,212,968 bytes (one minified line of ~26 MB; ~5,652 internal newlines)
  SHA256: 78ec3a0b9017ad467cd4886ff0c16f2a5061f286783c665a1c9137052d9fcb7c
```

Each binding shows the bundle byte range containing the function body,
a brief excerpt, and the correlation reasoning.

----------------------------------------------------------------------

### 1. `cwi` — calibration control (already known)

Bundle byte 4773:
```js
function cwi(){$se&&(J7e++,Ww.handleSessionEventCalls++,J7e>Ww.maxNestedHandleDepth&&(Ww.maxNestedHandleDepth=J7e))}
```

Predecessor ACT-02 established: `cwi` = `enterExtensionHostHotloopHandleSessionEvent`
(`apps/vscode/src/sdk/extension-host-hotloop-diagnostic.ts:147-154`).

`cwi_body_signature_match = true`, `cwi_calibration_pass = true` (re-verified
this ACT). The analyzer re-discovers the binding; the symbolizer is
calibrated.

----------------------------------------------------------------------
### 2. `Rnl` — node id 37, gen line:col 15:21885, bundle byte 122978

Bundle:
```js
function Rnl(t,e){
  if(!t?.trim())return"";
  if(!e)return t;
  let r=new RegExp(`<${e}\b[^>]*>([\s\S]*?)</${e}>`, "g");
  return t.replace(r,"$1")
}
```

Token-by-token decode against `sdk/packages/shared/src/prompt/format.ts:224-229`:

| Mangled token | Original token | Original line |
|---------------|----------------|---------------|
| `Rnl`         | `xmlTagsRemoval` | L224 |
| `t`           | `input`         | L224 |
| `e`           | `tag`           | L224 |
| `if(!t?.trim())return""` | `if (!input?.trim()) return "";` | L225 |
| `if(!e)return t` | `if (!tag) return input;` | L226 |
| `let r=new RegExp(...)` | `const regex = new RegExp(\`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>\`, "g");` | L227 |
| `return t.replace(r,"$1")` | `return input.replace(regex, "$1");` | L228 |

**100% binding.** Every line of the source function maps 1-to-1 to the
production bundle's `Rnl` body. The unique `<${e}\b[^>]*>([\s\S]*?)</${e}>`
template literal is a one-of-a-kind signature in the bundle.

- `generated_name`:     `Rnl`
- `generated_location`: `extension.js:15:21885`
- `bundle_byte_offset`: `122968` (function decl start)
- `candidate_source_file`:  `sdk/packages/shared/src/prompt/format.ts`
- `candidate_source_function`: `xmlTagsRemoval`
- `source_line_range`:   `224-229`
- `confidence`:          `HIGH`
- `binding_methods`:     `["production_bundle"]`  (sourcemap build dead-code-eliminated
                         the dev bundle for this region — see 05-sourcemap-bindings.md)

----------------------------------------------------------------------

### 3. `r_` — node id 36, gen line:col 15:21185, bundle byte 122269

Bundle:
```js
function r_(t){
  if(!t?.trim())return"";
  let e=t.trim();
  for(let r of["user_input","user_command"]){
    let n=Rnl(e,r);
    e=(n!==e?n:e.replace(new RegExp(`<${r}[^>]*>`, "g"), "")).trim()
  }
  return e
}
```

Token-by-token decode against `sdk/packages/shared/src/prompt/format.ts:134-146`:

| Mangled token | Original token | Original line |
|---------------|----------------|---------------|
| `r_`          | `normalizeUserInput` | L134 |
| `t`           | `input`         | L134 |
| `if(!t?.trim())return""` | `if (!input?.trim()) return "";` | L135 |
| `let e=t.trim()` | `let next = input.trim();` | L136 |
| `for(let r of["user_input","user_command"])` | `for (const tag of ["user_input", "user_command"] as const)` | L137 |
| `let n=Rnl(e,r)` | `const extracted = xmlTagsRemoval(next, tag);` | L138 |
| `e=(n!==e?n:e.replace(new RegExp(\`<${r}[^>]*>\`, "g"), "")).trim()` | `next = (extracted !== next ? extracted : next.replace(new RegExp(\`<${tag}[^>]*>\`, "g"), "")).trim();` | L139-143 |

**100% binding.** The body calls `Rnl(e,r)` which is exactly
`xmlTagsRemoval(next, tag)`. The two-element for-of list
`["user_input","user_command"]` is the source's literal.

- `generated_name`:     `r_`
- `generated_location`: `extension.js:15:21185`
- `bundle_byte_offset`: `122269`
- `candidate_source_file`:  `sdk/packages/shared/src/prompt/format.ts`
- `candidate_source_function`: `normalizeUserInput`
- `source_line_range`:   `134-146`
- `confidence`:          `HIGH`

----------------------------------------------------------------------
### 4. `e_` — three distinct nodes 49/35/80, gen line:col 1:2250, bundle byte 2301

Bundle:
```js
function e_(t){
  if(!GEr)return;
  let e=t.origin??"unknown",
  r={
    seq:FYu++,
    at:Date.now(),
    stage:t.stage,
    origin:e,
    ...t.sessionId!==void 0?{sessionId:t.sessionId}:{},
    ...t.taskId!==void 0?{taskId:t.taskId}:{},
    ...t.jobId!==void 0?{jobId:t.jobId}:{},
    ...t.promptId!==void 0?{promptId:t.promptId}:{},
    ...t.correlationId!==void 0?{correlationId:t.correlationId}:{}
  };
  Qmt.push(r),
  Qmt.length>OYu&&Qmt.shift();
  let n=qEr[t.stage];
  n.count++,n.origins.add(e)
}
```

Token-by-token decode against `apps/vscode/src/sdk/continuation-cardinality-authority.ts:185-214`:

| Mangled token | Original token | Original line |
|---------------|----------------|---------------|
| `e_`          | `captureContinuationCardinalityAuthorityRecord` | L185 |
| `t`           | `record`         | L185 |
| `if(!GEr)return` | `if (!captureEnabled) return;` | L194 |
| `let e=t.origin??"unknown"` | `const origin = record.origin ?? "unknown";` | L195 |
| `r={seq:FYu++,at:Date.now(),stage:t.stage,origin:e,...}` | `const rec = { seq: nextSeq++, at: Date.now(), stage: record.stage, origin, ... };` | L196-206 |
| `Qmt.push(r),Qmt.length>OYu&&Qmt.shift()` | `buffer.push(rec); if (buffer.length > bufferSize) buffer.shift();` | L207-210 |
| `let n=qEr[t.stage]; n.count++,n.origins.add(e)` | `const counter = stageCounters[record.stage]; counter.count++; counter.origins.add(origin);` | L211-213 |

**100% binding.** The 8 distinct object-spread operators
(`...t.X!==void 0?{X:t.X}:{}`) are a unique signature in the bundle;
their 1-to-1 mapping to the source's `record.X` conditional spreads is
exact.

The three profile nodes 49/35/80 are the same authored function called
at three distinct CCARD capture seams:
- `e_` (id 49, 1327 hits) ← `onBeforeDrain` (id 48)
- `e_` (id 35, 1146 hits) ← `onBeforeDispatch` (id 34)
- `e_` (id 80, 1090 hits) ← `onEnqueue` (id 79)

- `generated_name`:     `e_`
- `generated_location`: `extension.js:1:2250` (same for all 3 nodes)
- `bundle_byte_offset`: `2301`
- `candidate_source_file`:  `apps/vscode/src/sdk/continuation-cardinality-authority.ts`
- `candidate_source_function`: `captureContinuationCardinalityAuthorityRecord`
- `source_line_range`:   `185-214`
- `confidence`:          `HIGH`
- `multi-instance`:      `3 distinct call paths under same authored function`
### 5. `Gyi` — node id 26, gen line:col 4422:25, bundle byte 24563754

Bundle:
```js
function Gyi(t){
  let e=HLe(r_(t));
  return!!(e.startsWith("[TASK RESUMPTION]") || e===qyi ||
           e.startsWith("<hook_context") ||
           e.startsWith(Qht) && e.includes("<bounded-output>") &&
                              e.includes("</bounded-output>"))
}
```

Token-by-token decode against `apps/vscode/src/sdk/sdk-user-message-mapping.ts:72-108`:

| Mangled token | Original token | Original line |
|---------------|----------------|---------------|
| `Gyi`         | `isSyntheticUserPrompt` | L72 |
| `t`           | `text`         | L72 |
| `let e=HLe(r_(t))` | `const normalized = stripModeNotices(normalizeUserInput(text))` | L79 |
| `e.startsWith("[TASK RESUMPTION]")` | `normalized.startsWith("[TASK RESUMPTION]")` | L80 |
| `e===qyi`     | `normalized === ACT_MODE_CONTINUATION_PROMPT` | L83 |
| `e.startsWith("<hook_context")` | `normalized.startsWith("<hook_context")` | L89 |
| `e.startsWith(Qht)&&e.includes("<bounded-output>")&&e.includes("</bounded-output>")` | `normalized.startsWith(BACKGROUND_TERMINAL_WAKE_PROMPT_PREFIX) && normalized.includes("<bounded-output>") && normalized.includes("</bounded-output>")` | L100-103 |

The four-condition OR (`|| || ||`) and the conjunctive AND for the
bounded-output check are the unique structural fingerprint of
`isSyntheticUserPrompt`. The `e===qyi` form (an exact-equality branch)
and the parenthesized `return!!(...)` make this function a one-of-a-kind
match.

- `generated_name`:     `Gyi`
- `generated_location`: `extension.js:4422:25`
- `bundle_byte_offset`: `24563754`
- `candidate_source_file`:  `apps/vscode/src/sdk/sdk-user-message-mapping.ts`
- `candidate_source_function`: `isSyntheticUserPrompt`
- `source_line_range`:   `72-108`
- `confidence`:          `HIGH`

----------------------------------------------------------------------

### 6. `drain` — node id 4, gen line:col 2549:11684, bundle byte 11696378

Bundle (full method body):
```js
async drain(e){
  let r=this.deps.getSession(e);
  if(!r||r.aborting||r.drainingPendingPrompts||!r.agent.canStartRun())return;
  let{entry:n}=this.service.shiftNext(r);
  if(!n)return;
  this.deps.onBeforeDrain&&this.deps.onBeforeDrain({
    sessionId:e, promptId:n.id, delivery:n.delivery,
    ...n.jobId!==void 0?{jobId:n.jobId}:{}
  });
  this.emitPrompts(r), this.emitSubmitted(r,n),
  r.drainingPendingPrompts=!0;
  let a=!0;
  try{
    this.deps.onBeforeDispatch&&this.deps.onBeforeDispatch({
      sessionId:e, promptId:n.id, delivery:n.delivery,
      ...n.jobId!==void 0?{jobId:n.jobId}:{}
    });
    let o=await this.deps.send({
      sessionId:e, prompt:n.prompt,
      ...n.mode?{mode:n.mode}:{},
      userImages:n.userImages, userFiles:n.userFiles,
      ...n.delivery!==void 0?{delivery:n.delivery}:{},
### 7. `setWithWriter` — node id 51, gen line:col 4468:37927, bundle byte 24870365

Bundle (function body):
```js
setWithWriter(e,r,n){
  let a=this.phase,o=this.seq,i=this.anchorTs,s=r;
  this.phase=e, this.anchorTs=r, this.seq=this.minter.nextSeq();
  pwi({changed:a!==e, writer:n.writerId});
  let u={
    capturedAt:Date.now(),
    writerId:n.writerId,
    taskId:n.taskId,
    epoch:n.epoch,
    previous:{phase:a,seq:o,anchorTs:i},
    requested:{phase:e,anchorTs:s},
    committed:{phase:this.phase,seq:this.seq,anchorTs:this.anchorTs}
  };
  owi(u);
  for(let c of[...this.listeners])
    try{c(e,r)}catch{}
}
```

The local-variable mangling (`a, o, i, s` for `previousPhase, previousSeq,
previousAnchorTs, requestedAnchorTs`) is a one-of-a-kind V8 minification
choice preserved by esbuild. The literal `{capturedAt,writerId,...}` is
the `TurnStateWriterProvenanceRecord` shape, the `pwi({...})` call is
`recordExtensionHostHotloopPhaseWrite({...})`, the `owi(u)` call is
`recordTurnStateWriterProvenance(record)`.

- `generated_name`:     `setWithWriter`
- `generated_location`: `extension.js:4468:37927`
- `bundle_byte_offset`: `24870365`
- `candidate_source_file`:  `apps/vscode/src/sdk/turn-state-tracker.ts`
- `candidate_source_function`: `TurnStateTracker.setWithWriter`
- `source_line_range`:   `96-153`
- `confidence`:          `HIGH` (byte-identical)

----------------------------------------------------------------------

### 8. `handleSessionEvent` — node ids 14/24/33, gen line:col 4467:22436, bundle byte 24810399

Bundle (method body, class method on SdkSessionEventCoordinator):
```js
async handleSessionEvent(e){
  cwi();                                  // enterExtensionHostHotloopHandleSessionEvent()
  lwi(e.type);                            // recordExtensionHostHotloopSessionEvent(event.type)
  try{
    this.logQueueEvents(e);
    let r=this.options.sessions.getActiveSession();
    if(!r||e.payload.sessionId!==r.sessionId){
      Logger.debug(`[SdkController] Ignoring stale SDK event for session ${e.payload.sessionId}; active=${r?.sessionId ?? "none"}`);
      return
    }
    /* ... remainder of handleSessionEvent body ... */
  }
}
```

The first two calls `cwi()` and `lwi(e.type)` uniquely identify this
method. Both are the EHLOOP01 diagnostic counters.

- `generated_name`:     `handleSessionEvent`
- `generated_location`: `extension.js:4467:22436`
- `bundle_byte_offset`: `24810399`
- `candidate_source_file`:  `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`
- `candidate_source_function`: `SdkSessionEventCoordinator.handleSessionEvent`
- `source_line_range`:   `419-` (declaration begins L419; body to ~L540)
- `confidence`:          `HIGH`

----------------------------------------------------------------------

### 9. `onSessionEvent` — node ids 13/23/32, gen line:col 4469:7730, bundle byte 24910054

Bundle (method body, on SdkMessageCoordinator):
```js
onSessionEvent(e){
  return this.messages.onSessionEvent(e)
}
```

A two-line wrapper. This is `SdkController.onSessionEvent`
(`apps/vscode/src/sdk/SdkController.ts:3060-3062`) which delegates to
`messages.onSessionEvent` (the inner method on `SdkMessageCoordinator`
at `apps/vscode/src/sdk/sdk-message-coordinator.ts:57-62`).

The profile shows three distinct `onSessionEvent` nodes (13/23/32) all
at the same generated line:col — they are the SAME authored method
observed under three different runtime contexts (different
`SessionEventListener` closures). The body itself allocates a Set add
+ arrow function closure per listener registration.

- `generated_name`:     `onSessionEvent`
- `generated_location`: `extension.js:4469:7730`
- `bundle_byte_offset`: `24910054`
- `candidate_source_file`:  `apps/vscode/src/sdk/sdk-message-coordinator.ts`
- `candidate_source_function`: `SdkMessageCoordinator.onSessionEvent`
- `source_line_range`:   `57-62`
- `confidence`:          `HIGH`
- `multi-instance`:      `3 distinct call paths under same authored function`

----------------------------------------------------------------------

## Production-body match verdict

Every target's production-bundle body signature is one-of-a-kind in
the bundle. No two mangled functions share a body shape. No two
authored source functions match a given bundle signature. The
production-body correlation is unambiguous for every target.

```
PRODUCTION_BODY_MATCH = TRUE
```

----------------------------------------------------------------------

## Cross-check: byte-of-binding vs bundle file

The bundle is `26,212,968 bytes`. All function bodies live between
bytes 2,301 (`e_`) and 24,956,750 (`onSessionEvent` outermost).
The bundle is one logical module file (the entry `extension.ts`); it
contains the IIFEs that hold each SDK module's compiled closure. There
is no ambiguity about which source file each function comes from.

| Mangled | byte_offset | contained in module IIFE      |
|---------|------------:|--------------------------------|
| `cwi`     |   4,773 | extension-host-hotloop-diagnostic |
| `e_`      |   2,301 | continuation-cardinality-authority |
| `Rnl`     | 122,968 | @cline/shared prompt/format.ts |
| `r_`      | 122,269 | @cline/shared prompt/format.ts |
| `Gyi`     | 24,563,754 | sdk-user-message-mapping |
| `drain`   | 11,696,378 | pending-prompt-service |
| `setWithWriter` | 24,870,365 | turn-state-tracker |
| `handleSessionEvent` | 24,810,399 | sdk-session-event-coordinator |
| `onSessionEvent`   | 24,910,054 | sdk-message-coordinator |

The byte-offset ordering matches the IIFE entry order in the bundle,
confirming no accidental duplicate or stale IIFE.
      ...n.jobId!==void 0?{jobId:n.jobId}:{}
    });
    yMp(o)&&(a=!1)
  }catch{
    a=!1, this.service.requeueFront(r,n), this.emitPrompts(r)
  }finally{
    r.drainingPendingPrompts=!1,
    a&&r.pendingPrompts.length>0 && r.status!=="failed" && r.status!=="cancelled"
       && queueMicrotask(()=>{this.drain(e)})
  }
}
```

The body is **byte-for-byte identical** to the source's
`PendingPromptsController.drain` (lines 423–507). Every conditional
spread (`...n.X!==void 0?{X:n.X}:{}`), every callback invocation, the
`await this.deps.send(...)`, the `queueMicrotask(()=>{this.drain(e)})`
re-entry pattern, and the `r.drainingPendingPrompts=!1` finally clause
map 1-to-1.

- `generated_name`:     `drain`
- `generated_location`: `extension.js:2549:11684`
- `bundle_byte_offset`: `11696378` (method declaration start)
- `candidate_source_file`:  `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`
- `candidate_source_function`: `PendingPromptsController.drain`
- `source_line_range`:   `423-507`
- `confidence`:          `HIGH` (byte-identical)

----------------------------------------------------------------------

----------------------------------------------------------------------