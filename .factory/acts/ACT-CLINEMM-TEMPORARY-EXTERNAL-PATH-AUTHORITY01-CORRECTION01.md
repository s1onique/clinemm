# ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION01

> **Status**: **CLOSED_V1 / PASS_TEMPORARY_EXTERNAL_PATH_AUTHORITY_V1** (P1;
> closed 2026-09-03). All reviewer halt conditions closed.
>
> **Reviewer halt summary** (verbatim from the halt verdict):
>
> - P0-1: 24h ceiling bypassable through host/CLI write path → CLOSED
>   by `validateTemporaryExternalPathAuthorities` (authoritative
>   reject, NOT silent clamp) + defense-in-depth runtime check in
>   `SdkController.resolveActiveTemporaryExternalCanonicalRoots`.
> - P0-2: unrelated proto fields deleted → CLOSED by restoring
>   `auto_approve_all_toggled = 174` and `clear_user_context_ceiling = 188`
>   to the `Settings` proto message.
> - P1-1: UI canonical-path display mismatch → CLOSED by reconciling
>   the contract to "typed input path; host canonicalizes at evaluation".
>   Added an italic disclaimer in the UI section.
> - P1-2: Expired-entry UI claim/test missing → CLOSED by implementing
>   the expired state in `TemporaryExternalPathsSection` and adding
>   two vitest sub-tests.
> - P2: EOF newline → CLOSED.

## §0 — Why this correction

The reviewer flagged two P0s and two P1s in the first submitted
state. The architecture was sound, but the claimed "24h hard
ceiling" was enforced only at the UI layer; the host write paths
accepted arbitrary future timestamps. Additionally, the proto
generation had inadvertently removed two unrelated fields.

This CORRECTION01 closes both P0s and the two P1s without changing
the architecture.

## §1 — Authoritative write-time validator (closes P0-1)

A new module `apps/vscode/src/shared/storage/temporaryExternalPathAuthorities.ts`
defines `validateTemporaryExternalPathAuthorities(raw, now)`. Both
UI write (`updateSettings.ts`) and CLI write (`updateSettingsCli.ts`)
MUST call this before persisting. The validator REJECTS (does not
clamp) any entry whose `expiresAt` exceeds `now + 24h`.

```text
For every entry:
  absolute/non-empty path
  valid finite expiresAt (ISO-8601)
  expiresAt > now
  expiresAt <= now + 24h    (strict ≤; +1ms rejected)
```

A typed error reason is returned per entry so the caller can
surface a specific actionable message to the user / CLI operator:

```text
"entry[3]:expiresAt-exceeds-24h-ceiling: expiresAt \"2026-09-04T...
 exceeds the 24h hard ceiling (max allowed: now + 24h)"
```

Exposed at `@shared/storage/temporaryExternalPathAuthorities`. Re-exported
from `@shared/storage/index.ts` so both extension and webview can use it.

## §2 — Defense-in-depth runtime check (closes P0-1, second layer)

`SdkController.resolveActiveTemporaryExternalCanonicalRoots` already
filtered expired entries (now >= expiresAt). CORRECTION01 adds a
second check:

```text
expiryMs > now + 24h   → INACTIVE (defense-in-depth backstop)
```

This catches tampered persisted state that bypassed the write-time
validator (old client, manually-edited globalState.json). The host
boundary is now TWO-INDEPENDENTLY enforced: validator at write +
filter at read.

## §3 — Proto restoration (closes P0-2)

`apps/vscode/proto/cline/state.proto` was generated from
`state-keys.ts`. The generation had inadvertently removed:

```proto
optional bool auto_approve_all_toggled = 174;
optional bool clear_user_context_ceiling = 188;
```

Both are RESTORED to the `Settings` message with their original
field numbers, their original ACT cross-references (the
USER-CONTEXT-CEILING01-CORRECTION01 comments explaining the
autoApproveAllToggled migration and the mutually-exclusive clear
flag), and the original ordering in the message body.

`bun run protos` re-ran successfully and the regenerated TS bindings
match the restored proto.

## §4 — UI canonical-path display (closes P1-1)

The reviewer correctly noted that the component displayed the typed
path verbatim while the host canonicalized to a different path at
evaluation time — confusing for an authority UI. Two options were
available: (a) add a host-side canonicalization RPC before
persistence, or (b) reconcile the contract to "typed input, host
canonicalizes at evaluation."

This ACT chose (b) to avoid extra plumbing. The UI now displays the
typed path as the **configured path**, with a small italic disclaimer
explaining that the host canonicalizes it via `fs.realpathSync` before
granting authority (so a symlink at the configured path resolves to
its target).

The ACT body's UI contract was updated accordingly:

> Per entry: typed input path (NOT canonical) + "expires in Xh Ym"
> countdown for active entries, or "Expired (no authority)" for
> entries whose `expiresAt` is in the past or unparseable.

## §5 — Expired-entry UI state + test (closes P1-2)

`TemporaryExternalPathsSection.tsx` now classifies entries as `expired`
when `now >= expiresAt` (or `expiresAt` is unparseable):

- Expired entries render with a muted style (opacity-70, dim border).
- The status text reads "Expired (no authority)" instead of "expires in ...".
- The Remove button is still available (cleanup).

Two new vitest sub-tests in `TemporaryExternalPathsSection.spec.tsx`:

1. **expired entries render as 'Expired (no authority)'** — drives a
   list with one past-dated entry and one future-dated entry,
   asserts the past entry's status text matches `/Expired/i` and
   does NOT match `/expires in/i`; the future entry asserts the inverse.
2. **unparseable expiresAt also renders as 'Expired'** — protects
   against the `formatRemainingHours` regression where unparseable
   timestamps would render "expires in NaN".

## §6 — Validation: 22 new passing assertions

### Validator unit tests

`apps/vscode/src/shared/storage/__tests__/temporaryExternalPathAuthorities.test.ts`:

- accepts now + 24h exactly (boundary inclusive)
- rejects now + 24h + 1ms (boundary strict greater-than) ← THE REVIEWER'S EXAMPLE
- rejects now + 25h (the reviewer's example)
- rejects now + 100h
- rejects 2036 timestamp
- rejects past timestamps
- rejects unparseable expiresAt
- rejects empty path
- rejects non-string path
- rejects non-string expiresAt
- rejects empty expiresAt
- rejects non-array input
- rejects non-object entries
- drops invalid + returns valid subset
- `isWithinTwentyFourHourCeiling` returns false for 25h / 24h+1ms / past / NaN / Infinity; true for 24h exactly
- `MAX_TEMPORARY_EXTERNAL_PATH_HOURS` constant = 24

### C2 production-seam boundary tests

Added to `apps/vscode/src/sdk/__tests__/temporary-external-path-authority01.c2-production-seam.test.ts`:

- tampered persisted expiresAt = now + 25h → INACTIVE
- tampered persisted expiresAt = now + 100h → INACTIVE
- persisted expiresAt exactly at now + 24h → ACTIVE (boundary inclusive)
- persisted expiresAt at now + 24h + 1ms → INACTIVE (boundary rejection)
- tampered persisted expiresAt = "2036-01-01T00:00:00Z" → INACTIVE (reviewer's example)
- validation function rejects now + 24h + 1ms / now + 25h at WRITE time

### UI expired-state tests

Added to `TemporaryExternalPathsSection.spec.tsx`:

- expired entries render as 'Expired (no authority)' not 'expires in …'
- unparseable expiresAt also renders as 'Expired'

## §7 — Files touched in CORRECTION01

```text
apps/vscode/proto/cline/state.proto
  (restored auto_approve_all_toggled = 174 and
   clear_user_context_ceiling = 188 in the Settings message)

apps/vscode/src/shared/storage/temporaryExternalPathAuthorities.ts  (NEW)
  Authoritative validator + isWithinTwentyFourHourCeiling helper +
  public constants.

apps/vscode/src/shared/storage/__tests__/temporaryExternalPathAuthorities.test.ts  (NEW)
  Sub-test matrix for the validator.

apps/vscode/src/shared/storage/index.ts
  (re-export the new module so both extension and webview can use it)

apps/vscode/src/core/controller/state/updateSettings.ts
  Wire JSON.parse + validateTemporaryExternalPathAuthorities →
  reject on any error with typed summary.

apps/vscode/src/core/controller/state/updateSettingsCli.ts
  Same validator path; CLI parity preserved.

apps/vscode/src/sdk/SdkController.ts
  Defense-in-depth: drop entries whose expiresAt exceeds now+24h,
  in addition to the existing expired-entries drop. Imports
  MAX_TEMPORARY_EXTERNAL_PATH_HOURS and MS_PER_HOUR from the new
  validator module.

apps/vscode/src/sdk/__tests__/temporary-external-path-authority01.c2-production-seam.test.ts
  6 new sub-tests proving the runtime check rejects >24h persisted
  state for every adversarial shape.

apps/vscode/webview-ui/src/components/settings/sections/TemporaryExternalPathsSection.tsx
  Added formatRemainingHours({text, expired}); expired entries
  render with muted style and "Expired (no authority)" status;
  added an italic disclaimer explaining the host canonicalization.

apps/vscode/webview-ui/src/components/settings/sections/TemporaryExternalPathsSection.spec.tsx
  2 new sub-tests for expired + unparseable renders.

.factory/acts/ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01.md
  UI contract claim reconciled: "typed input path, host canonicalizes
  at evaluation".
```

## §8 — Conservation matrix (re-runs unchanged)

The original V1 conservation matrix remains intact:

- active ≤24h /private/tmp → ALLOW
- expired → ASK
- >24h tampered state → ASK (now CORRECTION01-enforced)
- symlink escape → ASK
- hard deny → DENY (unchanged; not touched by this ACT)
- absent setting → pre-ACT behavior

## §9 — Verdict

`PASS_TEMPORARY_EXTERNAL_PATH_AUTHORITY_V1`. The two P0s, two P1s,
and one P2 are closed. The 24h hard ceiling is enforced at both the
write-time validator AND the runtime filter, so even a tampered
persisted state cannot create effective >24h authority.
