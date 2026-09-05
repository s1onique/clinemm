# ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01 — Product contract recon (entry)

> **Entry identity (auto-recorded by §0 preflight):**
>
> ```text
> ACT_ID            = ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01
> ENTRY_HEAD        = bfa2ad5929aa4f9f1a1bbff58bde2c144c68157e
> PREDECESSORS      = ACT-CLINEMM-FACTORIZE-F3-PROVIDER-SESSION-CONFIG-AUTHORITY-RECON01
>                     ACT-CLINEMM-FACTORIZE-F3B-PROVIDER-SESSION-CONFIG-AUTHORITY-CONSOLIDATE01
> PREDECESSOR_STATE = F3/F3B = CLOSED, CURRENT_FACTORIZE_RESULT = PASS_F3_NO_FACTORIZATION_NEEDED
> F4                = DOES_NOT_EXIST
> BRANCH            = main
> PROD_EDITS        = FORBIDDEN  (this ACT is recon-only)
> TESTS             = characterization only where necessary; no RED suite
> ```
>
> This ACT opens after F3/F3B Factorize falsification closure. The prerequisite seam
> is clean per reviewer's F3B verdict (`PASS_F3_NO_FACTORIZATION_NEEDED`), so the
> Model Profiles feature can begin product recon without an upstream blocker.
>
> Two separately-registered live bugs remain **out of scope** and unaffected:
> `ACT-CLINEMM-EFFECTIVE-MODEL-CONTEXT-WINDOW-AUTHORITY-RECON01` (MiniMax 1.3M→24.6k)
> and `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-ASYNC-JOB-WAKE-OWNERSHIP-RECON01`
> (WAITING_WITHOUT_WAKE_SOURCE). Both are correctness lanes, not Model Profiles scope.

---


> **Mode:** PRODUCT CONTRACT → SOURCE RECON → LIFECYCLE DISCRIMINATOR → UX CONTRACT → IMPLEMENTATION HANDOFF
>
> **Primary epistemic purpose:** determine the smallest truthful Model Profile abstraction and the exact semantics of switching profiles from the running task UI.
>
> **Production edits:** **FORBIDDEN** in this ACT.
>
> **Tests:** characterization tests allowed only where necessary to answer lifecycle questions; no RED implementation suite yet.
>
> **Permitted outcome:** implementation may be split into a bounded backend/state ACT and a UI ACT **only if source topology genuinely demands it**. Do not split merely for ceremony.

---

## §0 — Identity

```text
ACT_ID =
  ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01

PREDECESSORS =
  ACT-CLINEMM-FACTORIZE-F3-PROVIDER-SESSION-CONFIG-AUTHORITY-RECON01
  ACT-CLINEMM-FACTORIZE-F3B-PROVIDER-SESSION-CONFIG-AUTHORITY-CONSOLIDATE01

PREDECESSOR_STATUS =
  F3/F3B = CLOSED
  CURRENT_FACTORIZE_RESULT = PASS_F3_NO_FACTORIZATION_NEEDED
  MODEL_PROFILES_BLOCKED_BY_MIGRATION = NO
  F4 = DOES_NOT_EXIST

EXPECTED_ENTRY_HEAD =
  bfa2ad5929aa4f9f1a1bbff58bde2c144c68157e

ENTRY_HEAD =
  discover at runtime; do not assume

BRANCH =
  main
```

Preflight:

```bash
git rev-parse --show-toplevel
git rev-parse HEAD
git branch --show-current
git status --porcelain=v1 --untracked-files=all
git stash list
git diff --check
```

Record actual identity.

Unexpected tracked dirt:

```text
HALT_UNEXPECTED_TRACKED_DIRT
```

Do not touch inherited Factory P2 residue.

---

# §1 — Product problem

Today ClineMM effectively exposes one configured provider/model configuration at a time.

The operator wants:

```text
1. Save multiple named LLM configurations.

2. Each saved configuration may represent a different:
   - provider,
   - model,
   - endpoint/base URL,
   - provider-specific options,
   - reasoning settings,
   - context/model overrides,
   - credentials reference/configuration where appropriate.

3. See the currently active profile in the task footer/model indicator.

4. Click that indicator.

5. Get a compact popup/list of configured profiles.

6. Switch to another profile without navigating to Settings.

7. Continue the task comfortably with the selected profile.
```

Initial example:

```text
MiniMax M3 — Local
Qwen 3.8 — Local
Claude Sonnet — Anthropic
GPT-5.x — OpenAI
Corporate LiteLLM — MiniMax M3
```

This ACT must establish **what a profile actually owns** before any persistence or UI schema is created.

---

# §2 — Frozen product question

The primary question is:

> **What does switching the selected Model Profile mean for a task that already exists?**

Freeze one of:

```text
A. CURRENT_SESSION_NEXT_REQUEST
   switch applies to the next LLM request in the current task
   and remains active for that task.

B. GLOBAL_DEFAULT_ONLY
   switch changes only the default for new tasks;
   current task remains bound to its existing provider/model.

C. BOTH
   quick switch applies to current task immediately
   AND updates default selection for future tasks.

D. SPLIT_ACTION
   ordinary click changes current task;
   separate explicit action controls global default.
```

**No persistence/UI design before this is answered from current source + product intent.**

My current product hypothesis is **D or A**, not C: clicking the model name inside a task intuitively means "use this profile for this task," while silently rewriting the user's global default is surprising. But this remains a hypothesis until recon.

---

# §3 — Terminology freeze

Use these terms precisely.

### `Provider Configuration`

Existing provider-specific settings:

```text
provider
credentials/config
base URL
model
provider-specific options
```

### `Model Profile`

A **named saved selection/configuration reference suitable for reuse**.

Candidate conceptual shape only:

```ts
interface ModelProfile {
    id: string
    name: string

    // TBD by recon:
    providerId: ProviderId
    modelId?: string

    // Do NOT freeze whether settings are copied or referenced yet.
}
```

### `Active Profile`

The profile selected for a particular authority scope:

```text
GLOBAL_DEFAULT
CURRENT_SESSION
CURRENT_REQUEST
```

Do not conflate them.

### `Current effective model`

The provider/model configuration actually used to construct the next request.

The UI must ultimately render **this truth**, not merely a stale Settings selection.

---

# §4 — Explicit non-goals

This ACT does **not**:

```text
- implement profiles
- add proto fields
- add Settings UI
- add the popup
- add keyboard shortcuts
- redesign providers.json
- migrate every provider setting
- consolidate provider stores
- delete legacy bridges
- redesign @cline/llms
- redesign CoreSessionConfig
- change model catalog architecture
- solve the MiniMax 1.3M context-window bug
- solve WAITING_WITHOUT_WAKE_SOURCE
- add team/cloud profile syncing
- add secrets export/import
- add profile marketplace/sharing
- add automatic model routing
- add per-tool model routing
- add Plan-vs-Act profile selection unless current source already makes that distinction unavoidable
```

Those require separate evidence/product decisions.

---

# §5 — Required current-source recon

Trace the current active provider/model chain at HEAD.

At minimum inspect:

```text
apps/vscode/src/sdk/cline-session-factory.ts
apps/vscode/src/sdk/model-catalog/store.ts
apps/vscode/src/sdk/model-catalog/effective-config.ts
apps/vscode/src/sdk/model-catalog/*
apps/vscode/src/sdk/session-auto-approval.ts

sdk/packages/core/
  provider/settings/config/session/runtime composition seams

sdk/packages/llms/
  provider settings
  model catalog
  handler creation
  providers.json management
```

Then find the webview/model indicator shown in the user's live screenshot:

```text
minimax:MiniMax-M3
```

Trace:

```text
rendered model/provider label
→ ExtensionState / RPC source
→ session/config source
→ actual runtime/provider handler
```

We need to know whether the indicator currently represents:

```text
GLOBAL_SETTINGS
SESSION_CONFIG
RUNTIME_HANDLER
LAST_REQUEST
```

Do not assume.

---

# §6 — Q1: Persisted authority

Answer:

> What is persisted today when the user changes provider/model?

Trace:

```text
Settings UI
→ RPC/message
→ store.write / ProviderSettingsManager
→ providers.json
→ legacy mirrored state, if any
```

Freeze:

```text
CURRENT_PROVIDER_SETTINGS_OWNER =
  ?

CURRENT_MODEL_SELECTION_OWNER =
  ?

CURRENT_GLOBAL_DEFAULT_SELECTION_OWNER =
  ?

PROVIDERS_JSON_ROLE =
  SETTINGS_BY_PROVIDER
  | ACTIVE_SELECTION
  | BOTH
  | OTHER

LAST_USED_PROVIDER_ROLE =
  ?

LAST_USED_MODEL_ROLE =
  ?
```

Then answer:

```text
CAN_EXISTING_PROVIDER_CONFIGURATIONS_ALREADY_COEXIST =
  YES | NO
```

This is critical.

If `providers.json` already stores separate configuration per provider, a Model Profile should probably **reference** existing provider settings rather than duplicate credentials/config into every profile.

Current upstream's model/provider layer explicitly provides typed provider settings and model catalog behavior, reinforcing the principle that a profile should not casually invent a second provider-settings schema. ([GitHub][3])

---

# §7 — Q2: What must a profile store?

Characterize these two options.

## Option R — references

```text
PROFILE =
  id
  displayName
  providerId
  modelId / selection overrides
  possibly provider-config identity/reference
```

Provider credentials/settings remain in their canonical existing store.

Pros:

```text
no secret duplication
provider settings remain canonical
small profile records
```

Risk:

```text
two profiles targeting same provider cannot carry
different base URLs / keys / provider-specific settings
unless provider configs themselves acquire identities
```

## Option S — snapshots/settings copies

```text
PROFILE =
  id
  name
  full provider configuration
  model selection
```

Pros:

```text
arbitrary multiple instances of same provider
```

Risks:

```text
credential duplication
migration complexity
schema duplication
profile/store drift
larger mutation contract
```

## Option I — profile references provider-instance identity

Possible middle ground:

```text
ProviderInstance:
  id
  provider
  provider settings

ModelProfile:
  id
  name
  providerInstanceId
  model selection/options
```

Do **not** choose I because it looks architecturally elegant.

Choose it only if current persistence cannot represent the real product case:

> "two saved OpenAI-compatible endpoints with different base URLs/keys."

Freeze:

```text
PROFILE_STORAGE_MODEL =
  R | S | I | OTHER
```

with mechanical justification.

---

# §8 — Q3: Same-provider multiple configurations

This is load-bearing.

We explicitly want cases such as:

```text
Local LiteLLM — MiniMax
Corporate LiteLLM — Qwen
Lab vLLM — Qwen

```

which may all use the same underlying provider type:

```text
openai-compatible
```

but require different:

```text
baseUrl
apiKey
modelId
context overrides
headers
```

Answer:

```text
CURRENT_STORE_SUPPORTS_MULTIPLE_INSTANCES_OF_SAME_PROVIDER =
  YES | NO
```

If NO:

```text
MODEL_PROFILE_REQUIRES_PROVIDER_INSTANCE_IDENTITY =
  YES
```

may emerge.

This question must be answered **before schema design**.

---

# §9 — Q4: Session binding

Trace session creation:

```text
active selection
→ buildSessionConfig(...)
→ provider config
→ handler/runtime construction
→ AgentRuntime
```

Determine what gets frozen at session creation.

Freeze:

```text
SESSION_BINDS_PROVIDER_AT_CREATION = YES | NO

SESSION_BINDS_MODEL_AT_CREATION = YES | NO

SESSION_BINDS_HANDLER_AT_CREATION = YES | NO

SESSION_CAN_REPLACE_PROVIDER_CONFIG_IN_PLACE = YES | NO

NEXT_TURN_REBUILDS_PROVIDER_HANDLER = YES | NO
```

Do not confuse:

```text
changing stored settings
```

with:

```text
changing actual runtime used by the active task
```

---

# §10 — Q5: Existing live model-switch seam

Search for any existing operation equivalent to:

```text
set model
change provider
update api configuration
change model for current task
recreate handler
rebuild CoreSessionConfig
```

Inspect:

```text
webview model picker
ACP model/provider selection
session/runtime controller
SDK API
task state updates
```

Upstream ACP explicitly supports provider/model selection from a client model picker. ([GitHub][1])

Therefore determine whether ClineMM already inherited or can reuse a **session-aware model-selection seam** rather than inventing one.

Freeze:

```text
CURRENT_SESSION_SWITCH_SEAM_EXISTS =
  YES | NO

SEAM =
  <exact function/RPC/event>

SWITCH_REBUILDS_RUNTIME =
  YES | NO

SWITCH_APPLIES_NEXT_REQUEST =
  YES | NO

SWITCH_PERSISTS_GLOBAL_DEFAULT =
  YES | NO
```

---

# §11 — Q6: In-flight safety

The quick-switch popup can be clicked while:

```text
IDLE
WAITING_FOR_USER
MODEL_REQUEST_RUNNING
TOOL_RUNNING
BACKGROUND_JOB_RUNNING
COMPACTION_RUNNING
```

Freeze permitted behavior.

Preferred contract candidate:

```text
profile selection may be changed at any time,
but it becomes effective only at the next model-request boundary.
```

That avoids mutating an in-flight request.

Prove whether current architecture can support that.

Required discriminator:

```text
SWITCH_DURING_MODEL_REQUEST =
  REJECT
  | QUEUE_FOR_NEXT_REQUEST
  | MUTATE_CURRENT_REQUEST
```

`MUTATE_CURRENT_REQUEST` should almost certainly be forbidden.

Also answer:

```text
SWITCH_DURING_TOOL_EXECUTION =
  ?

SWITCH_DURING_BACKGROUND_JOB =
  ?

SWITCH_DURING_COMPACTION =
  ?
```

We need a deterministic boundary.

---

# §12 — Q7: Context-window consequences

Model switching changes:

```text
context window
max output tokens
tool capabilities
vision capabilities
reasoning controls
token pricing
```

The current task may already have W larger than the new model's capacity.

Freeze:

```text
PROFILE_SWITCH_REQUIRES_IMMEDIATE_COMPACTION =
  YES | NO

PROFILE_SWITCH_RECOMPUTES_W =
  YES | NO

PROFILE_SWITCH_RECOMPUTES_CONTEXT_CAPACITY =
  YES | NO
```

Likely desirable contract:

```text
switch updates effective model capacity immediately for the next request;
existing transcript is retained;
normal prepareTurn/compaction policy decides whether compaction is required.
```

Do not build special profile-switch compaction unless source proves necessary.

The separate `1.3M` MiniMax bug must stay distinct:

```text
MODEL_PROFILE_CONTEXT_WINDOW_CONTRACT
!=
EFFECTIVE_MODEL_CONTEXT_WINDOW_BUG
```

But Model Profiles must not make that bug harder to reason about.

---

# §13 — Q8: Credential semantics

Profiles must not create accidental secret-management duplication.

Determine whether credentials are currently:

```text
stored per provider
stored per provider instance
stored separately from provider settings
stored in providers.json
external auth/token state
```

Freeze:

```text
PROFILE_CONTAINS_RAW_SECRET =
  YES | NO
```

Preferred answer:

```text
NO
```

unless existing provider settings are already one atomic serialized object and separating them would introduce worse semantics.

Also identify special cases:

```text
OAuth
AWS profile
Azure identity
Cline account
SSH/local provider
API-key providers
```

Profile switching must not mean "copy access tokens around."

---

# §14 — Q9: Naming and identity

Profiles need stable identity independent of display name.

Freeze:

```text
PROFILE_ID =
  opaque UUID / nanoid / existing key primitive

PROFILE_NAME =
  user-editable display string

PROFILE_NAME_UNIQUE =
  YES | NO
```

Recommended hypothesis:

```text
id is authoritative
name need not be globally unique
```

but recon should inspect UI/storage conventions.

Profile deletion semantics:

```text
DELETE_ACTIVE_PROFILE =
  ?

DELETE_PROFILE_REFERENCED_BY_SESSION =
  ?
```

Likely:

```text
sessions bind snapshot/reference needed for continuation;
deleting a saved profile must not corrupt existing session history.
```

Prove what session persistence currently needs.

---

# §15 — Q10: Session resume

This is one of the most important questions.

Given:

```text
task created with Profile A
switch to Profile B
close VSCodium
restart
resume task
```

Which profile should it use?

Freeze:

```text
SESSION_PROFILE_BINDING_PERSISTED =
  YES | NO

RESUME_USES =
  SESSION_LAST_PROFILE
  | GLOBAL_DEFAULT_PROFILE
  | CURRENT_GLOBAL_SELECTION
```

My product recommendation is:

```text
SESSION_LAST_PROFILE
```

Otherwise a resumed task can silently switch provider/model because the global default changed meanwhile.

But this must align with current session persistence architecture.

---

# §16 — Q11: Quick-switch UX

Live desired interaction:

Current footer:

```text
[minimax:MiniMax-M3]
```

New behavior:

```text
click model/provider label
        ↓
compact profile picker
        ↓
✓ Local MiniMax M3
  Local Qwen 3.8
  Claude Sonnet
  GPT-5.x
  ─────────────
  Manage profiles…
```

No Settings page required for selection.

Settings remains the management surface for:

```text
create
edit
delete
credentials
advanced options
```

Quick popup should be primarily:

```text
SELECT
```

not a miniature Settings implementation.

This matches longstanding upstream user demand for a favorites/model dropdown near the normal task controls rather than multi-click Settings navigation. ([GitHub][2])

Freeze:

```text
QUICK_SWITCH_TRIGGER =
  CLICK_CURRENT_MODEL_LABEL

QUICK_SWITCH_PRIMARY_ACTION =
  SELECT_PROFILE

MANAGE_PROFILES_ACTION =
  OPENS_SETTINGS_PROFILE_SECTION

SHOW_PROVIDER =
  YES | NO

SHOW_MODEL =
  YES

SHOW_PROFILE_NAME =
  YES
```

---

# §17 — Keyboard UX

Recon existing command palette / keyboard infrastructure.

Do not implement yet.

Determine feasibility of:

```text
Cmd/Ctrl+Shift+M
```

or command:

```text
ClineMM: Switch Model Profile
```

Freeze only whether the same picker component can be invoked from:

```text
footer
command palette
```

Avoid two different selectors.

---

# §18 — Empty-state UX

If no profiles exist:

Clicking model label should not show an empty broken menu.

Freeze one of:

```text
A. Current configuration implicitly becomes "Default" profile during migration.
B. Quick picker offers "Create profile from current configuration".
C. Profiles feature is unavailable until user creates one in Settings.
```

I strongly prefer A if migration can be lossless:

```text
existing user
→ exactly one generated/default profile
→ behavior unchanged
```

But migration must be mechanically proven before freezing it.

---

# §19 — Backwards compatibility / migration

Characterize how existing users transition.

Required invariant:

```text
MIGRATION_OR_DEFAULT_BEHAVIOR_DELTA = 0
```

For an existing installation with:

```text
provider = minimax/openai-compatible
model = MiniMax-M3
configured endpoint/key
```

after first profile-capable version:

```text
same task/new task behavior
same provider/model
same credentials
same defaults
```

Possible migration models:

```text
LAZY_DEFAULT_PROFILE
  synthesize profile view from legacy state until first explicit save

EAGER_MIGRATION
  write a default profile once

HYBRID
```

Do **not** choose eager migration merely because explicit storage is cleaner.

Prefer the option with the smallest irreversible state delta.

---

# §20 — Cloud/team scope

V1 should default to:

```text
LOCAL_USER_PROFILES
```

unless source proves profiles are naturally part of synced account settings.

Explicitly classify:

```text
PROFILE_SCOPE =
  LOCAL_MACHINE
  | USER_SYNCED
  | WORKSPACE
  | ORGANIZATION
```

My recommended V1 hypothesis:

```text
LOCAL_USER / existing provider-settings scope
```

No cloud sync in V1.

---

# §21 — Product discriminator artifact

Create:

```text
.factory/evidence/
ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01/
05-product-discriminator.md
```

It must terminate with:

```text
PROFILE_STORAGE_MODEL =
  R | S | I | OTHER

CURRENT_STORE_SUPPORTS_MULTIPLE_INSTANCES_OF_SAME_PROVIDER =
  YES | NO

MODEL_PROFILE_REQUIRES_PROVIDER_INSTANCE_IDENTITY =
  YES | NO

SESSION_PROFILE_APPLICATION =
  CURRENT_SESSION_NEXT_REQUEST
  | GLOBAL_DEFAULT_ONLY
  | BOTH
  | SPLIT_ACTION

CURRENT_SESSION_SWITCH_SEAM_EXISTS =
  YES | NO

SWITCH_EFFECTIVE_BOUNDARY =
  NEXT_MODEL_REQUEST
  | NEXT_SESSION
  | OTHER

SWITCH_DURING_INFLIGHT_MODEL_REQUEST =
  REJECT
  | QUEUE_FOR_NEXT_REQUEST
  | OTHER

SESSION_PROFILE_BINDING_PERSISTED =
  YES | NO

RESUME_USES =
  SESSION_LAST_PROFILE
  | GLOBAL_DEFAULT
  | OTHER

PROFILE_CONTAINS_RAW_SECRET =
  YES | NO

MIGRATION_MODEL =
  LAZY | EAGER | HYBRID

QUICK_SWITCH_TRIGGER =
  CURRENT_MODEL_LABEL

IMPLEMENTATION_SHAPE =
  SINGLE_ACT
  | STATE_ACT_PLUS_UI_ACT
```

No implementation ACT before this is frozen.

---

# §22 — Required source chain artifact

Produce:

```text
01-current-provider-persistence.md
02-session-provider-binding.md
03-existing-switch-seams.md
04-ui-model-indicator-chain.md
05-product-discriminator.md
06-migration-options.md
07-implementation-boundary.md
08-final-report.md
```

Plus:

```text
00-preflight.txt
```

No 20-file ceremonial evidence pack.

---

# §23 — Characterization tests

Only add tests if source inspection cannot prove a lifecycle property.

Candidate high-value characterization:

### C1 — session binding

```text
create session with provider/model A
change global selection to B
next request in existing session uses ?
```

### C2 — existing runtime switch operation

If a current switch seam exists:

```text
session A
invoke switch-to-B
next model request uses B
```

### C3 — restart/resume

If test infrastructure already supports it:

```text
session switched A → B
persist
restore
effective provider/model = ?
```

Do not build new persistence-test infrastructure merely for recon.

If not observable safely:

```text
STRUCTURAL
```

is sufficient for product-contract freeze when source is unequivocal.

---

# §24 — Explicit architecture constraint

Do not create:

```text
ModelProfileManager
ProfileRegistryService
ProviderInstanceRepository
ProfileOrchestrator
```

during recon.

Names and abstractions emerge **after** the discriminator.

A V1 implementation may need nothing more than:

```text
small persisted profile record
active-profile id
existing provider settings APIs
one session switch operation
one picker
```

Prefer that until evidence demands more.

---

# §25 — Success criteria for recon

The ACT closes when we know:

```text
1. what a profile owns;
2. whether same-provider multiple instances are representable;
3. whether credentials are copied or referenced;
4. where profile records persist;
5. what active-profile scope means;
6. whether current sessions can switch provider/model;
7. when a switch takes effect;
8. what is persisted into session state;
9. resume semantics;
10. migration semantics for existing users;
11. exact footer → picker data chain;
12. whether implementation is one ACT or two.
```

No implementation before all twelve are answered.

---

# §26 — Halt conditions

```text
HALT_PROFILE_REQUIRES_SECRET_DUPLICATION
```

if the only discovered design copies credentials into a second uncontrolled store. Reconsider representation.

```text
HALT_CURRENT_SESSION_SWITCH_UNSUPPORTED
```

if provider/runtime construction is immutable for session lifetime and changing it would require architectural work.

That does not kill Model Profiles; it changes V1 product semantics to:

```text
switch applies to new tasks only
```

until a separate session-switch ACT is justified.

```text
CAPTURE_INSUFFICIENT
```

if active provider/model truth cannot be identified from current source.

---

# §27 — Permitted outcomes

## Outcome A — V1 straightforward

```text
existing provider settings
+ small profile identity/selection records
+ existing live session switch seam
```

Then:

```text
SINGLE IMPLEMENTATION ACT
```

is preferred.

## Outcome B — persistence straightforward, live switch missing

Then split:

```text
MODEL-PROFILES-STATE01
MODEL-PROFILES-LIVE-SWITCH01
```

UI comes only after switch semantics are established.

## Outcome C — provider-instance identity required

If same-provider configurations cannot coexist:

```text
provider instance identity
```

is a real prerequisite.

Open one bounded foundation ACT before profiles.

Do not call it F4.

## Outcome D — only new-session switching safe in V1

Ship:

```text
profiles + fast default selector
```

for new sessions first.

The popup must state truthfully that current task retains its current model.

---

# §28 — Implementation handoff requirements

The final report must provide one executable successor contract containing:

```text
STATE DELTA
  exact persisted schema

MIGRATION
  old → new behavior

SESSION DELTA
  exact runtime mutation, if any

RPC/PROTO DELTA
  exact fields/messages, if needed

UI DELTA
  footer click
  picker
  settings management

RED TESTS
  migration
  profile CRUD
  active selection
  session switch
  resume
  no-secret duplication / reference semantics

CONSERVATION
  current single-provider behavior unchanged
```

No generic "implement profiles" handoff.

---

# §29 — Acceptance matrix for eventual implementation

Pre-register now, but do not execute in recon:

| ID  | Scenario                              | Required                               |
| --- | ------------------------------------- | -------------------------------------- |
| P1  | Existing user, no profiles            | Existing behavior unchanged            |
| P2  | Create Profile A                      | Persisted                              |
| P3  | Create Profile B                      | Both coexist                           |
| P4  | Same provider, different model        | Supported                              |
| P5  | Same provider, different endpoint/key | Result depends on frozen storage model |
| P6  | Switch A→B from footer                | Applies at frozen boundary             |
| P7  | Switch during request                 | No in-flight mutation                  |
| P8  | Resume switched task                  | Frozen resume semantics                |
| P9  | Delete inactive profile               | Safe                                   |
| P10 | Delete active profile                 | Deterministic fallback/error           |
| P11 | Provider auth missing                 | Fail visibly, no silent fallback       |
| P12 | Existing Settings provider editor     | Still works                            |
| P13 | Context/model capabilities refresh    | Correct for selected profile           |
| P14 | Quick picker                          | No Settings navigation required        |
| P15 | Manage Profiles                       | Opens management UI                    |
| P16 | Secret material                       | No unauthorized duplication            |
| P17 | Plan/Act/current task semantics       | Explicit and deterministic             |

---

# §30 — Evidence labels

Use:

```text
REAL_PRODUCTION_SEAM
STRUCTURAL
EXECUTED
SYNTHETIC_REAL
LIVE
INFERRED
NOT_EXECUTED
```

Particularly:

```text
upstream user request
  = EXTERNAL_PRODUCT_SIGNAL

our screenshot
  = LIVE UX TARGET

source chain
  = STRUCTURAL

characterization test
  = EXECUTED / SYNTHETIC_REAL
```

Do not call upstream feature requests proof of our architecture. They validate product demand only.

---

# §31 — Board entry

One terse row:

```text
MODEL-PROFILES-QUICK-SWITCH-RECON01
  product-contract recon opened after F3/F3B falsification closure;
  freezes profile ownership + current-session switch semantics before schema/UI work.
```

The epic board is already oversized. No narrative report there.

---

# §32 — Successor policy

This ACT **may** preselect a product implementation successor because this is no longer the Factorize sequence.

But successor naming must follow evidence.

Examples only:

```text
ACT-CLINEMM-MODEL-PROFILES-V1-IMPLEMENTATION01

ACT-CLINEMM-MODEL-PROFILES-STATE01
ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH01
```

Do not freeze names until §21 discriminator completes.

---

# §33 — Separate backlog items remain separate

Do not absorb:

```text
ACT-CLINEMM-EFFECTIVE-MODEL-CONTEXT-WINDOW-AUTHORITY-RECON01
```

MiniMax `1.3M → 24.6k`.

And do not absorb:

```text
ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-ASYNC-JOB-WAKE-OWNERSHIP-RECON01
```

`WAITING_WITHOUT_WAKE_SOURCE`.

Both are correctness lanes, not Model Profiles scope.

---

# §34 — Terminal review

At the end answer only:

```text
1. What is a Model Profile?
2. Does it duplicate provider settings?
3. Can two configurations of the same provider coexist?
4. What does clicking a profile do to the current task?
5. What exact request boundary applies the change?
6. What survives restart/resume?
7. What becomes the global default?
8. How are credentials handled?
9. Is migration zero-delta?
10. What exact implementation ACT follows?
11. STOP.
```

No architecture review loop unless a new P0 appears.

---

## Recommended product bias going into recon

These are hypotheses, **not frozen answers**:

```text
PROFILE =
  named reusable configuration identity,
  preferably referencing canonical provider settings
  rather than copying secrets

QUICK SWITCH =
  current task / next model request

GLOBAL DEFAULT =
  separate explicit concept

SWITCH DURING REQUEST =
  queue for next request, never mutate in-flight

RESUME =
  use task's last selected profile

QUICK UI =
  click existing model/provider label
  → compact profile list
  → Manage Profiles…

PROFILE MANAGEMENT =
  Settings page

MIGRATION =
  zero-behavior-delta for existing users
```

The upstream UX signal strongly supports the quick-selector part: users have explicitly asked for saved provider/model combinations accessible next to the normal task controls, avoiding the Settings round trip. ([GitHub][2]) And upstream ACP already supports provider/model selection as a client-level interaction, so recon should actively look for reusable switching semantics rather than assuming ClineMM must invent a completely new operation. ([GitHub][1])

---

## §35 — Successor linkage

The reviewer's F3B verdict explicitly opened this lane:

> "Next lane: **Model Profiles product work** (seam ready per reviewer D8=NO).
> Live-bug `ACT-CLINEMM-EFFECTIVE-MODEL-CONTEXT-WINDOW-AUTHORITY-RECON01`
> (MiniMax 1.3M→24.6k) remains independently registered."

This ACT is that lane's recon entry. No F4 exists; the Factorize chain terminates
by falsification (`PASS_F3_NO_FACTORIZATION_NEEDED`). Product recon begins here
without an upstream architecture blocker.
