# 09 — Round C applicability (G10)

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
**Classification:** REAL (measured from the frozen canonical Round C timeline)
**Historical task:** `ACT-QWEN-IQ3S-KEYCLOAK-ROUND-C-01` — COMPARISON ONLY. No replay was authorized and none was performed.

## G10.1 — Evidence compatibility: the inventory

The ACT asks for a small inventory of the historical task, grounded in
canonical tool identities:

```
$ python3 -c "..."
p = '.factory/evidence/ACT-CLINEMM-ROUND-C-ADJUDICATION-CONVERGENCE-RECON-01/r4-canonical-timeline.json'
d = json.load(open(p))
Counter(r['tool_name'] for r in d['r4_candidate_reads'])
```

### The counts

| Quantity | Count | Source |
|---|---|---|
| Canonical tool calls in the whole task | **97** | `qualification-report.md`: "Canonical conservation (frozen snapshot) · 196 messages · 97 tool calls · 97 tool results · 0 unmatched · 0 duplicate call ids" |
| Canonical tool results | **97** | same |
| **Eligible `read_files` calls** (the supported source-observing tool) | **0** | the tool-name distribution of the 6 candidate reads is `{'run_commands': 6}` |
| **Eligible successful acquisitions** | **0** | with 0 eligible `read_files` calls, the acquisition seam never fires |
| **`run_commands` calls among the candidate reads** | **6** | `run_commands: 6` |
| Unattributed command outputs | **0** | each of the 6 has exactly 1 payload with `success: true`; none was left unattributed |

Per-call detail (from the frozen timeline):

```
idx   6   run_commands  payloads 1  success_true 1  call_8de6d73cdb5e42f4aa9b6715
idx  52   run_commands  payloads 1  success_true 1  call_e717feee78ba4e4d87f5ba5a
idx  60   run_commands  payloads 1  success_true 1  call_b6797054762d46c2b4814b0b
idx  74   run_commands  payloads 1  success_true 1  call_9b650a7e84444422b2c7e10a
idx 146   run_commands  payloads 1  success_true 1  call_3973af5e291b4de1b6148bce
idx 148   run_commands  payloads 1  success_true 1  call_2fe8658d2b0f410b9e0a2860
```

### The classification

**`UNSUPPORTED_EVIDENCE_CLASS`**

This is **NOT a failure of the VS Code activation**. It is the expected
consequence of the pre-existing evidence-authority contract, which the ACT
was explicitly forbidden to widen:

> "Do not silently promote a successful shell command into source-revision-bound
> evidence." (G3.4)
>
> "Extending the evidence-authority contract to generic command stdout is out
> of scope." (G3.4)

The Round C task obtained its source facts through `run_commands`
(`cat startup.sh && ls -R .helm | head -60 && ls pg-index-diff-...`), i.e.
through shell pipelines whose stdout is a COMPOSITE of many files plus a
directory listing. Two independent reasons make those ineligible for the
present source-binding contract:

1. **Evidence class.** `run_commands` is not in the SDK's closed
   `SOURCE_OBSERVING_TOOL_NAMES` set (`{ "read_files" }`). The VS Code
   adapter mirrors that set, so the resolver returns `undefined` for it.
2. **Attribution.** A single `run_commands` payload's `query` is the whole
   shell COMMAND, not a single source path. The acquisition seam requires
   the payload's `query` to name exactly ONE source path. A composite
   pipeline names none.

The predecessor Round C recon already recorded the same production fact from
the other side:

> "the source-file-fact path is **off by default** *and* gated on the tool name
> `read_files`, which the observed tool is not."
> (`qualification-report.md`, row 7)

and

> "The observed tool is **not** `read_files` and are not relabelled as such."
> (`read-necessity-analysis.md`)

### What this means for Round C

The ACT's implementation **cannot** make the historical Round C task's own
source observations eligible, because that task did not use `read_files`. It
is NOT a failure of the activation: the activation works, and the fixture
proves a `read_files` observation DOES produce a bound acquisition, a
resolvable handle and an accepted candidate.

For Round C to benefit, the task would have to obtain its source facts
through `read_files` (i.e. read the specific files, rather than shell
pipelines that enumerate directories). Whether that is a better way to
operate is a separate question this ACT does not answer.

## G10.2 — Vocabulary compatibility

The normal Round C task must supply an explicitly authorized R1-R10
vocabulary. The runtime must not infer that vocabulary from model thinking or
arbitrary tool output.

**No authorized R1-R10 vocabulary exists in this repository.** The ACT
deliberately did NOT create one: the brief forbids "Automatic R1-R10
vocabulary generation" and requires "an explicitly authorized contract
defining those findings and their allowable qualifications".

Therefore, for the normal Round C task as it stands today:

```
ROUND_C_CONTRACT_UNAVAILABLE
```

This is a statement about the AUTHORIZATION, not about the mechanism. The
mechanism is proven: the same store that carries the synthetic `S1` fixture
would carry an explicitly authorized R1-R10 vocabulary unchanged.

## G10.3 — Success limitation

Even with a working installed activation, this ACT does **NOT** prove:

- fewer redundant reads,
- lower time to first edit,
- shorter total runtime,
- better final verdict accuracy,
- higher autonomous completion rate.

Those are behavioral outcomes requiring a later controlled comparison.

**What this ACT does prove:** the continuity mechanism actually participates
in VS Code execution — it is wired at the real configuration producer, it
survives the real compaction seam, and it reaches the real provider-visible
continuation.

## G10 — Applicability verdict

| Dimension | Assessment |
|---|---|
| Mechanism applicable to Round C? | **YES, conditionally.** The activation, acquisition, acceptance and carry-forward all work through the real VS Code path. |
| Applicable to the historical Round C task AS OBSERVED? | **NO.** It used `run_commands` exclusively for its source observations: `UNSUPPORTED_EVIDENCE_CLASS`. |
| Blocked by vocabulary? | **YES, separately.** `ROUND_C_CONTRACT_UNAVAILABLE` — no authorized R1-R10 vocabulary exists. |
| Behavioural improvement proven? | **NO.** Out of scope by the ACT's own G10.3. |
