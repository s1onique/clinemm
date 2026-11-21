// P2 CHECK: is the boundary-scoped ledger a SUBSET of the whole-history ledger?
// The rolling window keeps the MOST RECENT 12, so a boundary-scoped ledger can
// keep OLDER (and possibly longer-rendered) outcomes than the whole-history one.
import { extractVerifiedToolOutcomes, renderEvidenceSection } from "../../../../sdk/packages/core/src/extensions/context/evidence-continuity";
import type { MessageWithMetadata } from "@cline/shared";

function pair(id: string, cmd: string): MessageWithMetadata[] {
  return [
    { role: "assistant", content: [{ type: "tool_use", id, name: "run_commands", input: { commands: [cmd] } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: id, name: "run_commands", content: [{ query: cmd, result: "ok", success: true }] } as never] },
  ];
}
// 12 VERBOSE outcomes BEFORE the boundary, 12 SHORT outcomes AFTER it.
const verbose = "git log --oneline --decorate --all --graph --stat --summary --patch --full-index";
const before: MessageWithMetadata[] = [];
for (let i = 0; i < 12; i++) before.push(...pair(`pre_${i}`, `${verbose} ${i}`));
const after: MessageWithMetadata[] = [];
for (let i = 0; i < 12; i++) after.push(...pair(`post_${i}`, `echo ${i}`));

const whole = extractVerifiedToolOutcomes([...before, ...after]);
const scoped = extractVerifiedToolOutcomes(before);
const wholeText = renderEvidenceSection(whole) ?? "";
const scopedText = renderEvidenceSection(scoped) ?? "";
console.log("whole-history ledger outcomes:", whole.outcomes.length, "rendered bytes:", Buffer.byteLength(wholeText));
console.log("boundary-scoped ledger outcomes:", scoped.outcomes.length, "rendered bytes:", Buffer.byteLength(scopedText));
console.log("BOUNDARY-SCOPED IS A SUBSET:", scopedText.length <= wholeText.length);
console.log("scoped ids:", scoped.outcomes.map(o => o.toolUseId).join(","));
console.log("whole ids:", whole.outcomes.map(o => o.toolUseId).join(","));
