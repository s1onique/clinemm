# ACT-CLINEMM-UPSTREAM-PARITY-AND-SETTINGS-BACKLOG-REFINEMENT01

> Backlog refinement ledger for three distinct future-work tracks
> raised in the 2026-08-29 ClineMM engineering thread:
>
> ```text
> Track A — upstream Settings surface parity
> Track B — controlled upstream catch-up / divergence reduction
> Track C — ClineMM-specific Settings surface (orthogonal Seatbelt /
>           network / SSH-agent / PTAD controls)
> ```
>
> **Purpose.** Refine and durably record future work for the three
> tracks, de-duplicating against existing backlog, without
> implementing any of them. This ACT is **DOCS-ONLY**:
> no production code, no Settings implementation, no environment
> variable removal, no Seatbelt behavior change, no SSH-agent
> implementation change, no actual upstream merge / rebase /
> cherry-pick.
>
> **Recon discipline.** Each proposed item below is classified as:
>
> ```text
> EXISTING_PRESERVED     — an existing ACT or epic already owns the
>                          intent; no new durable artifact needed
> EXISTING_UPDATED       — an existing ACT or epic already covers the
>                          intent; this ACT adds a cross-link note
>                          or refines the contract language
> NEW_BACKLOG_ROW        — a new deferred / future row is added to
>                          an existing epic detail file under
>                          "Deferred work"
> SUPERSEDED_NO_ACTION   — another item on this list already owns
>                          the intent; nothing extra is needed
> IMPLEMENTED_NO_ACTION  — the idea has already landed in production;
>                          re-litigating it would be a regression
> ```
>
> **Authority.** This ACT does not promote anything to NEXT or OPEN.
> It only makes sure the existing durable backlog preserves every
> idea discussed, so a future reviewer does not have to re-derive
> the discrimination.
>
> **Stop rule.** After this commit, the next operational action is
> `RETURN IMMEDIATELY TO ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01
> HOST-REQUIRED LIVE QUALIFICATION`. This ACT must NOT be used to
> piggyback any implementation work.

---

## ENTRY / TRUST

```text
REPO_ROOT       = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
BRANCH          = main
ENTRY_HEAD      = 4ac1f63a3e37511c53b465201297640a33a211d5
                 (prior ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01)
ENTRY_TREE      = (see commit)
origin/main     = s1onique/clinemm  (the fork; only remote configured
                                     in this clone)
upstream remote = NOT CONFIGURED in this clone
                 (per docs/factory/upstream-sync.md the canonical
                  upstream URL is https://github.com/cline/cline.git;
                  but the actual remote is not configured, so
                  `git fetch upstream` cannot run from this clone
                  without operator action)

git status --porcelain=v1 --untracked-files=all:
  M  .factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/
        captures/capture-index.jsonl  (foreign dirt; preserved)
  ?? .factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/
        captures/20260829T060942Z-349b48f1/  (foreign dirt; preserved)

git stash list:
  stash@{0}: On main: c2-green-and-c2-p1-delta  (PRESERVED)

Known foreign dirt:
  ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01 capture residue.
  Verified byte-for-byte against entry state; left untouched.

Unexpected tracked dirt: NONE.
```

---

## RECON RESULTS — EXISTING BACKLOG OWNERS

### Existing settings-parity owner

```text
ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01
  exists as a full ACT file (446 lines) at
  .factory/acts/ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01.md
  + board row 26 in .factory/epic-board.md (P2 / HOLD_FOR_EXECUTION)
  + epic ledger row in .factory/epics/product-config-branding.md L39

The ACT already specifies:
  §2 scope          — UPSTREAM-SETTINGS vs CLINEMM-SETTINGS
  §3 capture order  — enumerate upstream FIRST, then classify
  §4 classifier     — 5-way (MISSING_ACCIDENTALLY /
                       REMOVED_INTENTIONALLY /
                       SUPERSEDED_BY_CLINEMM /
                       UPSTREAM_NOT_APPLICABLE /
                       PRESENT_IN_BOTH)
  §5 candidate restore list
  §6 deterministic tests
  §7 epistemic guards:
       GUARD_NO_WHOLESALE_UPSTREAM_COPY
       GUARD_PRESERVE_DELIBERATE_FORK_DIVERGENCE
       GUARD_NO_PTAD_TAB
  §8 external radar  (records 3.16.0 Advanced settings migration;
                       3.30/3.31 settings-visible YOLO mode;
                       Extended Thinking ≠ Advanced Settings label)
  §9 forbidden repair
  §10 conservation suite
  §11 owning-epic decision tree:
       §5 empty                          → no change
       §5 ≥3 entries spanning categories → NEW EPIC-CLINEMM-SETTINGS-SUBSTRATE01
       §5 small-bore                     → existing product-config-branding.md
  §12 forbidden side effects
  §13 gates
  §14 live qualification deferred
  §15 evidence layout
  §17 halt conditions (closed-class)

Verdict: EXISTING_PRESERVED (no duplicate ACT).
The Track A refinement is therefore a contract-language refinement
+ cross-link from the reconciliation, not a new ACT.
```

### Existing upstream-sync doctrine (NOT a backlog ACT)

```text
docs/factory/upstream-sync.md already establishes fork-maintenance
doctrine:
  - upstream = https://github.com/cline/cline.git (immutable)
  - origin   = s1onique/clinemm
  - ClineMM consumes upstream via MERGE, never rebase
  - Conflict evidence contract: docs/factory/sync/<YYYY-MM-DD>/
        upstream_commit.txt
        merge_commit.txt
        conflict_report.md
  - Branch topology: factory/*, product/* (reserved), sync/* (transient)
  - Divergence measurement:
      factory/inventories/repository.json#upstream.{commit_oid,
        tree_oid, merge_base_with_upstream, ahead, behind}

Historical baseline snapshot (frozen at the time of
ACT-CLINEMM-FORK-BASELINE01-CORRECTION02; see
factory/inventories/repository.json):
  upstream.commit_oid              = c564045d8135c0c1c330b21d47b68b74917ce614
  upstream.merge_base_with_upstream = c564045d8135c0c1c330b21d47b68b74917ce614
  working_copy.ahead               = 17
  working_copy.behind              = 0

These numbers are HISTORICAL, not the current user-visible state.

Verdict: EXISTING_PRESERVED as the doctrine substrate; Track B
needs a NEW backlog row for the RECON / cadence process that
makes this doctrine operational, since no ACT currently owns
"deliberately consume upstream in bounded slices".
```

### Existing settings UX ownership

```text
EPIC-PRODUCT-CONFIG-BRANDING (active epic) currently owns:
  - ACT-CLINEMM-COST-DISPLAY-TRUTH01                (CLOSED)
  - ACT-CLINEMM-MAIN-CONSOLIDATION01               (CLOSED)
  - EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01         (OPEN)
  - EPIC-CLINEMM-BRANDING01                         (OPEN)
  - ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01
                                                    (OPEN / HOLD)
  - ACT-CLINEMM-TASK-COST-TRUTH-RECON01             (OPEN / HOLD)

Deferred rows added in the prior
ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01:
  - BRANDING-DEMO-JAN1-ICON                (FW-09)
  - TEMP-INTERNAL-CONTROL-CLEANUP          (FW-11 cross-link)

SAFE-YOLO-SEATBELT (active epic) owns the underlying substrate
controls; its Deferred section (added by the prior ACT) carries:
  - SEATBELT-SAFE-YOLO-USER-FACING-SETTINGS-SURFACE (FW-05 cross-link)
  - TEMP-INTERNAL-CONTROL-CLEANUP                    (FW-11 primary)

The Track C ClineMM-specific settings substrate is therefore
already partially covered by:
  - the settings-parity ACT's §11 decision tree (may spawn
    EPIC-CLINEMM-SETTINGS-SUBSTRATE01)
  - the prior ACT's FW-05 cross-link (safe-yolo → settings-parity §5)
  - the prior ACT's FW-11 deferred rows (safe-yolo primary +
    product-config-branding cross-link)

Track C needs a NEW backlog row to define the ClineMM-specific
settings contract (orthogonal Seatbelt / network / SSH-agent /
diagnostics controls) as a durable future-work identity. The
prior cross-links point to "settings-parity §3 inventory" — Track
C's row makes the *own* identity explicit so a future ACT does
not need to invent it.
```

---

## TRACK A — UPSTREAM SETTINGS SURFACE PARITY

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | `ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01` |
| OWNER_EPIC | `product-config-branding.md` (tentative; per ACT §11, may spawn `EPIC-CLINEMM-SETTINGS-SUBSTRATE01` if §5 has ≥3 restore entries spanning distinct categories) |
| PRIORITY | P2 / HOLD_FOR_EXECUTION (existing) — promote to HIGH / MED-HIGH subject to §11 owner decision and the current queue policy |
| STATUS | OPEN / HOLD_FOR_EXECUTION |
| ACTION | EXISTING_UPDATED (this ACT refines the priority / captures the screenshots observation in the reconciliation, but does NOT create a duplicate ACT) |
| ANCHOR | `.factory/acts/ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01.md` (whole file); board row 26 in `.factory/epic-board.md`; epic ledger row at `product-config-branding.md` L39; external radar at ACT §8 |

**Why preserved, not duplicated.** The ACT already specifies the
two surfaces to compare, the capture order, the five-way
classifier, the four deterministic test IDs, the three epistemic
guards (NO wholesale upstream copy, NO bespoke PTAD tab, preserve
deliberate divergence), the external radar at §8, the §11
owning-epic decision tree, and the §17 halt conditions. Reopening
under a new identity would split the substrate.

**Refinement (carried into the existing ACT, not into a new file).**

- The thread-derived priority promotion (P2/HOLD → HIGH/MED-HIGH)
  is recorded in this reconciliation. The actual promotion
  decision remains with the existing ACT's §11 owner decision
  and the current queue policy; the prior ACT already records
  "promote from HOLD if current queue policy permits; otherwise
  keep HOLD with explicit reason." This ACT does not bypass that
  decision.

- The thread-derived screenshots observations are recorded here
  in §Web / upstream evidence (below) as `OBSERVED_UI_SNAPSHOT`
  (NON-AUTHORITATIVE — these are GitHub UI snapshots, not
  canonical Git evidence). The existing ACT's §3 capture will
  re-derive the same matrix from canonical Git / source evidence
  when it runs.

- The thread's suggested "per-entry matrix" is essentially the
  existing ACT's §4 classifier + §6 test IDs. No new format is
  needed; the existing schema already covers it.

- The thread's "agent settings: Auto Compact, Context ceiling,
  Web Search; editor settings: Feature Tips, Background Edit,
  Checkpoints; experimental: Yolo Mode, Double-Check Completion,
  Lazy Teammate Mode; advanced: Hooks, MCP Display Mode" is
  recorded here as external radar (NON-AUTHORITATIVE). Each of
  these is a candidate row in the future §3 inventory; the §4
  classifier decides whether each is `MISSING_ACCIDENTALLY`,
  `REMOVED_INTENTIONALLY`, `SUPERSEDED_BY_CLINEMM`,
  `UPSTREAM_NOT_APPLICABLE`, or `PRESENT_IN_BOTH`. Only the first
  class drives a candidate restore.

- The thread's "fork = 861 ahead / 176 behind" is recorded in §Web /
  upstream evidence as `OBSERVED_UI_SNAPSHOT`. It is NOT canonical
  Git evidence (no `git fetch upstream` was possible from this
  clone because the `upstream` remote is not configured). The
  canonical divergence measurement belongs to Track B, not Track A.

---

## TRACK B — UPSTREAM CATCH-UP / DIVERGENCE REDUCTION

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | (proposed) `ACT-CLINEMM-UPSTREAM-CATCHUP-RECON01` |
| OWNER_EPIC | `factory-infrastructure.md` (the natural owner of cross-cutting fork-maintenance / upstream-sync doctrine; `docs/factory/upstream-sync.md` already lives under this umbrella) |
| PRIORITY | HIGH |
| STATUS | FUTURE / UNIMPLEMENTED |
| ACTION | NEW_BACKLOG_ROW (deferred row appended to `factory-infrastructure.md`) |
| ANCHOR | existing doctrine: `docs/factory/upstream-sync.md` (whole file); existing frozen snapshot: `factory/inventories/repository.json` (historical baseline at `ACT-CLINEMM-FORK-BASELINE01-CORRECTION02`); existing board doctrine: `.factory/epics/factory-infrastructure.md` |

**Why a new row, not "doctrine is enough".** `docs/factory/upstream-sync.md`
is the *doctrine*; what is missing is a backlog ACT that owns
the *operational cadence* — i.e. a recon ACT that periodically
measures canonical divergence (with `git fetch upstream`),
clusters upstream changes, plans bounded thematic slices, and
documents them in `docs/factory/sync/<YYYY-MM-DD>/`. The
doctrine says "merge, not rebase"; the recon ACT would plan the
slices.

**User-visible divergence snapshot (NON-AUTHORITATIVE).**

```text
SOURCE                       = user-visible GitHub repository page
                              (GitHub compare/pull-request UI)
LABEL                        = OBSERVED_UI_SNAPSHOT
DATE_OBSERVED                = 2026-08-29 (per the thread)
FORK_AHEAD_OF_UPSTREAM       = 861 commits (UI snapshot)
UPSTREAM_AHEAD_OF_FORK       = 176 commits (UI snapshot)
CANONICAL_GIT_DIVERGENCE     = NOT_MEASURED_IN_THIS_ACT
                               (the `upstream` remote is not configured
                                in this clone; `git fetch upstream`
                                cannot run without operator action)
HISTORICAL_FORK_BASELINE     = 17 ahead / 0 behind at the time of
                               ACT-CLINEMM-FORK-BASELINE01-CORRECTION02
                               (factory/inventories/repository.json:
                                upstream.commit_oid =
                                  c564045d8135c0c1c330b21d47b68b74917ce614;
                                merge_base =
                                  c564045d8135c0c1c330b21d47b68b74917ce614)
```

Per ACT instruction: "Treat those numbers as: OBSERVED_UI_SNAPSHOT
not canonical Git evidence." The future `UPSTREAM-CATCHUP-RECON01`
must use Git/source evidence, not web pages, for actual import
decisions.

**Doctrine carried into the new ACT.**

- Use merge, never rebase (per `docs/factory/upstream-sync.md`).
- Conflict evidence contract: `docs/factory/sync/<YYYY-MM-DD>/`
  must record `upstream_commit.txt`, `merge_commit.txt`, and
  `conflict_report.md` for every sync.
- Branch topology: `factory/*`, `product/*` (reserved), `sync/*`
  (transient).
- Divergence measurement: refresh `factory/inventories/repository.json`
  upstream + working-copy fields on every successful sync.

**Strategy (carried into the new ACT).**

- Progressive bounded sync slices, NOT a 176-commit blind mega-merge.
- The recon ACT must choose per upstream cluster among:
  `MERGE_UPSTREAM_SLICE`, `PORT_THEMATIC_SERIES`,
  `MANUAL_PORT`, `DO_NOT_IMPORT`.
- Potential decomposition examples:
  - U1 Settings/UI parity
  - U2 SDK/runtime substrate
  - U3 generated/proto changes
  - U4 provider/API updates
  - U5 tests/tooling
  - U6 docs-only

**Hard invariants (carried into the new ACT).**

- Preserve ClineMM Seatbelt / Safe-YOLO semantics.
- Preserve explicit completion authority (per the
  `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01` family).
- Preserve Factory evidence tooling.
- NO silent regression to upstream plain-YOLO semantics.
- NO wholesale replacement of ClineMM-specific runtime seams.

**Forbidden (per ACT instruction).**

- NO `git merge upstream/main` as the first operation (must follow
  `docs/factory/upstream-sync.md` §Fetch procedure first).
- NO giant rebase without conflict inventory.
- NO semantic conflict resolution based solely on
  "prefer ours/theirs".
- NO deleting fork-specific functionality merely to make sync easy.

**Evidence cadence (carried into the new ACT).**

- Every 1–2 meaningful sync commits:
  typecheck / build / test / runtime evidence.
- The CONFLICT_REPORT in `docs/factory/sync/<date>/` is the
  durable artifact.

**Future automation (suggested but NOT created in this ACT).**

- MAY monitor divergence (commits-behind, age-behind, settings /
  schema drift, runtime / SDK API drift, security fixes, generated-
  proto drift).
- Do NOT create it now; numeric thresholds are not frozen here.

**Trigger metrics (carried forward; NOT frozen as numbers).**

- commits-behind threshold
- age-behind threshold
- settings / schema drift
- runtime / SDK API drift
- security fixes
- generated-proto drift

The new ACT must choose numeric thresholds; this backlog ACT
records the *metric categories*, not the *values*.

---

## TRACK C — CLINEMM-SPECIFIC SETTINGS SUBSTRATE

| Field | Value |
|---|---|
| FINAL_BACKLOG_ID | (proposed) `ACT-CLINEMM-SETTINGS-SUBSTRATE-RECON01` |
| OWNER_EPIC | `product-config-branding.md` (per ACT §11 of `ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01`; this row co-owns the EPIC-CLINEMM-SETTINGS-SUBSTRATE01 spawn decision) |
| PRIORITY | HIGH |
| STATUS | FUTURE / UNIMPLEMENTED |
| ACTION | NEW_BACKLOG_ROW (deferred row appended to `product-config-branding.md` Deferred work section; cross-links to existing FW-05 / FW-11 rows added by the prior normalization ACT) |
| ANCHOR | existing ACT §11 decision tree: `.factory/acts/ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01.md` §11; existing substrate rows: `safe-yolo-seatbelt.md` Deferred (FW-05 + FW-11), `product-config-branding.md` Deferred (FW-11 cross-link), ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01 reconciliation.md |

**Why a new row, not "settings-parity §11 already covers it".**
The settings-parity ACT's §11 decision tree *may* spawn
`EPIC-CLINEMM-SETTINGS-SUBSTRATE01` if §5 has ≥3 restore entries
spanning distinct categories. That is a *passive* decision —
the recon ACT runs, the candidate restore list comes out, and
§11 fires. What is missing is the *active* definition of the
ClineMM-specific settings contract (orthogonal Seatbelt /
network / SSH-agent / PTAD controls) as a durable future-work
identity that does NOT depend on the settings-parity ACT
running first. This is the durable contract backlog that future
implementations will satisfy.

**Mission (carried into the new ACT).**

Provide one coherent user-facing Settings area for ClineMM-specific
controls currently represented by internal / env-only seams.

Preferred UX (per the thread's preference):

```text
Features
  ...

ClineMM / Safe YOLO
  Seatbelt
    [✓] Enable Seatbelt
    [ ] Disable Seatbelt               DANGEROUS

  Network
    [ ] Allow outbound network

  Authentication
    [ ] Allow SSH agent authentication

Advanced
  Diagnostics
    [ ] PTAD
```

**Alternative placement** (per ACT instruction):

- A dedicated ClineMM section/tab IF Settings parity recon shows
  that this is the least disruptive upstream-compatible extension
  point.
- Or a clearly grouped ClineMM / Safe YOLO section inside
  Features/Advanced (the §11 decision tree may choose this).

**Do not freeze exact placement** until Track A maps the current
upstream Settings architecture.

**Candidate product controls (carried into the new ACT).**

```text
C1 — Seatbelt
   [✓] Seatbelt ON by default
   [ ] Disable Seatbelt           DANGEROUS
                                   explicit warning
                                   should require deliberate confirmation
   Semantics: disable sandbox enforcement entirely.
   Must NOT be conflated with: auto-approval, network access,
                                SSH-agent authority.

C2 — Network access
   [ ] Allow outbound network
   Replaces: CLINEMM_SAFE_YOLO_NETWORK=allow
   Default: OFF / deny
   Must remain independent from: auto-approve, Seatbelt disable,
                                   SSH-agent auth.

C3 — SSH agent authentication
   [ ] Allow SSH agent authentication
   Replaces: CLINEMM_SAFE_YOLO_SSH_AGENT=allow
   Default: OFF / deny
   Semantics: expose only SSH_AUTH_SOCK authority, NOT raw
              private-key reads.
   Do NOT add: "allow ~/.ssh keys" in V1.

C4 — Diagnostics / PTAD
   PTAD / task-state diagnostics controls
   Placement: Advanced / Diagnostics preferred.
   Do NOT create: bespoke top-level PTAD tab (unless Settings-
                   parity recon proves no upstream-aligned
                   extension point).
   Controls MAY include: enable PTAD capture, diagnostics
                          verbosity, evidence path/display.
   Must remain: DEFAULT_OFF, removable, non-semantic when disabled.

C5 — Temporary/internal control inventory
   Inventory all current CLINEMM_* env controls and classify:
     KEEP_INTERNAL
     REPLACE_WITH_SETTING
     DEBUG_ONLY
     REMOVE_AFTER_SUCCESSOR
   At minimum inspect:
     CLINEMM_SAFE_YOLO_NETWORK     (REPLACE_WITH_SETTING)
     CLINEMM_SAFE_YOLO_SSH_AGENT   (REPLACE_WITH_SETTING)
     CLINEMM_PTAD                  (REPLACE_WITH_SETTING)
     CLINEMM_EXPERIMENTAL_*        (KEEP_INTERNAL substrate-only;
                                    DEBUG_ONLY if naming is stale)
   Any stale "experimental" naming for default-on Seatbelt should
   be identified, but NOT renamed in this backlog ACT.
```

**Settings security / UX doctrine (carried into the new ACT).**

- Preserve capability independence. Do NOT create:
  "YOLO = approve everything + network + SSH + no sandbox".
- Model orthogonal controls:
  ```text
    AUTO_APPROVAL       OFF/ON
    SEATBELT_ENFORCEMENT ON/OFF
    NETWORK_AUTHORITY    DENY/ALLOW
    SSH_AGENT_AUTHORITY  DENY/ALLOW
    DIAGNOSTICS          OFF/ON
  ```
- Dangerous controls (e.g. Disable Seatbelt) must be visually
  distinct and explicitly marked dangerous.
- Prefer reversible local settings, clear defaults, per-setting
  descriptions, migration from env vars where practical.
- Avoid: hidden magic interactions, provider-specific exceptions,
  auto-enabling network merely because ALL/Yolo is enabled.

**Settings parity vs ClineMM extensions rule (carried into
both Track A and Track C).**

- Track A and Track C must COMPOSE, not fight.
- First learn upstream Settings architecture, then attach
  ClineMM-specific controls at a stable extension seam.
- Do not fork the entire Settings UI unless necessary.
- Ideal long-term shape: upstream Settings remain recognizable +
  ClineMM-only section(s) are additive. This minimizes future
  upstream sync cost.

**Constraints (carried into the new ACT).**

- No implementation in this backlog ACT.
- No env-var removal in this backlog ACT.
- No Seatbelt behavior change.
- No SSH-agent code change.
- The env controls remain valid until a stable settings surface
  can fully cover them.

---

## WEB / UPSTREAM EVIDENCE (NON-AUTHORITATIVE)

```text
SOURCE                          = external web references + GitHub UI
                                  screenshots provided in the
                                  2026-08-29 engineering thread.
LABEL                           = NON-AUTHORITATIVE EXTERNAL RADAR
USE                            = rationale for reducing drift; the
                                  future UPSTREAM-CATCHUP-RECON01
                                  must use Git/source evidence, not
                                  web pages, for actual import
                                  decisions.
```

**Observed upstream Settings surface (from screenshots):**

```text
Modern upstream visibly exposes at least:
  API Configuration
  Features
  Browser
  Terminal
  General
  About

Feature Settings include examples such as:

  AGENT:
    Auto Compact
    Auto Compact Strategy
    Context ceiling
    Web Search

  EDITOR:
    Feature Tips
    Background Edit
    Checkpoints

  EXPERIMENTAL:
    Yolo Mode
    Double-Check Completion
    Lazy Teammate Mode

  ADVANCED:
    Hooks
    MCP Display Mode
```

**Observed ClineMM Settings surface (from screenshots):**

```text
ClineMM currently visibly exposes roughly:
  API Configuration
  Features
  Terminal
  General
  About
```

(Missing or substantially smaller compared with upstream. This
observation is NON-AUTHORITATIVE — Track A's §3 capture will
re-derive the same matrix from canonical Git / source evidence.)

**Upstream CLI / runtime configuration:**

```text
Current upstream CLI exposes newer runtime configuration concepts
including compaction, yolo, auto-approve, thinking effort, etc.
These are orthogonal axes (per upstream CLI README); ClineMM
must preserve the orthogonal shape rather than collapse into
one switch.
```

**Upstream security / patch policy:**

```text
Per upstream security policy, only the newest minor release is
actively patched. This makes letting the fork remain far behind
indefinitely an engineering-debt signal (fork-drift), not just
housekeeping.
```

---

## DEDUP / CLASSIFICATION TOTALS

```text
ITEMS_RECONCILED                       = 3   (Track A, B, C)

EXISTING_UPDATED                       = 1   (Track A — contract-language
                                              refinement; no duplicate ACT)
NEW_BACKLOG_ROWS                       = 2   (Track B — UPSTREAM-CATCHUP-RECON01
                                              in factory-infrastructure.md
                                              Deferred work;
                                              Track C — SETTINGS-SUBSTRATE-RECON01
                                              in product-config-branding.md
                                              Deferred work)
EXISTING_PRESERVED_NO_DIFF             = 2   (settings-parity ACT file +
                                              upstream-sync.md doctrine)
SUPERSEDED                             = 0
IMPLEMENTED_NO_ACTION                  = 5   (the same five items from the
                                              prior ACT: seatbelt-YOLO completion
                                              authority, submit_and_exit mechanics,
                                              SSH agent deny|agent contract itself,
                                              SSH-agent backend implementation,
                                              network mechanism implementation)
```

**NET_NEW_ITEMS_ADDED_TO_BACKLOG = 2** (Tracks B + C).

Track A was deliberately preserved as a contract-language
refinement (recorded in this reconciliation file) rather than a
new ACT — the existing
`ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01` already
specifies the full matrix shape, the classifier, the guards,
and the §11 owning-epic decision tree.

**Cross-cutting links (do NOT duplicate; cross-link).**

| Track | Cross-links |
|---|---|
| A | settings-parity ACT §5 (candidate restore list); §11 (owning-epic decision tree); §17 (halt conditions) |
| B | `docs/factory/upstream-sync.md` (doctrine); `factory/inventories/repository.json` (divergence measurement); `factory/scripts/collect-repository.ts` (canonical collector) |
| C | settings-parity ACT §11 (may spawn `EPIC-CLINEMM-SETTINGS-SUBSTRATE01`); safe-yolo-seatbelt.md Deferred FW-05 + FW-11 (substrate owners); product-config-branding.md Deferred FW-11 (cross-link) |

---

## UPSTREAM DIVERGENCE LEDGER

```text
UPSTREAM_DIVERGENCE_UI_SNAPSHOT       = 861 ahead / 176 behind
                                          (per the 2026-08-29 thread;
                                           user-visible GitHub UI;
                                           OBSERVED_UI_SNAPSHOT label;
                                           NON-AUTHORITATIVE)

CANONICAL_GIT_DIVERGENCE              = NOT_MEASURED_IN_THIS_ACT
                                          (the `upstream` remote is not
                                           configured in this clone;
                                           `git fetch upstream` cannot run
                                           from this ACT; the future
                                           UPSTREAM-CATCHUP-RECON01 is
                                           responsible for canonical
                                           measurement after the operator
                                           configures the `upstream` remote)

HISTORICAL_FORK_BASELINE_SNAPSHOT     = 17 ahead / 0 behind
                                          at the time of
                                          ACT-CLINEMM-FORK-BASELINE01-
                                          CORRECTION02;
                                          upstream.commit_oid =
                                          c564045d8135c0c1c330b21d47b68b74917ce614;
                                          merge_base_with_upstream =
                                          c564045d8135c0c1c330b21d47b68b74917ce614;
                                          see factory/inventories/repository.json
                                          (frozen snapshot, NOT the current state)

ENV_CONTROL_DEBT_RECORDED             = yes (Track C, candidate C1-C5)
                                          CLINEMM_SAFE_YOLO_NETWORK    (C2)
                                          CLINEMM_SAFE_YOLO_SSH_AGENT  (C3)
                                          CLINEMM_PTAD                 (C4)
                                          CLINEMM_EXPERIMENTAL_*       (C5)

NETWORK_ENV_DEBT_RECORDED             = yes (C2: CLINEMM_SAFE_YOLO_NETWORK)
SSH_AGENT_ENV_DEBT_RECORDED           = yes (C3: CLINEMM_SAFE_YOLO_SSH_AGENT)
PTAD_ENV_DEBT_RECORDED                = yes (C4: CLINEMM_PTAD; merge with existing
                                                  ACT-CLINEMM-PTAD-ENV-OPTIN01
                                                  ledger)
SEATBELT_DISABLE_SETTING_RECORDED     = yes (C1: Disable Seatbelt with DANGEROUS
                                                  marker + explicit confirmation)
```

---

## FILES MODIFIED BY THIS ACT

```text
.factory/epics/factory-infrastructure.md        + Track B deferred row (UPSTREAM-CATCHUP-RECON01)
.factory/epics/product-config-branding.md       + Track C deferred row (SETTINGS-SUBSTRATE-RECON01)
.factory/evidence/ACT-CLINEMM-UPSTREAM-PARITY-AND-SETTINGS-BACKLOG-REFINEMENT01/
    reconciliation.md                            (new — this file)
.gitignore                                       (whitelist entry for the evidence dir,
                                                  mirrors .factory/evidence/ default-deny
                                                  + whitelist precedent)
```

No files in `apps/`, `sdk/`, `webview-ui/`, package manifests, lockfiles,
generated sources, production code, tests, or runtime config are
modified. The board (`epic-board.md`) is NOT modified — this ACT
only adds deferred rows inside epic detail files under their
respective `Deferred work` sections, which is below the board
index layer per `_index-contract.md` §1.

---

## QUALITY GATES

```text
git diff --check                                clean
git diff --stat -- apps/ sdk/ webview-ui/      empty
production diff                                  empty
test diff                                        empty
board validator                                  same baseline as entry:
                                                  9/10 hard gates pass;
                                                  1 pre-existing HARD failure
                                                  (NO_OVERSIZED_INDEX_TABLE_CELL
                                                  on board rows L16/L56; both
                                                  rows UNCHANGED by this ACT)
                                                  per ACT instruction
                                                  'Do not repair unrelated
                                                  historical oversized cells'
stash                                            preserved (stash@{0})
editor-capture residue                           byte-for-byte untouched
                                                   (same `??` and ` M` state
                                                    as at entry)
```

---

## FINAL REPORT

```text
ACT_ID                            = ACT-CLINEMM-UPSTREAM-PARITY-AND-SETTINGS-BACKLOG-REFINEMENT01
ENTRY_HEAD                        = 4ac1f63a3e37511c53b465201297640a33a211d5
FINAL_HEAD                        = 10b7124d5cbc10a4c244770ef24c13bfa3f41beb

SETTINGS_PARITY_OWNER             = ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01
                                     (EXISTING_PRESERVED + contract-language refinement)
UPSTREAM_CATCHUP_OWNER            = (proposed) ACT-CLINEMM-UPSTREAM-CATCHUP-RECON01
                                     (NEW_BACKLOG_ROW under
                                      .factory/epics/factory-infrastructure.md
                                      Deferred work)
CLINEMM_SETTINGS_OWNER            = (proposed) ACT-CLINEMM-SETTINGS-SUBSTRATE-RECON01
                                     (NEW_BACKLOG_ROW under
                                      .factory/epics/product-config-branding.md
                                      Deferred work)

NEW_ACT_IDS                       = 2 (UPSTREAM-CATCHUP-RECON01, SETTINGS-SUBSTRATE-RECON01)
EXISTING_ACTS_UPDATED             = 1 (UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01 — contract refinement)
DEDUPED_ITEMS                     = 1 (settings-parity ACT owns Track A; the proposed new
                                     SETTINGS-SUBSTRATE-RECON01 is NOT a duplicate of §11's
                                     EPIC spawn decision — it carries the active contract backlog)

UPSTREAM_DIVERGENCE_UI_SNAPSHOT   = 861 ahead / 176 behind
                                     (per the 2026-08-29 thread; user-visible GitHub UI;
                                      OBSERVED_UI_SNAPSHOT; NON-AUTHORITATIVE)
CANONICAL_GIT_DIVERGENCE          = NOT_MEASURED_IN_THIS_ACT
                                     (`upstream` remote not configured in this clone)

NETWORK_ENV_DEBT_RECORDED         = yes (C2)
SSH_AGENT_ENV_DEBT_RECORDED       = yes (C3)
PTAD_ENV_DEBT_RECORDED            = yes (C4)
SEATBELT_DISABLE_SETTING_RECORDED = yes (C1)

PRODUCTION_FILES_CHANGED          = 0
TEST_FILES_CHANGED                = 0
NEW_VALIDATOR_FAILURES            = 0   (pre-existing NO_OVERSIZED_INDEX_TABLE_CELL on
                                          board rows L16/L56 is UNCHANGED by this ACT;
                                          per "Do not repair unrelated historical oversized cells")
EDITOR_CAPTURE_PRESERVED          = yes
STASH_PRESERVED                   = yes
DIFF_CHECK                        = clean

VERDICT = PASS_UPSTREAM_PARITY_AND_SETTINGS_BACKLOG_REFINED
```

---

## STOP

After successful commit:

STOP.

DO NOT:
- sync upstream
- restore Settings
- implement new tab
- replace env vars
- alter Seatbelt
- change SSH-agent code

NEXT ACTION:

  RETURN IMMEDIATELY TO
  ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01
  HOST-REQUIRED LIVE QUALIFICATION

  Terminal.app / iTerm2:
    SSH-03
    SSH-04
    SSH-06
    SSH-12
    ablation
    live SSH qualification
