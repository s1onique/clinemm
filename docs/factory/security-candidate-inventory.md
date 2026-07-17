# Security candidate inventory

The network-listener and privileged-sink inventories in
`factory/inventories/` are **candidate discovery artefacts** generated
by `factory/scripts/collect-network-listeners.ts` and
`factory/scripts/collect-privileged-sinks.ts`. They are not a
vulnerability report, an audit, or a threat model.

## Candidate-generation limitations

The collectors use **regex-based pattern matching over source text**.
This means:

1. **False positives.** Any line that contains `createServer(`,
   `spawn(`, `writeFile(`, etc. is flagged, even if it is commented
   out, inside a string literal, or in a test fixture.
2. **False negatives.** Obfuscated equivalents, dynamic dispatch,
   `eval`-resolved call sites, or vendored minified code may not
   match. The collectors are not a substitute for semantic review.
3. **No context propagation.** A line that creates a server does
   not say whether it binds to localhost, an external interface, or
   a unix socket. The `host_expression` and `port_expression` columns
   are best-effort probes, not authoritative resolutions.
4. **No origin checks.** The collectors do not assess whether
   Cross-Origin Resource Sharing, Referer, or other origin checks
   are present.
5. **No authentication / authorization claims.** The collectors do
   not assert the presence or absence of auth, CSRF tokens, scope
   checks, role checks, or any equivalent guard.
6. **No data flow tracking.** A sink that receives tainted data
   from a known listener is treated identically to a sink that
   receives only hard-coded input. The collectors do not track
   data flow.

## Disposition of every row

Every row in both CSV inventories begins with:

```csv
review_status=unreviewed
```

This is the only status. The collectors do not classify rows as
safe, unsafe, or exploitable. Subsequent ACTs may add columns for
explicit disposition; this ACT does not.

## Required reading of this inventory

A row in either CSV must be read as:

> "There is text at `<path>:<line>` that calls `<api>`."

Nothing more. The downstream ACT
`ACT-CLINEMM-PRIVILEGED-SINK-REGISTER01` owns the semantic review and
the disposition classification. The successor ACT must not be
short-circuited by treating this ACT's candidates as confirmed
vulnerabilities.

## Categories surfaced (for orientation only)

The candidate categories are listed in
ACT-CLINEMM-FORK-BASELINE01 §19. Their counts in this run are:

- `process execution` (highest in non-test)
- `filesystem write`
- `filesystem delete`
- `browser launch or control`
- `MCP installation` / `MCP invocation`
- `credential retrieval`
- `release publication` / `package publication`
- `remote configuration`
- `scheduled execution`
- `auto-approval decision`

Exact counts are in
`factory/inventories/privileged-sink-candidates.csv`.

## Listener categories surfaced

The listener categories are listed in §18. Their counts are recorded
in `factory/inventories/network-listener-candidates.csv`. Production
listeners are concentrated in the VS Code extension (`apps/vscode/`)
and the SDK hub (`sdk/packages/core/src/hub/`). All are flagged
`review_status=unreviewed`.