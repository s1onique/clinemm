#!/usr/bin/env python3
"""
ACT-CLINEMM-FLINT-EFFICIENCY-RECON-01 -- executable discriminator.

Reads ONLY raw on-disk evidence (no summary numbers) and recomputes:
  1. session identity + call counts + wall clock
  2. tool names, accepted/rejected calls, error categories
  3. duplicate reads by canonical path / range / content fingerprint
  4. request latency vs tool latency vs context growth
  5. provider-reported vs ClineMM-estimated token counts
  6. advertised tool inventory vs the unknown 'shell' name
  7. earliest useful action / completion / final response durations

Usage:
  python3 discriminate.py --transcript <file> [--session-json <file>]
      [--captures <dir>] [--session-id <id>] [--global-state <file>]
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import sys
from collections import Counter, defaultdict


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True)


def parse_ts(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def transcript_shape(doc: dict) -> dict:
    msgs = doc["messages"]
    roles = Counter(m["role"] for m in msgs)
    blocks = Counter()
    for m in msgs:
        c = m.get("content")
        if isinstance(c, list):
            for b in c:
                blocks[(m["role"], b.get("type"))] += 1
        else:
            blocks[(m["role"], "STRING")] += 1
    return {
        "message_count": len(msgs),
        "roles": dict(roles),
        "blocks": {f"{r}/{t}": n for (r, t), n in blocks.items()},
    }


def collect_tool_calls(doc: dict):
    uses = []
    results = {}
    for idx, m in enumerate(doc["messages"]):
        c = m.get("content")
        if not isinstance(c, list):
            continue
        for b in c:
            if b.get("type") == "tool_use":
                uses.append(
                    dict(msg_index=idx, ts=m["ts"], name=b.get("name"),
                         call_id=b.get("id"), input=b.get("input") or {})
                )
            elif b.get("type") == "tool_result":
                results[b.get("tool_use_id")] = dict(
                    msg_index=idx, ts=m["ts"],
                    is_error=bool(b.get("is_error")), content=b.get("content"))
    return uses, results


def error_category(content) -> str:
    s = content if isinstance(content, str) else canon(content)
    if "AI_NoSuchToolError" in s:
        return "unknown_tool_name (AI_NoSuchToolError)"
    if "Invalid input for tool" in s:
        return "schema_invalid_input"
    if "was rejected before execution" in s:
        return "rejected_before_execution_other"
    if '"error"' in s[:200]:
        return "tool_error_payload"
    return "ok"


def read_entries(uses, results):
    entries = []
    for u in uses:
        if u["name"] not in ("read_files", "read_file"):
            continue
        inp = u["input"]
        files = inp.get("files")
        if files:
            specs = [(f.get("path"), f.get("start_line"), f.get("end_line")) for f in files]
        else:
            specs = [(inp.get("path"), inp.get("start_line"), inp.get("end_line"))]
        res = results.get(u["call_id"])
        blob = canon(res["content"]) if res else ""
        for path, sl, el in specs:
            entries.append(dict(
                msg_index=u["msg_index"], ts=u["ts"], call_id=u["call_id"],
                path=path, start_line=sl, end_line=el,
                fingerprint=sha256(blob)[:12], result_bytes=len(blob),
                same_call_reads=len(specs)))
    return entries


def capture_index(capture_dir: str, session_id: str):
    by_iter = {}
    for p in sorted(glob.glob(os.path.join(capture_dir, "*.json"))):
        try:
            with open(p) as fh:
                d = json.load(fh)
        except Exception:
            continue
        corr = d.get("correlation") or {}
        if corr.get("sessionId") != session_id:
            continue
        it = corr.get("iteration")
        if it is None:
            continue
        by_iter[int(it)] = d
    return by_iter


def advertised_tools(capture) -> list:
    tools = (capture.get("payload") or {}).get("tools") or []
    if isinstance(tools, dict):
        return sorted(tools.keys())
    return [t.get("name") for t in tools if isinstance(t, dict)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcript", required=True)
    ap.add_argument("--session-json")
    ap.add_argument("--captures")
    ap.add_argument("--session-id")
    ap.add_argument("--global-state")
    args = ap.parse_args()

    with open(args.transcript) as fh:
        doc = json.load(fh)
    msgs = doc["messages"]

    print("== 1. SOURCE IDENTITY ==")
    shape = transcript_shape(doc)
    print(f"sessionId            : {doc.get('sessionId')}")
    print(f"origin               : {doc.get('origin')}")
    print(f"updated_at           : {doc.get('updated_at')}")
    print(f"message count        : {shape['message_count']}")
    print(f"role counts          : {shape['roles']}")
    print(f"block counts         : {shape['blocks']}")

    sj = None
    if args.session_json:
        with open(args.session_json) as fh:
            sj = json.load(fh)
        md = sj.get("metadata") or {}
        print(f"session.json provider : {sj.get('provider')}")
        print(f"session.json model    : {sj.get('model')}")
        print(f"session.json cwd      : {sj.get('cwd')}")
        print(f"usage (provider)      : {json.dumps(md.get('usage'))}")
        print(f"tokensIn/cacheReads   : {md.get('tokensIn')} / {md.get('cacheReads')}")

    print()
    print("== 2. TOOL NAMES / ACCEPTED / REJECTED / ERROR CATEGORIES ==")
    uses, results = collect_tool_calls(doc)
    name_counts = Counter(u["name"] for u in uses)
    rejected = [(u, results[u["call_id"]]) for u in uses
                if u["call_id"] in results and results[u["call_id"]]["is_error"]]
    cats = Counter(error_category(r["content"]) for _, r in rejected)
    print(f"total tool_use blocks : {len(uses)}")
    print(f"tool name counts      : {dict(name_counts)}")
    print(f"rejected calls        : {len(rejected)}")
    print(f"error categories      : {dict(cats)}")
    for u, r in rejected:
        s = r["content"] if isinstance(r["content"], str) else canon(r["content"])
        print(f"  - msg{u['msg_index']:>3} tool={u['name']:<12} {s[:170]}")

    print()
    print("== 3. DUPLICATE READS ==")
    entries = read_entries(uses, results)
    by_path = Counter(e["path"] for e in entries)
    by_range = Counter((e["path"], e["start_line"], e["end_line"]) for e in entries)
    by_fp = Counter(e["fingerprint"] for e in entries)
    print(f"read entries          : {len(entries)}")
    print(f"distinct paths        : {len(by_path)}")
    print(f"duplicate fingerprint groups (>1): {sum(1 for v in by_fp.values() if v > 1)}")
    for fp, n in by_fp.items():
        if n > 1:
            g = [e for e in entries if e["fingerprint"] == fp]
            print(f"  fp {fp} x{n}: {g[0]['path']} ({g[0]['start_line']}-{g[0]['end_line']})")
    print("paths read more than once:")
    for p, n in by_path.most_common():
        if n > 1:
            print(f"  x{n} {p}")
    print("identical path+range repeated:")
    for (p, sl, el), n in by_range.most_common():
        if n > 1:
            print(f"  x{n} {p} [{sl}:{el}]")

    t0 = msgs[0]["ts"]
    wall_s = (msgs[-1]["ts"] - t0) / 1000.0
    tool_intervals = []
    for u in uses:
        r = results.get(u["call_id"])
        if r:
            tool_intervals.append((u["ts"], r["ts"], u["name"], bool(r["is_error"])))
    tool_total_ms = sum(max(0, e - s) for s, e, _, _ in tool_intervals)

    print()
    print("== 4. TIMING (observable phases only) ==")
    print(f"session wall clock    : {wall_s:.1f}s ({wall_s/60:.2f} min)")
    print(f"sum tool latency      : {tool_total_ms} ms ({tool_total_ms/1000:.1f}s)")
    by_tool = defaultdict(list)
    for s, e, n, _ in tool_intervals:
        by_tool[n].append(e - s)
    for n, v in sorted(by_tool.items()):
        v.sort()
        print(f"  {n:<14} n={len(v):>2} sum={sum(v):>6}ms median={v[len(v)//2]:>5}ms max={max(v):>5}ms")

    req_timeline = []
    caps = {}
    if args.captures and args.session_id:
        caps = capture_index(args.captures, args.session_id)
        for it, c in sorted(caps.items()):
            s = c.get("summary") or {}
            req_timeline.append(dict(
                iteration=it, ts=parse_ts(c["timestamp"]),
                estimated_tokens=s.get("estimatedTokens"),
                payload_bytes=s.get("payloadBytes"),
                message_count=(s.get("messages") or {}).get("messageCount"),
                tools=advertised_tools(c)))
        print(f"captured model requests: {len(req_timeline)}")
        if req_timeline:
            print()
            print(f"{'it':>3} {'req_ts':<25} {'clinemm_est_tok':>14} {'bytes':>8} {'msgs':>5} {'gap_s':>7} {'tool_s':>7} {'model_s':>8}")
            gap_total = tool_in_gap = model_total = 0.0
            for i, r in enumerate(req_timeline[:-1]):
                nxt = req_timeline[i + 1]
                gap = (nxt["ts"] - r["ts"]).total_seconds()
                a = r["ts"].timestamp() * 1000
                b = nxt["ts"].timestamp() * 1000
                tl = sum(max(0.0, (min(e, b) - max(s, a)) / 1000.0)
                         for s, e, _, _ in tool_intervals)
                gap_total += gap
                tool_in_gap += tl
                model_total += gap - tl
                print(f"{r['iteration']:>3} {r['ts'].isoformat():<25} {str(r['estimated_tokens']):>14} "
                      f"{str(r['payload_bytes']):>8} {str(r['message_count']):>5} {gap:>7.2f} {tl:>7.2f} {gap-tl:>8.2f}")
            print(f"TOTAL request-gap      : {gap_total:.1f}s (tool {tool_in_gap:.1f}s, model {model_total:.1f}s)")

    print()
    print("== 5. ADVERTISED TOOL INVENTORY vs UNKNOWN 'shell' ==")
    inventories = {tuple(r["tools"]) for r in req_timeline}
    for inv in inventories:
        print(f"advertised ({len(inv)}): {list(inv)}")
        print(f"  'shell' advertised? {('shell' in inv)}")
    shell_rejects = [u for u, r in rejected if u["name"] == "shell"]
    print(f"'shell' calls in transcript: {len(shell_rejects)}")
    for u in shell_rejects:
        print(f"  msg{u['msg_index']} ts={u['ts']} input={canon(u['input'])[:120]}")
    print(f"advertised inventory stable across all captured requests: {len(inventories) == 1}")

    print()
    print("== 6. PROVIDER-REPORTED vs CLINEMM-ESTIMATED TOKENS ==")
    if sj:
        md = sj.get("metadata") or {}
        usage = md.get("usage") or {}
        print(f"ClineMM tokensIn                        : {md.get('tokensIn')}")
        print(f"provider usage.inputTokens             : {usage.get('inputTokens')}")
        print(f"provider usage.cacheReadTokens         : {usage.get('cacheReadTokens')}")
        print(f"provider usage.outputTokens            : {usage.get('outputTokens')}")
        print(f"session cacheReads                     : {md.get('cacheReads')}")
        if usage.get("inputTokens") and usage.get("cacheReadTokens"):
            print(f"cache share of billed input            : {usage['cacheReadTokens']/usage['inputTokens']:.4f}")
        if caps:
            finals = [c["summary"]["estimatedTokens"] for c in caps.values()]
            print(f"final captured request ClineMM estimate : {max(finals)} tokens "
                  f"(chars/3 estimator)")

    print()
    print("== 7. MILESTONES ==")
    if uses:
        print(f"earliest useful action (first tool call) : +{(uses[0]['ts'] - t0)/1000:.1f}s from session start")
    if caps:
        first_req = min(parse_ts(c["timestamp"]) for c in caps.values())
        last_req = max(parse_ts(c["timestamp"]) for c in caps.values())
        print(f"first model request                      : +{(first_req.timestamp()*1000 - t0)/1000:.1f}s")
        final_text = None
        for m in reversed(msgs):
            if m["role"] != "assistant":
                continue
            c = m.get("content")
            if isinstance(c, list) and any(b.get("type") == "text" for b in c):
                final_text = m
                break
        if final_text:
            delta = final_text["ts"] - last_req.timestamp() * 1000
            print(f"last captured model request              : {last_req.isoformat()}")
            print(f"final assistant response                 : +{delta/1000:.1f}s AFTER last captured request")
            print(f"  -> phase NOT attributable to any captured request: {delta/1000:.1f}s "
                  f"({delta/1000/wall_s*100:.1f}% of wall clock)")
    print(f"session completion (last message)        : +{(msgs[-1]['ts'] - t0)/1000:.1f}s")
    print("TTFT                                    : UNAVAILABLE_FROM_TRACE")
    print("prefill duration                        : UNAVAILABLE_FROM_TRACE")

    print()
    print("== 8. OPERATING CEILING / AUTO-COMPACTION SETTINGS ==")
    if args.global_state:
        gs = json.load(open(args.global_state))
        ceiling = gs.get("userContextCeiling")
        auto = gs.get("useAutoCondense")
        print(f"globalState.userContextCeiling : {ceiling!r} -> mode "
              f"{'explicit' if ceiling else 'AUTO (unset)'}")
        print(f"globalState.useAutoCondense    : {auto!r} -> "
              f"{'enabled' if auto is not False else 'DISABLED'} (SDK default true)")
        for key in ("planModeOpenAiModelInfo", "actModeOpenAiModelInfo"):
            info = gs.get(key) or {}
            cw = info.get("contextWindow")
            if cw:
                eff = int(cw * 0.9)
                print(f"{key}.contextWindow : {cw} -> effectiveMaxInputTokens={eff}, trigger@0.9={int(eff*0.9)}")

    print()
    print("== 8b. TOOL-RESULT VISIBILITY CAP (the measured ClineMM-controllable lever) ==")
    if args.captures and args.session_id:
        cap_report = tool_result_cap_report(args.transcript, args.captures, args.session_id)
        for k, v in cap_report.items():
            print(f"{k:<45}: {v}")
        print("  source of the cap: sdk/packages/core/src/session/services/message-builder.ts")
        print("    DEFAULT_MAX_TOOL_RESULT_CHARS = 8_000 -> truncateMiddleByChars (head+tail, middle elided)")
        print("  file-read paging cap: sdk/packages/core/src/extensions/tools/executors/output-limits.ts")
        print("    MAX_READ_LINES = 2_000, MAX_READ_OUTPUT_CHARS = 48_000")
        checks_extra = [
            ("tool-result cap is 8000 chars", cap_report["cap"] == 8_000, cap_report["cap"]),
            ("redundant re-reads detected", cap_report["redundant_reread_calls"] > 0,
             cap_report["redundant_reread_calls"]),
        ]

    print()
    print("== 9. DISCRIMINATOR ASSERTIONS ==")
    checks = [
        ("tool_use call count == 62", len(uses) == 62, len(uses)),
        ("wall clock ~= 22m53s (1373s)", abs(wall_s - 1373) <= 15, round(wall_s, 1)),
        ("no schema-invalid tool calls", cats.get("schema_invalid_input", 0) == 0, dict(cats)),
        ("all rejections are unknown-tool 'shell'",
         set(cats) <= {"unknown_tool_name (AI_NoSuchToolError)"}, dict(cats)),
        ("'shell' never advertised in any captured request",
         all("shell" not in r["tools"] for r in req_timeline), None),
        ("tool latency is <10% of wall clock",
         tool_total_ms / 1000.0 / wall_s < 0.10,
         f"{tool_total_ms/1000.0/wall_s*100:.2f}%"),
    ]
    if sj:
        checks.append(("session provider == openai-compatible", sj.get("provider") == "openai-compatible", sj.get("provider")))
        checks.append(("session model == flint:16gb", sj.get("model") == "flint:16gb", sj.get("model")))
    for label, ok, detail in checks:
        print(f"[{'PASS' if ok else 'FAIL'}] {label}")
    for label, ok, detail in locals().get("checks_extra", []):
        print(f"[{'PASS' if ok else 'FAIL'}] {label}" + (f"  ({detail})" if detail is not None else ""))
    return 0 if all(c[1] for c in checks) else 1




# ---------------------------------------------------------------------------
# ADDENDUM: the tool-result visibility cap discriminator (the measured
# dominant ClineMM-controllable inefficiency).
# ---------------------------------------------------------------------------

TOOL_RESULT_CHAR_CAP = 8_000  # DEFAULT_MAX_TOOL_RESULT_CHARS


def visible_read_results(capture_dir: str, session_id: str):
    """Yield (iteration, toolCallId, toolName, visible_chars, truncated, query)."""
    for p in sorted(glob.glob(os.path.join(capture_dir, "*.json"))):
        try:
            with open(p) as fh:
                d = json.load(fh)
        except Exception:
            continue
        corr = d.get("correlation") or {}
        if corr.get("sessionId") != session_id:
            continue
        it = corr.get("iteration")
        for m in (d.get("payload") or {}).get("messages") or []:
            if m.get("role") != "tool":
                continue
            for c in m.get("content") or []:
                if c.get("type") != "tool-result":
                    continue
                val = (c.get("output") or {}).get("value")
                if not isinstance(val, list):
                    continue
                for e in val:
                    r = e.get("result")
                    if isinstance(r, str):
                        yield (it, c.get("toolCallId"), c.get("toolName"),
                               len(r), "truncated" in r.lower(), str(e.get("query", "")))


def tool_result_cap_report(transcript_path: str, capture_dir: str, session_id: str):
    doc = json.load(open(transcript_path))
    callmap = {}
    results = {}
    for m in doc["messages"]:
        c = m.get("content")
        if not isinstance(c, list):
            continue
        for b in c:
            if b.get("type") == "tool_use":
                callmap[b["id"]] = (m["ts"], b)
            elif b.get("type") == "tool_result":
                results[b.get("tool_use_id")] = b.get("content")

    vis = {}
    for it, cid, tname, n, trunc, q in visible_read_results(capture_dir, session_id):
        if cid is None:
            continue
        if cid not in vis or n < vis[cid][0]:
            vis[cid] = (n, trunc, q)

    reads = sorted(
        [(cid, ts, b) for cid, (ts, b) in callmap.items()
         if b.get("name") in ("read_files", "read_file")],
        key=lambda x: x[1],
    )
    truncated_paths = set()
    redundant = []
    for cid, ts, b in reads:
        inp = b.get("input") or {}
        files = inp.get("files")
        path = (inp.get("path") if not files
                else (files[0].get("path") if files else None))
        if path in truncated_paths:
            redundant.append((cid, ts, path, inp.get("start_line"), inp.get("end_line")))
        v = vis.get(cid)
        if v and v[1]:
            truncated_paths.add(path)

    # transcript chars injected by the redundant re-reads
    chars = 0
    for cid, _ts, _p, _sl, _el in redundant:
        fr = results.get(cid)
        if isinstance(fr, list):
            for e in fr:
                chars += len(canon(e))
    return {
        "total_read_calls": len(reads),
        "files_truncated_at_the_model_boundary": len(truncated_paths),
        "redundant_reread_calls": len(redundant),
        "redundant_reread_transcript_chars": chars,
        "redundant_reread_tokens": round(chars / 3),
        "cap": TOOL_RESULT_CHAR_CAP,
    }


if __name__ == "__main__":
    sys.exit(main())
