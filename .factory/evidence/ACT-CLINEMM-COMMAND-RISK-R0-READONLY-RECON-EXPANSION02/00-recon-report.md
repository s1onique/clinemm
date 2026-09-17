# ACT-CLINEMM-COMMAND-RISK-R0-READONLY-RECON-EXPANSION02

## Phase 1 — Recon

Pre-ACT (HEAD `b6dc4bd3`, prior ACT closed with `host_safe_git_branch`):
`ls` and `find` (read-only recon forms) had no positive match in
`DEFAULT_COMMAND_HOST_ALLOW_RULES`. Routine recon like `ls /etc`,
`ls -la`, `find . -type f`, `find . -type d -name ... -not -path
./node_modules/*` all fell through to `host_mode_safe_only_fallthrough`
→ ASK.

### Per-tool review against REVIEW STANDARD

**ls** (per `ls(1)`): every documented option is observational — no
helper invocation, no fs write, no scope broadening, no authority
broadening. → All forms R0.

**find** (per `find(1)`): only stdout-only actions (`-print`,
`-print0`, `-printf`, `-ls`, `-quit`, `-prune`) and pure predicates
are R0. Action-capable primitives (`-delete`, `-exec`, `-execdir`,
`-ok`, `-okdir`, `-fls`, `-fprint`, `-fprint0`, `-fprintf`) are
REJECTED.

### Sensitive-path policy (OUT OF SCOPE)

Per the engineer's plan: `ls ~/.ssh`, `ls /etc`, etc. are read-only.
This ACT does NOT add a sensitive-path blocklist for `ls` / `find`.
If ClineMM later decides to ASK on sensitive paths, it must be a
separate explicit-deny rule layered above the positive allowlist.

### User's exact recon chain (OUT OF SCOPE for this ACT)

```
find . -type d -name 'command-risk*' \
  -not -path './node_modules/*' \
  -not -path './dist/*' \
  -not -path './out/*' \
  2>/dev/null | head -20
```

remains ASK because the `2>/dev/null` redirect triggers V2's
redirect-aware ASK fallthrough. RED proves that leaf expansion alone
is insufficient — the next ACT
(`ACT-CLINEMM-COMMAND-RISK-R0-HARMLESS-REDIRECT-PRECISION01`) will
handle redirect precision.
