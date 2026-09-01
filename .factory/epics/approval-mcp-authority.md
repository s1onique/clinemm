# EPIC-APPROVAL-MCP-AUTHORITY

> **MCP approval-authority boundary** — when the user has set auto-approve=OFF (or has NOT enabled auto-approve for a particular MCP server / tool), MCP tool calls must NEVER execute without an approval prompt. Upstream #10499 reports a class of defects where a write-capable MCP call executes silently under that configuration; MCP configuration itself has explicit per-server/per-tool `autoApprove` state (`docs/mcp/mcp-overview.mdx`), so the surface is well-bounded.
>
> **Distinct from `approval-protection.md`.** That epic owns the editor / non-command / classic / Seatbelt surfaces (V1/V2 risk classification, YOLO confirmation UI, classic protection). This epic owns the **MCP tool call** approval seam specifically — the surface where `mcpTool` routing happens at the host boundary and where the MCP configuration's `autoApprove` field must be honored.
>
> **Distinct from `tool-runtime-reliability.md`.** That epic is closed (`ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02` → CLOSED GREEN at `9f0e66353` with handoff to `runtime-task-progression`). It owns the tool-execution / foreground-waiter / post-result-progression question, NOT the MCP-permission authority question. Reusing those identifiers for MCP approval would corrupt causal ownership.
>
> See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: OPEN — recon ACT has not yet been opened. Per factory causal reviewer (2026-09-01): "Give it its own authority owner."
- Priority: **P0-if-reproduced** (deterministic security boundary; the upstream defect says execution proceeds without approval, which is a fail-closed-against-the-user violation).
- Current frontier: `ACT-CLINEMM-MCP-AUTOAPPROVE-OFF-AUTHORITY-RECON01` — read-only recon; no production change until the recon resolves the live-vs-structural question.
- Blocked by: n/a.
- Sequenced after this ACT (gated on its verdict): a bounded repair ACT only if recon proves a defect, or `SUPERSEDED` closure if recon exonerates.

## Contract / durable conclusions

(none yet — recon ACT owns the first contract write.)
