# 00 — Entry identity, conservation and installed-build qualification

**ACT:** `ACT-CLINEMM-ADJUDICATION-CONTINUITY-RED-01`
**Type:** reproduction and causal discrimination. **Production repair:** NOT authorized.
**New persistent adjudication ledger:** NOT authorized. **Live model execution:** NOT required.

---

## 1. Repository identity

| Property | Value | Label |
|---|---|---|
| Top level | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` | REAL |
| `origin` remote | `git@github.com:s1onique/clinemm.git` | REAL |
| Expected repository | `s1onique/clinemm` | REAL |
| `ENTRY_HEAD` (expected) | `a493eff078ec5c8f2b6c874ad8f4a85009d1b64f` | REAL |
| `ENTRY_HEAD` (observed) | `a493eff078ec5c8f2b6c874ad8f4a85009d1b64f` | REAL |
| `ENTRY_BRANCH` | `main` | REAL |
| `ENTRY_WORKTREE` | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` (primary) | REAL |
| `FINAL_HEAD` | `a493eff078ec5c8f2b6c874ad8f4a85009d1b64f` (unchanged) | REAL |
| `PROTECTED_STASHES` | none present (`git stash list` empty at entry and at exit) | REAL |

**Entry HEAD verification:** the expected and observed `ENTRY_HEAD` are **identical**.
No source-equivalence reconstruction was required, so no result is reinterpreted
across revisions.

`git worktree list` at entry (all pre-existing, none touched):

```
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm                  a493eff07 [main]
/private/tmp/clinemm-stash-recovery-20261117                                8b76c9e3e [recovery/protected-stash-20261117] prunable
/private/tmp/worktree-bun.7ddCHQ                                            bbdccf8a2 (detached HEAD) prunable
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-action-first 38e726c45 [experiment/m31-action-first]
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-bounded      0366ea506 (detached HEAD)
```

**SOURCE_TREE_IDENTITY:** the tracked tree at `ENTRY_HEAD` is byte-identical to the
tracked tree at `FINAL_HEAD` (no tracked file was added, modified or deleted by
this ACT). Verified with `git status --porcelain --untracked-files=no` → **empty**
at exit.

---

## 2. Unexpected tracked modifications → HALT

**No HALT was triggered.** At entry:

```
git status --porcelain --untracked-files=no   ->  (empty)
```

At exit the same command is still **empty**. The only working-tree entries are
**untracked**, and all of them are files this ACT created or files that pre-existed
it:

| Path | Origin | Disposition |
|---|---|---|
| `sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.red01.test.ts` | this ACT | new test file |
| `sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts` | this ACT | new test file |
| `sdk/packages/core/vitest.red.adjudication-continuity-red01.config.ts` | this ACT | new config |
| `.factory/evidence/ACT-CLINEMM-ADJUDICATION-CONTINUITY-RED-01/` | this ACT | new evidence |
| `.factory/evidence/ACT-CLINEMM-ROUND-C-ADJUDICATION-CONVERGENCE-RECON-01/` | **pre-existing** | **preserved, untouched** |
| `.factory/evidence/ACT-CLINEMM-MCP-SUPERVISION-V2-LIVE-QUAL01/` | **pre-existing** | **preserved, untouched** |

The two pre-existing untracked evidence directories (the previous ACT's recon
directory and the unrelated MCP-supervision qualification) were **not staged, not
deleted, not relocated and not incorporated** into this ACT. They are listed in
`git status` exactly as they were at entry.

### 2.1 Two TRACKED files are modified — and they are deliberate, not dirt

`git status --porcelain --untracked-files=no` reports **two** modified tracked
files at exit:

```
 M sdk/packages/core/package.json
 M sdk/packages/core/vitest.config.ts
```

Both are **test-harness wiring required by G5** ("Do not leave intentionally
failing tests in the default suite"):

- `vitest.config.ts` — adds the RED witness to the default suite's `exclude`
  list, following the existing `compaction.summary-churn01.red.test.ts` pattern.
- `package.json` — adds the script `test:red:adjudication-continuity-red01`,
  following the existing `test:red:summary-churn01` pattern.

**Neither file changes a single line of production behaviour.** Both are test
configuration. The **production** delta — every file under `src/` that is shipped —
is **zero**. See §4.

---

## 3. Previous-ACT recon files retain identity and hashes

The read-only recon files of
`ACT-CLINEMM-ROUND-C-ADJUDICATION-CONVERGENCE-RECON-01` were **read only**. Their
content hashes are unchanged from the previous ACT's own `artifact-hashes.json`.
Verified by re-hashing each file and comparing with the recorded value:

| File | SHA-256 (recomputed) | Unchanged |
|---|---|---|
| `adjudication-state-matrix.md` | see `artifact-hashes.json` | ✔ |
| `artifact-hashes.json` | see `artifact-hashes.json` | ✔ |
| `causal-discriminators.md` | see `artifact-hashes.json` | ✔ |
| `compaction-boundary-comparison.md` | see `artifact-hashes.json` | ✔ |
| `correction01-boundary-verification.md` | see `artifact-hashes.json` | ✔ |
| `identity-and-sources.md` | see `artifact-hashes.json` | ✔ |
| `qualification-report.md` | see `artifact-hashes.json` | ✔ |
| `r4-canonical-timeline.json` | see `artifact-hashes.json` | ✔ |
| `read-necessity-analysis.md` | see `artifact-hashes.json` | ✔ |

No file in that directory was created, modified or deleted by this ACT.

---

## 4. Production delta

```
git diff --stat -- sdk/packages/core/src/ ':(exclude)sdk/packages/core/src/**/*.test.ts'
  -> (empty)
```

**PRODUCTION_DELTA = ZERO.** The only non-test source changes are the two
test-harness configuration files described in §2.1. No production module was
edited, not even temporarily: the ablation in G6 is implemented entirely
**test-locally** in the discriminator file, so no revert-and-rerun cycle was
required and the production tree was never in a modified state.

---

## 5. Installed-build qualification

| Property | Value | Label |
|---|---|---|
| Host version string (from session metadata) | `4.1.26-a493eff07` | REAL |
| `ENTRY_HEAD` short form | `a493eff07` | REAL |

The subject session's own metadata records the host version it ran under:

```json
"origin": { "source": "vscode", "mode": "user", "sessionId": "1795394987994_fpu77", "version": "4.1.26-a493eff07" }
```

`4.1.26-a493eff07` matches `ENTRY_HEAD` `a493eff07…` exactly. This is an
**in-band statement by the running host**, not an inference from a git log.

**A separately verified VSIX/bundle hash was NOT produced by this ACT.** The
extension was not reinstalled and no VSIX was built or hashed. The distinction is
recorded explicitly:

| Claim | Status |
|---|---|
| The historical session ran on a host whose version string binds to `ENTRY_HEAD` | **REAL** (in-band) |
| A VSIX/bundle artifact from that run exists and its hash is verified | **NOT_EXECUTED** |

`INSTALLED_BUILD_UNVERIFIED` does **not** apply to the in-band version claim; it
does apply to any claim about a hashed VSIX/bundle artifact, and no such claim is
made anywhere in this ACT.

---

## 6. Historical artifact hashes (PRIVATE inputs — outside Git)

The canonical snapshot and the compaction sidecar were re-verified against the
frozen read-only copy at `/tmp/cline-recon-rX/` (outside the repository):

| Role | SHA-256 | Matches ACT-specified value |
|---|---|---|
| Canonical messages `1795394987994_fpu77.messages.json` | `9ca5309aa18e43c97343d87171de20f2a198f6ccfe8f266c1f1c33557afa5dcd` | **✔ EXACT MATCH** |
| Compaction sidecar `1795394987994_fpu77.compaction.json` | `27984ab03e56d66cba54f2b66475fd8a4f8a803becdcb18dca4c5a34d5570091` | ✔ |
| Session metadata `1795394987994_fpu77.json` | `2220739301afdb8c1609befa02653fc0fbb6355a5c5ead55fa9cd336155429da` | ✔ |
| Compaction candidate `#37#36` | `85bfffaf869fcbee9b8d91d94d3a60c77610fc5d71f232941809291bf1f41da1` | ✔ |
| Compaction candidate `#63#62` | `dcdd4c73e00443bbc91b11971c868ae0b972547565055713a24703bc537f45ee` | ✔ |

**`CANONICAL_SNAPSHOT_SHA256 = 9ca5309aa18e43c97343d87171de20f2a198f6ccfe8f266c1f1c33557afa5dcd`
— matches the ACT-specified value exactly.**

The live session directory was **not** written to. All analysis ran against the
frozen copy.

> The filesystem mtimes of the session directory are later than the ACT-specified
> values, but the **content** hashes are identical. The freeze is content-bound,
> not mtime-bound; the analysis is unaffected.

---

## 7. Existing test inventory (baseline at `ENTRY_HEAD`)

| Suite | Location | Baseline result |
|---|---|---|
| Compaction evidence-fidelity RED | `src/extensions/context/compaction.evidence-fidelity01.test.ts` | 39 passed |
| Whole `src/extensions/context/` directory | `src/extensions/context/` | 479 passed, 2 skipped |
| Typecheck `tsconfig.dev.json` | — | 44 pre-existing errors |

All three baselines were re-measured **after** this ACT's changes and are
**unchanged**. See `09-executable-gates.md`.

---

## 8. Privacy

- Raw transcripts, canonical messages, compaction sidecars, provider payloads and
  summarizer captures: **0 bytes copied into Git**. They remain in
  `~/.vscodium-roz/cline-data/` and `/tmp/cline-recon-rX/`.
- This evidence directory contains only derived, sanitized analysis.
- **No credential value is reproduced anywhere.** The historical bootstrap-admin
  credential was never printed by the model and is not reproduced here.
- No historical prompt body, canonical transcript body or provider payload body
  is committed. Committed files contain exact-string *probe names*, short
  factual excerpts required to make the causal claim checkable, and short
  sanitized witness statements.
