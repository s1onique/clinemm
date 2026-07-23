# ACT-CLINEMM-MAIN-INTEGRATION-AND-CLOSURE-PROTOCOL-V1-DOGFOOD01

## Close Report

### Verdict: PASS

### Lifecycle: VERIFIED

### Verified At: 2026-07-23T14:13:04Z

---

## Integration Summary

| Property | Value |
|----------|-------|
| Integration Mode | Fast-forward |
| Main Base | `c564045d8135c0c1c330b21d47b68b74917ce614` |
| Feature Tip | `56fd526e1923f2546fa0aeb53a0dc6e7501e5061` |
| Integration Commit | `56fd526e1923f2546fa0aeb53a0dc6e7501e5061` |

---

## Subject

| Property | Value |
|----------|-------|
| Commit OID | `2b515fce0ca8eb4f803aa4f02c3b35fcf27e204c` |
| Tree OID | `6d9d40acdb7a25cbba8e6ec64c88fb3619360df0` |

---

## Plan Freeze

| Property | Value |
|----------|-------|
| Freeze Commit | `2b515fce0ca8eb4f803aa4f02c3b35fcf27e204c` |
| Plan Path | `docs/closure-plans/ACT-CLINEMM-MAIN-INTEGRATION-AND-CLOSURE-PROTOCOL-V1-DOGFOOD01.json` |
| Blob OID | `369d4faa8d9d3d6b648f017d13ddb24959d3cbb2` |
| SHA-256 | `b57d53a222f250b729b4486eb5e7a53e2fa3c417a975646f010acff5e6e3dedc` |

---

## Runner

| Property | Value |
|----------|-------|
| Binary Path | `/usr/local/bin/leamas` |
| Version | `0.1.0+dev.3352229d5e02.20260723T134256Z` |
| Commit | `3352229d5e02` |
| Build Time | `2026-07-23T13:42:56Z` |
| SHA-256 | `2aa8ab9139ffdf354b777593786f47e1b484eb7eb3ff8fb145ce6ce4c2eb632a` |
| Binding | `trusted_clean` |

---

## Required Checks

| Check | Status |
|-------|--------|
| Full Factory Suite | PASS (265/265) |
| Randomized Suites | PASS (seeds 1-5) |
| Strict TypeScript | PASS |
| Range Hygiene | PASS |
| Worktree Clean | PASS |
| Gate Summary Schema v2 | PASS |
| Bounded Scope | CLOSED |
| Parent Baseline | OPEN |
| Leamas Attestation | PASS |

---

## Gate Summary

| Property | Value |
|----------|-------|
| Scope Status | CLOSED |
| Parent Status | OPEN |
| Overall Status | fail |
| Parent Disposition | no detached production bundle |
| Worktree Clean Before | true |
| Worktree Clean After | true |

---

## Leamas Attestation

| Property | Value |
|----------|-------|
| Verdict | pass |
| Candidate Summary SHA-256 | `2d86a492dc6c69e85a76f380459beb38c9a4527fcdb3e0c865c2dd2df225a1a7` |
| Validation Exit Code | 0 |

---

## Parent Baseline Status

**Remains OPEN** — The parent baseline (`ACT-CLINEMM-FORK-BASELINE01-CORRECTION21`) is expected to remain OPEN because there is no detached production verification bundle.

This is an expected failure for the parent scope and does not affect the bounded DOGFOOD closure.

---

## Closure Commit

Pending closure commit creation (requires final artifact generation).
