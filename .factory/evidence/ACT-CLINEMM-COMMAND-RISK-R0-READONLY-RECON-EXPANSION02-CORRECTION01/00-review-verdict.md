# ACT-CLINEMM-COMMAND-RISK-R0-READONLY-RECON-EXPANSION02-CORRECTION01

## Factory Review Verdict

Shell safety / command-policy reviewer + TypeScript runtime reviewer
issued the following verdict on the prior ACT closure:

```
P0: host_safe_find classifies pre-shell source containing wildcard
metacharacters, while shell pathname expansion can change the argv
that GNU find parses.

1. Preserve git branch rule unchanged.
2. Preserve ls rule unchanged except optional wording cleanup.
3. Tighten host_safe_find:
   - no wildcard/metacharacter-bearing starting paths in V1;
   - no unquoted shell glob forms such as:
       find *
       find . -name *.ts
       find . -path */node_modules/*
   - retain literal, bounded query predicates and stdout-only actions.
4. Add negative tests demonstrating wildcard-bearing source is ASK.
5. Add at least one adversarial filesystem test showing a hostile
   filename cannot turn an ALLOW-classified find command into an
   action-bearing argv.
6. Do not redesign the parser or V2 policy in this correction.
7. Run focused command-policy tests + existing full policy suite.
8. Rebuild/install VSIX only if production rule source changed.
9. Report exact installed bundle identity after reload.

host_safe_git_branch = GO
host_safe_ls         = GO
host_safe_find       = REOPEN_P0
```

## Citation of Authority

- GNU find(1) findutils manual: "Patterns containing metacharacters
  must be quoted so the shell does not expand them before find sees
  them." (https://www.gnu.org/software/findutils/manual/find.pdf)
- GNU Coreutils `ls(1)`: "list information about the FILEs" — no
  filesystem-mutating command mode in the reviewed surface.
- GNU Coreutils `ls(1)` `--dired`: deliberately changes output into a
  machine-oriented protocol (not a fs mutation).
- git-branch(1): `--format=<format>` is the git-for-each-ref
  interpolation format (e.g. `%(refname:short)`, `%(HEAD)`,
  `%(upstream:track)`); log-pretty preset names are NOT valid
  git-branch --format directives.

## Resolution

Bounded correction applied. See 01-decision-record.md and 02-final-report.md.
