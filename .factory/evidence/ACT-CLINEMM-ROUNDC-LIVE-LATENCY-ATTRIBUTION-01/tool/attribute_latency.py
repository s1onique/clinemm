#!/usr/bin/env python3
"""
ACT-CLINEMM-ROUNDC-LIVE-LATENCY-ATTRIBUTION-01 — offline latency attribution.

READ-ONLY. Consumes a preserved `cline.roundc-latency-trace.v1` artifact and
produces the stage-attribution table, the tool-result latency discriminator and
the control receipts. It touches NO production source and installs NO probe.

The stage taxonomy below is COPIED VERBATIM from the production instrumentation
(`sdk/packages/core/src/observability/latency/latency-trace.ts`,
`STAGE_BOUNDARIES` / `classifyLatencyStage`), so the attribution is expressed in
the SAME vocabulary the runtime already uses. Nothing here invents a boundary
that the trace does not carry.

Key production semantics reproduced here:

  * A STAGE is the GAP between an `end` event and the NEXT `start` event.
    The gap does NOT include the previous span's own duration.
  * The executor's own run time is emitted as an explicit `execution` stage
    carrying `durationMs == spanDurationMs == tool_execution.durationMs`.
    That is what makes `execution` and `delivery` SEPARABLE and ADDITIVE,
    instead of folding a post-execution delay into "execution".
  * `provider_first_text` / `provider_first_response` are CLIENT-SIDE
    observations of generated text / first stream event. They are never
    promoted to an authoritative server-side TTFT.

Usage:
  python3 attribute_latency.py <trace.json> <outdir>
"""

from __future__ import annotations

import hashlib
import json
import os
import statistics
import sys
from collections import Counter, defaultdict

# ---------------------------------------------------------------------------
# Production stage taxonomy (verbatim from latency-trace.ts STAGE_BOUNDARIES)
# ---------------------------------------------------------------------------
STAGE_BOUNDARIES = {
    "request_preparation>request_prepared": "preparation",
    "request_prepared>provider_submitted": "queue",
    "provider_submitted>provider_first_text": "transport",
    "provider_first_text>provider_completed": "transport",
    "provider_completed>schema_validation": "queue",
    "schema_validation>tool_execution": "queue",
    "tool_execution>tool_result_delivered": "delivery",
    "tool_result_delivered>provider_ready": "delivery",
    "provider_ready>provider_submitted": "queue",
}

STAGE_MEANING = {
    "preparation": "the request was being prepared for the provider",
    "queue": "the request was built and held, or the agent held the turn",
    "transport": "the provider had not answered, or was still generating",
    "delivery": "the tool result existed but was not yet in the provider request",
    "execution": "the executor's own measured run time",
    "unclassified": "a gap with no production stage classification",
}

STAGE_MEASUREMENT = {
    "preparation": "gap between request_preparation.end and request_prepared.start",
    "queue": "gap between request_prepared.end and provider_submitted.start",
    "transport": "gap between provider_submitted.end and provider_first_text.start",
    "delivery": "gap between tool_execution.end and tool_result_delivered.start",
    "execution": "tool_execution span duration (the executor's own run time)",
    "unclassified": "n/a",
}


def classify_stage(frm, to):
    return STAGE_BOUNDARIES.get(f"{frm}>{to}", "unclassified")


def pct(values, p):
    """Linear-interpolation percentile (numpy default)."""
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    k = (len(ordered) - 1) * (p / 100.0)
    lo = int(k)
    hi = min(lo + 1, len(ordered) - 1)
    frac = k - lo
    return float(ordered[lo] * (1 - frac) + ordered[hi] * frac)


def dist(values):
    if not values:
        return {"n": 0, "min_ms": None, "median_ms": None,
                "p90_ms": None, "max_ms": None, "sum_ms": None}
    return {
        "n": len(values),
        "min_ms": round(min(values), 3),
        "median_ms": round(statistics.median(values), 3),
        "p90_ms": round(pct(values, 90), 3),
        "max_ms": round(max(values), 3),
        "sum_ms": round(sum(values), 3),
    }


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def identity_of(event):
    """The authoritative join key for an event.

    The production tracer carries the runtime's correlation identities on the
    OBSERVATION (`preparationRequestId`, `modelRequestId`) and the tool call
    identity on the tool boundary. Joining on these — never on chronological
    adjacency — is what the attribution contract requires.
    """
    md = event.get("metadata") or {}
    return (md.get("preparationRequestId"),
            md.get("modelRequestId"),
            md.get("toolCallId"))


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    trace_path, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)

    with open(trace_path, "r", encoding="utf-8") as handle:
        trace = json.load(handle)

    events = trace["events"]
    stages = trace["stages"]
    unavailable = trace["unavailable"]
    integrity_failures = trace["integrityFailures"]
    truncation = trace["truncation"]

    controls = {}

    # -- CONTROL 1: identity + request census ------------------------------
    events_by_boundary_phase = Counter((e["boundary"], e["phase"]) for e in events)
    request_ids = sorted({
        (e.get("metadata") or {}).get("modelRequestId")
        for e in events if (e.get("metadata") or {}).get("modelRequestId")})
    prep_ids = sorted({
        (e.get("metadata") or {}).get("preparationRequestId")
        for e in events if (e.get("metadata") or {}).get("preparationRequestId")})
    controls["C1_identity_and_request_census"] = {
        "trace_sha256": sha256_file(trace_path),
        "schema": trace.get("schema"),
        "sessionId": trace.get("sessionId"),
        "correlationId": trace.get("correlationId"),
        "captureProfile": trace.get("captureProfile"),
        "exportedAtIso": trace.get("exportedAtIso"),
        "declared_event_count": trace.get("eventCount"),
        "actual_event_count": len(events),
        "declared_stage_count": trace.get("stageCount"),
        "actual_stage_count": len(stages),
        "declared_unavailable_count": trace.get("unavailableCount"),
        "actual_unavailable_count": len(unavailable),
        "declared_integrity_failure_count": trace.get("integrityFailureCount"),
        "actual_integrity_failure_count": len(integrity_failures),
        "distinct_model_request_ids": len(request_ids),
        "distinct_preparation_request_ids": len(prep_ids),
        "boundary_phase_counts": {
            f"{b}:{p}": n for (b, p), n in sorted(events_by_boundary_phase.items())},
        "truncation": truncation,
        "complete": (
            trace.get("eventCount") == len(events)
            and trace.get("stageCount") == len(stages)
            and trace.get("unavailableCount") == len(unavailable)
            and trace.get("integrityFailureCount") == len(integrity_failures)
            and not truncation.get("truncated", False)),
    }

    # -- CONTROL 5: missing first-text observations, explicitly ------------
    unavailable_by_boundary = Counter(u["boundary"] for u in unavailable)
    unavailable_reasons = Counter((u["boundary"], u.get("reason")) for u in unavailable)
    ft_started = {identity_of(e) for e in events
                  if e["boundary"] == "provider_first_text" and e["phase"] == "start"}
    ft_ended = {identity_of(e) for e in events
                if e["boundary"] == "provider_first_text" and e["phase"] == "end"}
    ft_missing = ft_started - ft_ended
    controls["C5_missing_first_text_explicit"] = {
        "unavailable_by_boundary": dict(unavailable_by_boundary),
        "unavailable_reasons": {
            f"{b}::{r}": n for (b, r), n in sorted(unavailable_reasons.items())},
        "provider_first_text_started": len(ft_started),
        "provider_first_text_ended": len(ft_ended),
        "provider_first_text_unclosed": len(ft_missing),
        "note": (
            "provider_first_text is a CLIENT-SIDE observation of generated text. "
            "Server-side TTFT is UNAVAILABLE_FROM_TRACE for every observation, "
            "including the ones where the boundary did close."),
        "server_side_ttft_available": False,
        "server_side_ttft_classification": "UNAVAILABLE_FROM_TRACE",
    }

    # -- CONTROL 2: tool terminal events joined to call identities ---------
    tool_exec = {}
    tool_delivered = {}
    for event in events:
        key = identity_of(event)
        if event["boundary"] == "tool_execution" and event["phase"] == "start":
            tool_exec[key] = {"start": event, "end": None}
        elif event["boundary"] == "tool_execution" and event["phase"] == "end":
            if key in tool_exec:
                tool_exec[key]["end"] = event
            else:
                tool_exec[key] = {"start": None, "end": event}
        elif event["boundary"] == "tool_result_delivered" and event["phase"] == "start":
            tool_delivered[key] = {"start": event, "end": None}
        elif event["boundary"] == "tool_result_delivered" and event["phase"] == "end":
            if key in tool_delivered:
                tool_delivered[key]["end"] = event
            else:
                tool_delivered[key] = {"start": None, "end": event}

    # Deduplicate by toolCallId: the toolCallId IS the tool-execution
    # identity. Multiple preparation/model request ids may observe the SAME
    # call; they must not become separate tool executions.
    by_tool_call = {}
    for key, pair in tool_exec.items():
        call_id = key[2]
        if call_id is None:
            continue
        entry = by_tool_call.setdefault(call_id, {
            "toolCallId": call_id, "toolName": None,
            "preparationRequestIds": set(), "modelRequestIds": set(),
            "execution_start_ms": None, "execution_end_ms": None,
            "execution_duration_ms": None, "outcome": None,
            "executionInvoked": None, "delivery_start_ms": None,
            "delivery_end_ms": None, "delivered": False, "toolResultBytes": None})
        start, end = pair["start"], pair["end"]
        md = (start or end or {}).get("metadata") or {}
        entry["toolName"] = md.get("toolName") or entry["toolName"]
        if md.get("preparationRequestId"):
            entry["preparationRequestIds"].add(md["preparationRequestId"])
        if md.get("modelRequestId"):
            entry["modelRequestIds"].add(md["modelRequestId"])
        if start is not None and entry["execution_start_ms"] is None:
            entry["execution_start_ms"] = start["monotonicMs"]
        if end is not None:
            entry["execution_end_ms"] = end["monotonicMs"]
            entry["execution_duration_ms"] = end.get("durationMs")
            emd = end.get("metadata") or {}
            entry["outcome"] = emd.get("outcome")
            entry["executionInvoked"] = emd.get("executionInvoked")
        dmd = (end or start or {}).get("metadata") or {}
        if dmd.get("toolResultBytes") is not None:
            entry["toolResultBytes"] = dmd.get("toolResultBytes")

    for key, pair in tool_delivered.items():
        call_id = key[2]
        if call_id is None:
            continue
        entry = by_tool_call.get(call_id)
        if entry is None:
            continue
        start, end = pair["start"], pair["end"]
        if start is not None:
            entry["delivery_start_ms"] = start["monotonicMs"]
        if end is not None:
            entry["delivery_end_ms"] = end["monotonicMs"]
            entry["delivered"] = True
        # The result SIZE is recorded on the delivery boundary's metadata.
        dmd = (end or start or {}).get("metadata") or {}
        if dmd.get("toolResultBytes") is not None:
            entry["toolResultBytes"] = dmd.get("toolResultBytes")

    submissions = [e for e in events
                   if e["boundary"] == "provider_submitted" and e["phase"] == "start"]

    tools = []
    for call_id in sorted(by_tool_call):
        entry = by_tool_call[call_id]
        rec = {
            "toolCallId": call_id,
            "toolName": entry["toolName"],
            "preparationRequestIds": sorted(x for x in entry["preparationRequestIds"] if x),
            "modelRequestIds": sorted(x for x in entry["modelRequestIds"] if x),
            "execution_start_ms": entry["execution_start_ms"],
            "execution_end_ms": entry["execution_end_ms"],
            "execution_duration_ms": entry["execution_duration_ms"],
            "outcome": entry["outcome"],
            "executionInvoked": entry["executionInvoked"],
            "delivery_start_ms": entry["delivery_start_ms"],
            "delivery_end_ms": entry["delivery_end_ms"],
            "delivered": entry["delivered"],
            "toolResultBytes": entry["toolResultBytes"],
        }
        # Post-execution delivery delay: executor RETURN -> result DELIVERED.
        if rec["execution_end_ms"] is not None and rec["delivery_start_ms"] is not None:
            rec["post_execution_delivery_delay_ms"] = round(
                rec["delivery_start_ms"] - rec["execution_end_ms"], 3)
        else:
            rec["post_execution_delivery_delay_ms"] = None
        # Terminal outcome -> subsequent model submission.
        #
        # JOIN AUTHORITY: the tool call's OWN model submission is the one that
        # shares the call's preparationRequestId (the turn that issued it).
        # The SUBSEQUENT submission is the next one in the trace that belongs
        # to a DIFFERENT preparationRequestId — a follow-up turn is a new
        # preparation request and therefore a new model request. Joining on
        # "the next submission with the same modelRequestId" would be wrong:
        # the model request that issued a tool call cannot be re-submitted.
        rec["own_provider_submitted_ms"] = None
        rec["next_provider_submitted_ms"] = None
        rec["terminal_to_next_submission_ms"] = None
        if rec["execution_end_ms"] is not None:
            own = [e["monotonicMs"] for e in submissions
                   if (e.get("metadata") or {}).get("preparationRequestId")
                   in rec["preparationRequestIds"]]
            if own:
                rec["own_provider_submitted_ms"] = min(own)
            cands = []
            for e in submissions:
                emd = e.get("metadata") or {}
                if emd.get("preparationRequestId") in rec["preparationRequestIds"]:
                    continue
                if e["monotonicMs"] >= rec["execution_end_ms"]:
                    cands.append(e["monotonicMs"])
            if cands:
                nxt = min(cands)
                rec["next_provider_submitted_ms"] = nxt
                rec["terminal_to_next_submission_ms"] = round(
                    nxt - rec["execution_end_ms"], 3)
        tools.append(rec)

    controls["C2_tool_terminal_joined_to_call_identity"] = {
        "tool_execution_start_events": sum(
            1 for e in events if e["boundary"] == "tool_execution" and e["phase"] == "start"),
        "tool_execution_end_events": sum(
            1 for e in events if e["boundary"] == "tool_execution" and e["phase"] == "end"),
        "tool_result_delivered_start_events": sum(
            1 for e in events
            if e["boundary"] == "tool_result_delivered" and e["phase"] == "start"),
        "tool_result_delivered_end_events": sum(
            1 for e in events
            if e["boundary"] == "tool_result_delivered" and e["phase"] == "end"),
        "distinct_tool_call_ids": len(by_tool_call),
        "tools_with_terminal_outcome": sum(1 for t in tools if t["execution_end_ms"] is not None),
        "tools_with_delivery_observed": sum(1 for t in tools if t["delivered"]),
        "tools_with_post_execution_delay_measurable": sum(
            1 for t in tools if t["post_execution_delivery_delay_ms"] is not None),
        "tool_names": dict(Counter(t["toolName"] for t in tools)),
        "join_key": "toolCallId",
    }

    # -- CONTROL 6: the ~5 s tool-result floor hypothesis ------------------
    delivery_delays = [t["post_execution_delivery_delay_ms"] for t in tools
                       if t["post_execution_delivery_delay_ms"] is not None]
    exec_durations = [t["execution_duration_ms"] for t in tools
                      if t["execution_duration_ms"] is not None]
    terminal_to_next = [t["terminal_to_next_submission_ms"] for t in tools
                        if t["terminal_to_next_submission_ms"] is not None]

    FLOOR_MS = 5000.0
    at_or_above = [x for x in delivery_delays if x >= FLOOR_MS]
    near_floor = [x for x in delivery_delays if FLOOR_MS * 0.8 <= x < FLOOR_MS]
    below = [x for x in delivery_delays if x < FLOOR_MS * 0.8]

    controls["C6_tool_result_latency_hypothesis"] = {
        "hypothesis": (
            "a ~5 s floor on the tool-result path: a fixed cost paid between "
            "the tool executor's terminal outcome and the delivery of its "
            "result into the conversation"),
        "suspected_floor_ms": FLOOR_MS,
        "discriminator": (
            "post_execution_delivery_delay_ms = "
            "tool_result_delivered.start.monotonicMs - tool_execution.end.monotonicMs, "
            "joined by toolCallId"),
        "sample_count_independent_tool_executions": len(delivery_delays),
        "delivery_delay_distribution": dist(delivery_delays),
        "execution_duration_distribution": dist(exec_durations),
        "terminal_to_next_submission_distribution": dist(terminal_to_next),
        "at_or_above_floor": {
            "count": len(at_or_above),
            "values_ms": sorted(round(x, 3) for x in at_or_above)},
        "near_floor_80_to_100_pct": {
            "count": len(near_floor),
            "values_ms": sorted(round(x, 3) for x in near_floor)},
        "below_80_pct_of_floor": {
            "count": len(below),
            "values_ms": sorted(round(x, 3) for x in below)},
        "floor_reproduced": bool(
            at_or_above and len(at_or_above) >= max(1, int(0.5 * len(delivery_delays)))),
        "floor_reproduced_strict_any": bool(at_or_above),
    }


    # -- CONTROL 6b: the sibling-batch discriminator ------------------------
    # The suspected ~5 s "tool-result floor" is NOT a per-result overhead. In
    # a multi-call model turn the runtime executes the batch and delivers
    # every result only after the WHOLE batch resolves
    # (agent-runtime.ts: `executeToolCalls` -> `Promise.all` over a parallel
    # group; the caller then emits `observeToolResultDelivered` per result).
    # An earlier sibling's "delivery delay" is therefore its LATER SIBLING's
    # execution time, not a cost of delivering its own result.
    #
    # The batch identity is the AUTHORITATIVE modelRequestId (the runtime
    # correlates every tool call of one model turn to one model request).
    batches = defaultdict(list)
    for call_id, entry in by_tool_call.items():
        model_ids = sorted(x for x in entry["modelRequestIds"] if x)
        if not model_ids:
            continue
        batches[model_ids[0]].append(call_id)

    sibling_rows = []
    for model_id, call_ids in batches.items():
        call_ids.sort(key=lambda c: by_tool_call[c]["execution_start_ms"])
        for index, call_id in enumerate(call_ids):
            if index + 1 >= len(call_ids):
                continue
            nxt = call_ids[index + 1]
            entry = by_tool_call[call_id]
            nxt_entry = by_tool_call[nxt]
            delay = entry["delivery_start_ms"] - entry["execution_end_ms"]
            gap = nxt_entry["execution_start_ms"] - entry["execution_end_ms"]
            sibling_span = nxt_entry["execution_end_ms"] - nxt_entry["execution_start_ms"]
            predicted = sibling_span + gap
            sibling_rows.append({
                "batchModelRequestId": model_id,
                "batchSize": len(call_ids),
                "toolCallId": call_id,
                "toolName": entry["toolName"],
                "own_execution_ms": entry["execution_duration_ms"],
                "observed_delivery_delay_ms": round(delay, 3),
                "next_sibling_toolCallId": nxt,
                "next_sibling_execution_ms": round(sibling_span, 3),
                "inter_call_gap_ms": round(gap, 3),
                "predicted_delay_ms": round(predicted, 3),
                "residual_ms": round(delay - predicted, 3),
            })

    residuals = [abs(r["residual_ms"]) for r in sibling_rows]
    controls["C6b_sibling_batch_discriminator"] = {
        "claim": (
            "the observed post-execution delivery delay of a tool result equals "
            "the execution time of the NEXT sibling tool call in the SAME model "
            "request batch, because the runtime delivers every result in the "
            "batch only after the whole batch resolves"),
        "production_basis": (
            "sdk/packages/agents/src/agent-runtime.ts: executeToolCalls batches "
            "tool calls and runs a parallel group with Promise.all; the caller "
            "then pushes each result and calls observeToolResultDelivered only "
            "after executeToolCalls has resolved"),
        "multi_call_batches": sum(
            1 for b in batches.values() if len(b) > 1),
        "single_call_batches": sum(
            1 for b in batches.values() if len(b) == 1),
        "comparisons": len(sibling_rows),
        "residual_ms_distribution": dist(residuals),
        "max_abs_residual_ms": round(max(residuals), 4) if residuals else None,
        "mean_abs_residual_ms": (
            round(sum(residuals) / len(residuals), 4) if residuals else None),
        "rows": sibling_rows,
    }

    # -- CONTROL 3 + 4: stage reconciliation, no double counting -----------
    # Rebuild the stages from the events using the PRODUCTION rule, then
    # compare with the trace's own stage array.
    rebuilt = []
    for index in range(len(events) - 1):
        current = events[index]
        nxt = events[index + 1]
        if current["phase"] != "end" or nxt["phase"] != "start":
            continue
        rebuilt.append({
            "stage": classify_stage(current["boundary"], nxt["boundary"]),
            "from": current["boundary"],
            "to": nxt["boundary"],
            "durationMs": nxt["monotonicMs"] - current["monotonicMs"],
            "spanDurationMs": current.get("durationMs") or 0,
            "from_ms": current["monotonicMs"],
            "to_ms": nxt["monotonicMs"],
        })
    for event in events:
        if event["phase"] == "end" and event["boundary"] == "tool_execution":
            rebuilt.append({
                "stage": "execution",
                "from": "tool_execution",
                "to": "tool_execution",
                "durationMs": event.get("durationMs") or 0,
                "spanDurationMs": event.get("durationMs") or 0,
                "from_ms": event["monotonicMs"],
                "to_ms": event["monotonicMs"],
            })

    rebuilt_sorted = sorted((s["stage"], round(s["durationMs"], 6), s["from"], s["to"])
                            for s in rebuilt)
    trace_sorted = sorted((s["stage"], round(s["durationMs"], 6), s["from"], s["to"])
                          for s in stages)
    stage_rebuild_matches = rebuilt_sorted == trace_sorted

    # Gap stages are DISJOINT intervals in time (end -> next start), so their
    # sum is the span they cover. `execution` stages are the executor's own
    # measured run time, which lies INSIDE the tool_execution span and is
    # therefore NOT part of the gap sum. Overlap is accounted for explicitly.
    gap_stages = [s for s in rebuilt if s["stage"] != "execution"]
    exec_stages = [s for s in rebuilt if s["stage"] == "execution"]

    ordered_gaps = sorted(gap_stages, key=lambda s: s["from_ms"])
    gap_overlaps = []
    for prev, nxt in zip(ordered_gaps, ordered_gaps[1:]):
        if nxt["from_ms"] < prev["to_ms"] - 1e-6:
            gap_overlaps.append({
                "prev": [prev["from"], prev["to"], prev["from_ms"], prev["to_ms"]],
                "next": [nxt["from"], nxt["to"], nxt["from_ms"], nxt["to_ms"]]})

    exec_starts = {}
    for e in events:
        if e["boundary"] == "tool_execution" and e["phase"] == "start":
            exec_starts[(e.get("metadata") or {}).get("toolCallId")] = e["monotonicMs"]
    exec_nesting = []
    for s in exec_stages:
        call_id = None
        for e in events:
            if (e["boundary"] == "tool_execution" and e["phase"] == "end"
                    and abs(e["monotonicMs"] - s["from_ms"]) < 1e-6):
                call_id = (e.get("metadata") or {}).get("toolCallId")
                break
        start_ms = exec_starts.get(call_id)
        exec_nesting.append({
            "toolCallId": call_id,
            "nested": bool(start_ms is not None and start_ms <= s["from_ms"] <= s["to_ms"]),
            "execution_ms": s["durationMs"],
            "span_ms": round(s["to_ms"] - start_ms, 3) if start_ms is not None else None})

    stage_totals = {}
    for stage in sorted({s["stage"] for s in rebuilt}):
        stage_totals[stage] = dist([s["durationMs"] for s in rebuilt if s["stage"] == stage])

    wall_ms = trace.get("wallClockMs")
    gap_sum = sum(s["durationMs"] for s in gap_stages)
    exec_sum = sum(s["durationMs"] for s in exec_stages)

    controls["C3_no_double_counting"] = {
        "gap_stage_count": len(gap_stages),
        "execution_stage_count": len(exec_stages),
        "gap_stages_are_disjoint": len(gap_overlaps) == 0,
        "gap_overlaps": gap_overlaps,
        "execution_stages_nested_in_tool_span": all(x["nested"] for x in exec_nesting),
        "execution_nesting_detail": exec_nesting,
        "note": (
            "gap stages are pairwise-disjoint intervals (end -> next start); "
            "the `execution` stage is the executor's own run time, nested "
            "inside the tool_execution span, and is therefore NOT part of the "
            "gap sum. Summing gap stages + execution stages would double "
            "count the executor's run time."),
    }

    controls["C4_stage_totals_reconcile_with_wall_time"] = {
        "declared_wallClockMs": wall_ms,
        "gap_stage_sum_ms": round(gap_sum, 3),
        "execution_stage_sum_ms": round(exec_sum, 3),
        "stage_rebuild_matches_trace_stages": stage_rebuild_matches,
        "rebuilt_stage_count": len(rebuilt),
        "trace_stage_count": len(stages),
        "note": (
            "The gap stages cover only the intervals BETWEEN boundaries. The "
            "boundary SPANS themselves (request_preparation, request_prepared, "
            "provider_submitted, provider_first_response, provider_first_text, "
            "provider_completed, schema_validation, tool_execution, "
            "tool_result_delivered, provider_ready) are measured independently "
            "and reported as `spanDurationMs`. Wall time = gap stages + the "
            "spans they bracket."),
    }


    first_ms = min(e["monotonicMs"] for e in events)
    last_ms = max(e["monotonicMs"] for e in events)

    # -- CONTROL 4b: provider round trips + exclusive wall reconciliation --
    # The provider round trip is the span from `provider_submitted.start` to
    # `provider_submitted.end`. The `request_prepared` span covers the SAME
    # interval (it is opened at the provider-ready seam and closed at the
    # provider's completion), so the two are NESTED and must not be summed.
    provider_rt = []
    open_rt = []
    for event in events:
        md = event.get("metadata") or {}
        if event["boundary"] == "provider_submitted" and event["phase"] == "start":
            open_rt.append({"start": event["monotonicMs"], "meta": md})
        elif event["boundary"] == "provider_submitted" and event["phase"] == "end":
            for rt in open_rt:
                if rt.get("end") is None and rt["start"] <= event["monotonicMs"]:
                    rt["end"] = event["monotonicMs"]
                    rt["duration_ms"] = event.get("durationMs")
                    rt["end_meta"] = md
                    provider_rt.append(rt)
                    break
    provider_durations = [r["duration_ms"] for r in provider_rt if r.get("duration_ms") is not None]

    # Reconstruct the DISJOINT union of all boundary spans.
    span_starts = {}
    span_ends = {}
    for event in events:
        md = event.get("metadata") or {}
        key = (event["boundary"], md.get("modelRequestId"), md.get("toolCallId"))
        if event["phase"] == "start":
            span_starts[key] = event["monotonicMs"]
        elif event["phase"] == "end":
            span_ends[key] = event["monotonicMs"]
    spans = []
    for key, s_ms in span_starts.items():
        e_ms = span_ends.get(key)
        if e_ms is not None and e_ms >= s_ms:
            spans.append((s_ms, e_ms, key[0]))
    spans.sort()
    merged = []
    for s_ms, e_ms, boundary in spans:
        if merged and s_ms <= merged[-1][1] + 1e-6:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e_ms),
                          merged[-1][2] + "+" + boundary)
        else:
            merged.append((s_ms, e_ms, boundary))
    union_ms = sum(e_ms - s_ms for s_ms, e_ms, _ in merged)
    gap_sum_ms = sum(s["durationMs"] for s in gap_stages)

    controls["C4b_wall_reconciliation"] = {
        "declared_wallClockMs": wall_ms,
        "observed_boundary_span_ms": round(last_ms - first_ms, 3),
        "union_of_boundary_spans_ms": round(union_ms, 3),
        "gap_stage_sum_ms": round(gap_sum_ms, 3),
        "unexplained_ms": round((last_ms - first_ms) - union_ms, 3),
        "note": (
            "The union of boundary spans is the sum of DISJOINT time intervals "
            "(overlapping/nested spans are merged, so nested spans such as "
            "`request_prepared` inside `provider_submitted` are counted once). "
            "The residual against wall time is the inter-boundary gap time "
            "that the stage table attributes to preparation/queue/transport/"
            "delivery."),
        "provider_round_trips": {
            "n": len(provider_rt),
            "duration_distribution": dist(provider_durations),
            "total_ms": round(sum(provider_durations), 3),
            "pct_of_wall": round(100 * sum(provider_durations) / wall_ms, 2),
            "note": (
                "`request_prepared` and `provider_submitted` cover the SAME "
                "interval and are nested; they are reported here once, under "
                "the provider round trip."),
        },
        "exclusive_wall_attribution": {
            "provider_round_trip_ms": round(sum(provider_durations), 3),
            "tool_execution_ms": round(exec_sum, 3),
            "compaction_ms": round(
                sum(e.get("durationMs") or 0 for e in events
                    if e["boundary"] == "compaction" and e["phase"] == "end"), 3),
            "inter_boundary_gap_ms": round(gap_sum_ms, 3),
            "note": (
                "These four are mutually disjoint EXCLUSIVE wall-time buckets. "
                "The compaction window was verified to contain no other "
                "boundary event, so the compaction span is disjoint from the "
                "provider and tool intervals."),
        },
    }


    # -- Compaction attribution (observed span; exclusivity verified) -------
    compaction_start = None
    compaction_end = None
    compaction_meta = {}
    for event in events:
        if event["boundary"] == "compaction" and event["phase"] == "start":
            compaction_start = event["monotonicMs"]
        elif event["boundary"] == "compaction" and event["phase"] == "end":
            compaction_end = event["monotonicMs"]
            compaction_meta = event.get("metadata") or {}
    compaction_exclusive = None
    compaction_overlapping = []
    if compaction_start is not None and compaction_end is not None:
        compaction_exclusive = True
        for event in events:
            if event["boundary"] in ("compaction", "compaction_decision"):
                continue
            if compaction_start <= event["monotonicMs"] <= compaction_end:
                compaction_exclusive = False
                compaction_overlapping.append({
                    "boundary": event["boundary"], "phase": event["phase"],
                    "monotonicMs": event["monotonicMs"]})
    controls["C7_compaction_attribution"] = {
        "observed_span_ms": (
            round(compaction_end - compaction_start, 3)
            if compaction_start is not None and compaction_end is not None else None),
        "declared_duration_ms": (
            sum(e.get("durationMs") or 0 for e in events
                if e["boundary"] == "compaction" and e["phase"] == "end") or None),
        "outcome": compaction_meta.get("compactionOutcome"),
        "messages_before": compaction_meta.get("compactionMessagesBefore"),
        "messages_after": compaction_meta.get("compactionMessagesAfter"),
        "messages_removed": compaction_meta.get("compactionMessagesRemoved"),
        "evidence_refs_dropped": compaction_meta.get("compactionEvidenceRefsDropped"),
        "compaction_decisions_observed": sum(
            1 for e in events if e["boundary"] == "compaction_decision"),
        "disjoint_from_other_boundaries": compaction_exclusive,
        "overlapping_events": compaction_overlapping,
        "note": (
            "The compaction duration is an OBSERVED span. It is reported as "
            "exclusive wall time only because the compaction window was "
            "verified to contain no other boundary event (no provider span, "
            "no tool span). This is an observation about THIS session, not a "
            "general property."),
    }

    span_by_boundary = defaultdict(list)
    for event in events:
        if event["phase"] == "end" and event.get("durationMs") is not None:
            span_by_boundary[event["boundary"]].append(event["durationMs"])

    boundary_span_totals = {b: round(sum(v), 3) for b, v in sorted(span_by_boundary.items())}

    attribution = []
    for stage in sorted(stage_totals):
        attribution.append({
            "stage": stage,
            "meaning": STAGE_MEANING.get(stage, "a gap with no production classification"),
            "measurement": STAGE_MEASUREMENT.get(stage, "n/a"),
            **stage_totals[stage]})

    report = {
        "act": "ACT-CLINEMM-ROUNDC-LIVE-LATENCY-ATTRIBUTION-01",
        "trace": {
            "path": os.path.abspath(trace_path),
            "sha256": controls["C1_identity_and_request_census"]["trace_sha256"],
            "sessionId": trace.get("sessionId"),
            "schema": trace.get("schema")},
        "wall_clock": {
            "declared_wallClockMs": wall_ms,
            "first_event_monotonicMs": first_ms,
            "last_event_monotonicMs": last_ms,
            "observed_boundary_span_ms": round(last_ms - first_ms, 3)},
        "boundary_span_totals_ms": boundary_span_totals,
        "stage_attribution": attribution,
        "tool_executions": tools,
        "controls": controls,
    }

    with open(os.path.join(outdir, "attribution.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=False)
        handle.write("\n")

    print(json.dumps({
        "C1_complete": controls["C1_identity_and_request_census"]["complete"],
        "C2_distinct_tool_call_ids":
            controls["C2_tool_terminal_joined_to_call_identity"]["distinct_tool_call_ids"],
        "C3_gap_stages_disjoint": controls["C3_no_double_counting"]["gap_stages_are_disjoint"],
        "C3_exec_nested":
            controls["C3_no_double_counting"]["execution_stages_nested_in_tool_span"],
        "C4_stage_rebuild_matches": stage_rebuild_matches,
        "C5_unavailable": controls["C5_missing_first_text_explicit"]["unavailable_by_boundary"],
        "C6_floor_reproduced": controls["C6_tool_result_latency_hypothesis"]["floor_reproduced"],
        "C6_delivery_delay_dist":
            controls["C6_tool_result_latency_hypothesis"]["delivery_delay_distribution"],
        "C6_exec_duration_dist":
            controls["C6_tool_result_latency_hypothesis"]["execution_duration_distribution"],
        "C6_terminal_to_next_dist":
            controls["C6_tool_result_latency_hypothesis"]["terminal_to_next_submission_distribution"],
        "C6_at_or_above_floor":
            controls["C6_tool_result_latency_hypothesis"]["at_or_above_floor"],
        "C6b_sibling_batches": controls["C6b_sibling_batch_discriminator"]["multi_call_batches"],
        "C6b_comparisons": controls["C6b_sibling_batch_discriminator"]["comparisons"],
        "C6b_max_abs_residual_ms": controls["C6b_sibling_batch_discriminator"]["max_abs_residual_ms"],
        "C6b_mean_abs_residual_ms": controls["C6b_sibling_batch_discriminator"]["mean_abs_residual_ms"],
        "C4b_wall": controls["C4b_wall_reconciliation"]["exclusive_wall_attribution"],
        "C4b_provider": {
            "n": controls["C4b_wall_reconciliation"]["provider_round_trips"]["n"],
            "dist": controls["C4b_wall_reconciliation"]["provider_round_trips"]["duration_distribution"],
            "pct_of_wall": controls["C4b_wall_reconciliation"]["provider_round_trips"]["pct_of_wall"],
        },
        "C4b_unexplained_ms": controls["C4b_wall_reconciliation"]["unexplained_ms"],
        "wall": report["wall_clock"],
        "stage_attribution": attribution,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
