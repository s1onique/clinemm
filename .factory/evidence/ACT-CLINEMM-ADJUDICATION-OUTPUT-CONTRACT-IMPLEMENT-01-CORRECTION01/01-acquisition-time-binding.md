# 01 — The acquisition-time binding

## What the reviewer found

The predecessor bound a candidate's source revision by RE-RESOLVING the source
file during candidate evaluation:

    bindSourceRevision() -> resolver.resolve({ sourcePath, toolName })

That establishes what the file looks like NOW, not what the evidence the
candidate cited actually WAS. A file edited between the read and the citation
was bound with the LATER identity although the evidence was the EARLIER
content. The git HEAD could remain identical throughout, because the edit is
uncommitted.

## The repair — the record rides ON the canonical tool result

The acquisition-time record is now PERSISTED onto the canonical tool-result
block, so it is part of the DURABLE CANONICAL HISTORY:

    ToolResultContent.acquisition : ToolResultAcquisition

The persisted shape is FLAT — plain strings and a plain object — so the record
written to disk is exactly the record read back:

    sourcePaths, contentIdentities, repositoryIdentity,
    workspaceRootIdentity, revision, clean

It carries NO source content, so it can never leak a file's contents into the
persisted history.

The CONTENT identity of each observed source is derived from the bytes the
tool RETURNED (`acquiredContentIdentity`), not from the file on disk. That
derivation is what makes the binding race-free BY CONSTRUCTION: a file edited
after the read cannot change the identity of evidence already read, because
the evidence's content is carried in the evidence itself.

## The capture is at the tool boundary, on the EFFECTIVE result

The capture runs in the session runtime's `afterTool` hook, on the result the
host's own hook PRODUCED:

    const control = await hooks.afterTool?.(ctx);
    const result = control?.result ?? ctx.result;
    await this.captureToolAcquisition(..., result);

An `afterTool` hook is a RESULT-TRANSFORMING hook, so the pre-hook result is
not necessarily the result the canonical history records. A record derived
from it would describe content that was never persisted.

## The attachment is at the CONVERSION boundary

The record is attached where the agent's messages become the persisted
transcript:

    SessionRuntime.toCanonicalMessages()
      -> attachAcquisitionsToAgentMessages()
      -> agentMessagesToMessagesWithMetadata()

and the codec writes it onto the persisted `tool_result` block.

## The restoration is from the canonical history ALONE

    buildAcquisitionEvidenceLedger(messages)

reads every tool result that carries a record and validates it against the
canonical call/result join. A recreated session restores the ledger from the
persisted transcript with NO in-memory handover and NO workspace re-read.

An absent record is `UNBOUND` (`no_acquisition_record`), never guessed.

## The RED

`verification/gate1-red-durable-restoration.txt` — 7 failures against the
predecessor's in-memory model, including "restores the adjudication from the
PERSISTED canonical history alone" and "carries the adjudication across a
session recreation with a re-derivable secret".
