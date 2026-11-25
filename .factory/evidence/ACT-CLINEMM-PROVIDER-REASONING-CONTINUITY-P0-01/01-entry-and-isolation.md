# 01 — Entry identity, isolation and provider identity

**ACT:** `ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01`
**ACT class:** P0 — provider protocol correctness; bounded causal repair.
**Verdict:** `GO_PROVIDER_REASONING_REPAIR_INTEGRATION`

---

## 1. Repository identity

| Property | Value |
|---|---|
| Top level (primary checkout) | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-second` |
| `origin` remote | `git@github.com:s1onique/clinemm.git` |
| **`ENTRY_HEAD`** | `1d45a8d845eca27bce311949a08fca7868f211cd` |
| `ENTRY_BRANCH` | `main` |
| **`ACT_BRANCH`** | `act/provider-reasoning-continuity-p0-01` |
| **`WORKTREE_PATH`** | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-second/.worktrees/act-pr-p0-01` |
| `TRACKED_DIRT` at entry | none (`git status --porcelain=v1` empty) |
| `git stash list` at entry | empty |
| Other worktrees at entry | none (only the primary) |

`ENTRY_HEAD` was measured at execution time, not taken from any prior
report. It is the `main` HEAD of the primary checkout at the moment of entry.

### 1.1 Isolation

The primary checkout's parent directory (`.../SPbNIX/`) is read-only in this
environment (`mkdir` there fails with `EPERM`), so the dedicated worktree was
created INSIDE the primary checkout's own tree at `.worktrees/act-pr-p0-01`.
This is still a fully independent git worktree: it has its own index, its own
HEAD and its own branch, and the primary checkout's branch and files are
untouched.

```
$ git worktree list --porcelain
worktree /Volumes/.../clinemm-second
HEAD 1d45a8d845eca27bce311949a08fca7868f211cd
branch refs/heads/main

worktree /Volumes/.../clinemm-second/.worktrees/act-pr-p0-01
HEAD 1d45a8d845eca27bce311949a08fca7868f211cd
branch refs/heads/act/provider-reasoning-continuity-p0-01
```

`EXECUTION_ISOLATION = VERIFIED`

### 1.2 Shared generated directories

`node_modules` is NOT shared: the worktree has its own `node_modules/.bun`
store populated by its own `bun install`, and the primary checkout has no
`node_modules` at all. Builds and test runs in the worktree therefore write
only inside the worktree.

### 1.3 Environment restrictions encountered (not ACT-owned)

| Restriction | Effect | Mitigation |
|---|---|---|
| Sandbox `TMPDIR` points at a non-existent, non-creatable path | `bun install` aborts with `EPERM accessing temporary directory` | The package store and the workspace symlinks were materialised from the bun cache; the aborting package is `better-sqlite3` (native build), which is NOT used by `@cline/llms` |
| Optional platform binaries (`@rolldown/binding-darwin-arm64`, `@biomejs/cli-darwin-arm64`) are not linked by the interrupted install | `vitest` and `biome` could not start | Both were materialised from the bun cache into the worktree's own store |
| `node` is not on the default `PATH` | `tsc` could not be invoked via the package script | Invoked directly with `PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"` |

None of these is a product defect and none is ACT-owned.

---

## 2. Warning emitter

The observed warning string was located in the RESOLVED dependency, not in
ClineMM source:

```
~/.bun/install/cache/@ai-sdk/anthropic@4.0.94@@@1/src/convert-to-anthropic-prompt.ts:857
~/.bun/install/cache/@ai-sdk/anthropic@4.0.94@@@1/src/convert-to-anthropic-prompt.ts:863
```

```ts
} else {
  warnings.push({
    type: 'other',
    message: 'unsupported reasoning metadata',
  });
}
```

The warning is pushed when a `reasoning` content part reaches the Anthropic
serializer WITHOUT `providerOptions.anthropic.signature` and WITHOUT
`providerOptions.anthropic.redactedData`. In that case the serializer also
**DROPS the reasoning block from the request entirely** — the warning is a
symptom of a silent reasoning loss, not a benign notice.

`WARNING_EMITTER_IDENTIFIED = VERIFIED`

## 3. Resolved dependency versions

Read from the worktree's own `node_modules` (which `bun install` linked from
`bun.lock`):

| Package | Resolved version |
|---|---|
| `ai` | `7.0.159` |
| `@ai-sdk/anthropic` | `4.0.94` |
| `@ai-sdk/provider` | `4.0.35` |
| `@ai-sdk/provider-utils` | `5.0.72` |

These match `bun.lock` exactly. The upstream AI SDK source was NOT
substituted for the resolved version.

## 4. Provider identity

| Property | Value |
|---|---|
| Configured model | `minimax:MiniMax-M3.1-Flash:Low` |
| Provider id | `minimax` |
| Exact API model id | `MiniMax-M3.1-Flash` |
| Base URL | `https://api.minimax.io/anthropic/v1` |
| Transport | Anthropic-compatible (`@ai-sdk/anthropic`), via `createAnthropicProviderModule` |
| MiniMax-specific wrapper | `createMiniMaxThinkingFetch` + `miniMaxThinkingDisabledMiddleware` (`vendors/minimax-thinking.ts`) |

The MiniMax route is the NATIVE Anthropic transport, not an
OpenAI-compatible shim. This is the decisive identity fact: the thinking
signature the provider emits is an Anthropic thinking-block signature.

## 5. Installed build correlation

The historical observation in `codium-lab` referenced extension identity
`4.1.26-821b20e7a`. This ACT did not alter, reload, restart or signal any
installed extension or any VSCodium instance, and no live capture of that
installation was taken.

`INSTALLED_BUILD_CORRELATION = UNKNOWN`

The defect itself does not depend on that build identity: it is a property
of the resolved `@ai-sdk/anthropic@4.0.94` plus the ClineMM translator, and
it was reproduced deterministically on the source revision named above.

`LIVE_WARNING_CORRELATION = LIVE_UNOBSERVABLE`

`LIVE_UNOBSERVABLE` — the live boundary was not observed, by design: the
ACT forbids attaching a debugger to an active experiment and authorises no
restart of the running extension. The deterministic reproduction emits the
EXACT observed warning string through the same provider id and model id, so
the causal claim rests on the reproduction, not on the live session.
