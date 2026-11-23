# 06 — The security-adversarial controls

Model-authored output remains untrusted.

## The control matrix

| Case | Required result | Observed |
|---|---|---|
| Empty evidence-reference array | Reject source-supported adjudication | `missing_supporting_evidence` |
| Invented `call_1` | Reject | `unresolvable_tool_reference:call_1` |
| Tool-name-only reference | Reject | `unresolvable_tool_reference:read_files` |
| Valid canonical ID from another session | Reject | `unresolvable_tool_reference:<handle>` |
| Valid ID with no matching result | Reject | `unpaired_or_failed_tool_reference:<id>` |
| Failed tool result | Reject support binding | `unpaired_or_failed_tool_reference:<id>` |
| Truncated/ambiguous result | Reject if provenance insufficient | `unpaired_or_failed_tool_reference:<id>` |
| Forged source revision | Ignore model claim | `unknown_field:source_revision` — the model has no such field to author |
| Dirty or changed source | Invalidate stale binding | The revision is re-resolved on every derivation, so a changed source yields a different carried identity and the stale binding is never presented as current |
| Valid reference, irrelevant result | Do not claim semantic verification | `semantic_support_verified` is `false` — always |
| Copied prompt injection | No privileged instruction promotion | The candidate is never rendered as an instruction; it is a bounded, marked data section inside the compaction summary |
| Unknown JSON field | Reject | `unknown_field:<name>` |
| Free-form instruction in qualification | Reject | `unknown_qualification_code:<code>` |
| Arbitrary secret field | Reject | `unknown_field:api_key` |
| Encoded secret or unrecognized credential format | No unrestricted text carrier | The carried representation carries only vocabulary-validated values and opaque runtime-validated handles. There is no field through which arbitrary bytes can travel. |
| Unknown finding ID | Reject | `unknown_finding_id:<id>` |
| Missing essential qualification | Reject | `missing_essential_qualification:<code>` |
| Duplicate conflicting candidates | Defined conflict/abstention | The later accepted candidate supersedes the earlier one for the same finding; an INCOMPLETE later candidate is rejected and the earlier one survives |
| Candidate in thinking only | Ignore | Never collected — the collector reads assistant `text` blocks only |
| Candidate in tool output only | Ignore | Never collected |
| Replayed or cross-session candidate | Reject | A handle from another session does not resolve |
| Stale candidate after second compaction | Must not regain authority | The derivation reads the CANONICAL record, never a previous summary |

## The security design invariant

> A finite denylist does not establish confidentiality for arbitrary
> content.

The safety claim rests PRIMARILY on a **closed representation with
runtime-validated field values**, not on detection of known secret
patterns.

Concretely:

1. The parser accepts exactly EIGHT fields. Anything else is rejected
   before it is read.
2. Every model-controlled STRING that reaches the carried section must
   pass a closed vocabulary check: the finding id, the decision, the
   qualification codes and the question ids.
3. The evidence reference is not a model-chosen string in the carried
   section: the runtime renders the OPAQUE HANDLE it minted and
   validated. The model's raw reference never reaches the section.
4. The source revision is rendered OPAQUELY and is derived by the
   runtime, never by the model.
5. The section carries no source content and no absolute path.

A credential cannot reach the section because there is no field through
which it can travel — not because a pattern was recognized and blocked.

## The parser is enabled only where it can be authorized

The production parser is enabled only where the host supplied an
authorized vocabulary AND a revision resolver. Without them, the runtime
accepts nothing. The ordinary agent path is unaffected because no host
supplies them by default.

## The instruction is not an elevation

The publication instruction is appended to the SYSTEM PROMPT — the
privileged channel — but it names only the vocabulary and the FORMAT. It
does NOT tell the model to elevate a candidate, and the candidate itself
is never rendered on a privileged channel: it is a marked data section
inside the compaction summary's `user` message, and the section's own
heading states that it is model-derived and provisional.
