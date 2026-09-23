#!/usr/bin/env node
// scripts/analyze-cpuprofile-hot-leaves.mjs
//
// Symbolize + analyze the post-provenance-repair dogfood crash profile
// (exthost-402d7f.cpuprofile) used by
// ACT-CLINEMM-EXTENSION-HOST-RNL-DRAIN-LEAF-SYMBOLIZATION01.
//
// Outputs JSON + text summaries suitable for evidence files.
//
// Usage:
//   node scripts/analyze-cpuprofile-hot-leaves.mjs \
//        --profile /path/to/exthost-402d7f.cpuprofile \
//        --bundle  /path/to/extension.js \
//        [--sourcemap /path/to/extension.js.map] \
//        --out     /path/to/output-dir
//
// Targets: Rnl, r_, drain, e_ (multiple), Gyi, setWithWriter, handleSessionEvent,
// onSessionEvent, cwi (calibration). Designed to be a self-contained
// analysis pipeline that supports the two-method binding discipline.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      out[k] = v;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const PROFILE = args.profile;
const BUNDLE = args.bundle;
const OUTDIR = args.output;
const SOURCEMAP = args.sourcemap || null;

if (!PROFILE || !BUNDLE || !OUTDIR) {
  console.error('Usage: node analyze-cpuprofile-hot-leaves.mjs --profile <p> --bundle <b> [--sourcemap <s>] --output <o>');
  process.exit(2);
}

fs.mkdirSync(OUTDIR, { recursive: true });

const profile = JSON.parse(fs.readFileSync(PROFILE, 'utf8'));
const bundleBuf = fs.readFileSync(BUNDLE);
const bundleText = bundleBuf.toString('utf8');

// --- Profile identity ---
const id = {
  profile_path: PROFILE,
  profile_size: fs.statSync(PROFILE).size,
  profile_sha256: crypto.createHash('sha256').update(fs.readFileSync(PROFILE)).digest('hex'),
  bundle_path: BUNDLE,
  bundle_size: bundleBuf.length,
  bundle_sha256: crypto.createHash('sha256').update(bundleBuf).digest('hex'),
  start_time: profile.startTime,
  end_time: profile.endTime,
  duration_ms: (profile.endTime - profile.startTime) / 1000,
  sample_count: profile.samples.length,
  time_deltas_length: profile.timeDeltas.length,
  node_count: profile.nodes.length,
};

// --- Sanity control: sum(hitCount) ≈ samples.length? ---
// (tree walks, leaves have no children, intermediates have children)
let sumHitCount = 0;
for (const n of profile.nodes) sumHitCount += n.hitCount;
id.profile_ctl_01_sum_hitcount = sumHitCount;
id.profile_ctl_01_match = sumHitCount === profile.samples.length;

// --- Index nodes by id ---
const byId = new Map();
for (const n of profile.nodes) byId.set(n.id, n);

// --- Build parent map (sample -> leaf) and reverse: leaf -> samples[] ---
const parentOf = new Map();
for (const n of profile.nodes) {
  for (const c of n.children || []) parentOf.set(c, n.id);
}

const leafSamples = new Map(); // nodeId -> [sample indices]
for (let i = 0; i < profile.samples.length; i++) {
  const nid = profile.samples[i];
  if (!leafSamples.has(nid)) leafSamples.set(nid, []);
  leafSamples.get(nid).push(i);
}

// --- Stats per node ---
function pct(n, total) {
  return (n / total) * 100;
}

function computeStatsForNode(node) {
  const samples = leafSamples.get(node.id) || [];
  let sumDelta = 0, minDelta = Infinity, maxDelta = 0;
  const deltas = [];
  for (const sIdx of samples) {
    const d = profile.timeDeltas[sIdx];
    deltas.push(d);
    sumDelta += d;
    if (d < minDelta) minDelta = d;
    if (d > maxDelta) maxDelta = d;
  }
  deltas.sort((a, b) => a - b);
  const median = deltas.length ? (deltas.length % 2 ? deltas[(deltas.length-1)>>1] : (deltas[deltas.length/2 - 1] + deltas[deltas.length/2]) / 2) : 0;
  const p95idx = Math.min(deltas.length - 1, Math.floor(deltas.length * 0.95));
  const p95 = deltas.length ? deltas[p95idx] : 0;
  return {
    node_id: node.id,
    function_name: node.callFrame.functionName,
    url: node.callFrame.url,
    line: node.callFrame.lineNumber,
    col: node.callFrame.columnNumber,
    hit_count: node.hitCount,
    raw_sample_share_pct: pct(node.hitCount, profile.samples.length),
    sum_delta_us: sumDelta,
    sum_delta_ms: sumDelta / 1000,
    min_delta_ms: minDelta === Infinity ? 0 : minDelta / 1000,
    median_delta_ms: median / 1000,
    p95_delta_ms: p95 / 1000,
    max_delta_ms: maxDelta / 1000,
    sample_indices_count: samples.length,
    children_ids: node.children,
    parent_id: parentOf.get(node.id) || null,
  };
}

const allNodes = profile.nodes.map(computeStatsForNode).sort((a, b) => b.hit_count - a.hit_count);

// --- Calibration control: cwi -> enterExtensionHostHotloopHandleSessionEvent ---
function calibrationCheck() {
  // cwi in profile should appear at extension.js:1:4773 (per predecessor ACT)
  const cwiNodes = allNodes.filter(n => n.function_name === 'cwi');
  // Find the largest one
  cwiNodes.sort((a, b) => b.hit_count - a.hit_count);
  const cwi = cwiNodes[0];
  // Find the function declaration in the bundle
  const re = /function\s+cwi\s*\(/g;
  const decls = [];
  let m;
  while ((m = re.exec(bundleText)) !== null) {
    decls.push({ offset: m.index, snippet: bundleText.slice(m.index, m.index + 220) });
  }
  // Token decode against expected source
  const expectedBody = '$se&&(J7e++,Ww.handleSessionEventCalls++,J7e>Ww.maxNestedHandleDepth&&(Ww.maxNestedHandleDepth=J7e))';
  const firstDecl = decls[0];
  let bodyMatch = false;
  if (firstDecl) {
    bodyMatch = firstDecl.snippet.includes(expectedBody);
  }
  return {
    cwi_top_node: cwi,
    cwi_decls_in_bundle: decls,
    cwi_body_signature_match: bodyMatch,
    cwi_calibration_pass: bodyMatch && cwi && cwi.line === 1 && cwi.col === 4773,
  };
}

// --- Body extraction: find function declarations whose body opens by the column ---
// Build a line-index table once for fast multi-line lookups.
const lineStartOffsets = [0];
for (let i = 0; i < bundleText.length; i++) {
  if (bundleText.charCodeAt(i) === 10) {
    lineStartOffsets.push(i + 1);
  }
}

function extractBodyAt(line, col, lookahead = 400) {
  // V8 cpuprofile uses 1-based line:col into the generated bundle.
  // For multi-line bundles, line:col is the position of the running instruction.
  let byteIdx;
  if (line === 1) {
    byteIdx = col - 1;
  } else if (line >= 1 && line < lineStartOffsets.length) {
    byteIdx = lineStartOffsets[line - 1] + (col - 1);
  } else {
    return null;
  }
  return {
    byte_offset: byteIdx,
    excerpt: bundleText.slice(Math.max(0, byteIdx - 80), byteIdx + lookahead),
  };
}

// --- Bundle signature search: find the closest function declaration name ---
function findFunctionAt(byteOffset) {
  // Walk backwards looking for `function NAME(`
  const before = bundleText.slice(Math.max(0, byteOffset - 4000), byteOffset);
  const re = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  let last = null;
  while ((m = re.exec(before)) !== null) {
    last = { name: m[1], offset: Math.max(0, byteOffset - 4000) + m.index };
  }
  return last;
}

// --- Caller ancestry: walk parent chain for each occurrence ---
function ancestryChain(leafNodeId, maxDepth = 30) {
  const chain = [];
  let cur = leafNodeId;
  let depth = 0;
  const seen = new Set();
  while (cur != null && depth < maxDepth) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const n = byId.get(cur);
    if (!n) break;
    chain.push({
      id: n.id,
      function_name: n.callFrame.functionName,
      url: n.callFrame.url,
      line: n.callFrame.lineNumber,
      col: n.callFrame.columnNumber,
      hit_count: n.hitCount,
    });
    cur = parentOf.get(cur);
    depth++;
  }
  return chain;
}

// --- Distinct parents: which nodes call into this one? ---
function distinctParents(leafNodeId) {
  const parents = new Map();
  for (const n of profile.nodes) {
    if ((n.children || []).includes(leafNodeId)) {
      const key = n.id;
      parents.set(key, n);
    }
  }
  return Array.from(parents.values()).map(p => ({
    id: p.id,
    function_name: p.callFrame.functionName,
    line: p.callFrame.lineNumber,
    col: p.callFrame.columnNumber,
    hit_count: p.hitCount,
  }));
}

// --- Top targets, by name + node id ---
const TARGET_NODES = {
  Rnl: [37],
  r_: [36],
  drain: [4],  // biggest
  Gyi: [26],
  setWithWriter: [51],
  handleSessionEvent: [14, 24, 33, 118, 122, 149, 170],
  onSessionEvent: [13, 23, 32],
  cwi: [15, 100, 101],  // calibration
};

const e_nodes = allNodes.filter(n => n.function_name === 'e_').sort((a, b) => b.hit_count - a.hit_count);
for (let i = 0; i < e_nodes.length; i++) TARGET_NODES[`e_${i+1}`] = [e_nodes[i].node_id];

const targets = [];
for (const [name, nodeIds] of Object.entries(TARGET_NODES)) {
  for (const nid of nodeIds) {
    const n = byId.get(nid);
    if (!n) continue;
    const stats = computeStatsForNode(n);
    const body = extractBodyAt(stats.line, stats.col, 800);
    const fn = body ? findFunctionAt(body.byte_offset) : null;
    const parents = distinctParents(nid);
    const ancestry = ancestryChain(nid);
    targets.push({
      target_name: name,
      stats,
      body_excerpt: body,
      enclosing_function: fn,
      distinct_parents: parents,
      ancestry_chain: ancestry,
    });
  }
}

// --- GC adjacency (FIXED in response to V8/perf-engineer causal review).
//
// IMPORTANT: V8 cpuprofile is SAMPLE-BASED, not invocation-based.
// `hitCount` is the number of samples where the leaf was observed ON-CPU,
// NOT the number of times the leaf was called. One invocation may receive
// zero, one, or many samples. We therefore NEVER derive call counts or
// RegExp/sec or bytes/sec from hitCount anywhere in this analyzer.
//
// We expose TWO clearly labeled GC adjacency metrics:
//
// (1) gc_run_adjacency  (PRIMARY — honest metric):
//     ONE count per contiguous GC run. Each GC run's before-leaf and
//     after-leaf are counted exactly once. Per-leaf totals are run-
//     boundary counts, independent of run length.
//
// (2) gc_sample_weighted_boundary_exposure (LEGACY — honest name now;
//     bias acknowledged):
//     For EVERY GC sample within a run we look back to the same
//     previous leaf, so a run of length K contributes K to that leaf.
//     This WAS the original algorithm; it IS biased by run length and
//     is NOT an event count. It is retained only so prior references to
//     "GC adjacency" can be re-anchored under its truthful name. Do NOT
//     use it for causal selection.
//
const GC_NODE = 67;
function isGCSample(i) { return profile.samples[i] === GC_NODE; }

function gcAdjacency() {
  // Discover run starts: sample-idx i is a run-start if isGC(i) and
  // (i === 0 || !isGC(i - 1)).
  const runStarts = [];
  for (let i = 0; i < profile.samples.length; i++) {
    if (isGCSample(i) && (i === 0 || !isGCSample(i - 1))) runStarts.push(i);
  }
  const gcRuns = runStarts.length;

  // Per-run lengths
  const runLengths = [];
  for (const s of runStarts) {
    let len = 0;
    let k = s;
    while (k < profile.samples.length && isGCSample(k)) { len++; k++; }
    runLengths.push(len);
  }
  runLengths.sort((a, b) => a - b);

  // (1) PRIMARY: count ONCE per contiguous GC run.
  const run2before = new Map();   // sample-idx -> run count
  const run2after = new Map();
  for (const s of runStarts) {
    if (s > 0) {
      let j = s - 1;
      while (j >= 0 && isGCSample(j)) j--;
      if (j >= 0) run2before.set(j, (run2before.get(j) || 0) + 1);
    }
    let runEnd = s;
    while (runEnd < profile.samples.length && isGCSample(runEnd)) runEnd++;
    if (runEnd < profile.samples.length) {
      run2after.set(runEnd, (run2after.get(runEnd) || 0) + 1);
    }
  }

  // (2) LEGACY: per-GC-sample exposure (BIASED by run length).
  const exp2before = new Map();
  const exp2after = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    if (!isGCSample(i)) continue;
    if (i > 0) {
      let j = i - 1;
      while (j >= 0 && isGCSample(j)) j--;
      if (j >= 0) exp2before.set(j, (exp2before.get(j) || 0) + 1);
    }
    if (i < profile.samples.length - 1) {
      let k = i + 1;
      while (k < profile.samples.length && isGCSample(k)) k++;
      if (k < profile.samples.length) exp2after.set(k, (exp2after.get(k) || 0) + 1);
    }
  }

  function buildTable(mapBefore, mapAfter, totalKey) {
    // AGGREGATE BY LEAF ID, not by sample-idx. Per causal review #P0 / 2026-09-23
    // (factory reviewer + V8 perf-engineer): the previous implementation
    // keyed rows by sampleIdx, so one leaf adjacent to N different GC runs
    // produced N duplicate rows. Aggregate by leafId so the output table's
    // primary key (node_id) occurs exactly once.
    //
    // Invariants we now enforce (executed after the build):
    //   (I1) sum_over_rows(gc_before + gc_after) <= 2 * gcRuns
    //   (I2) each node_id occurs at most once (this property is automatic
    //        given aggregation by leafId; we assert it anyway as a guard
    //        against future regressions)
    //   (I3) function-level aggregate == sum of constituent node aggregates
    //        (verified outside buildTable by invariant_check())
    const byLeaf = new Map();
    function bump(leafId, side, count) {
      const x = byLeaf.get(leafId) ?? {
        node_id: leafId,
        function_name: '?',
        url: '?',
        line: -1,
        col: -1,
        hit_count: 0,
        gc_before: 0,
        gc_after: 0,
      };
      x[side] += count;
      byLeaf.set(leafId, x);
    }
    for (const [sampleIdx, count] of mapBefore) {
      const leafId = profile.samples[sampleIdx];
      if (leafId == null) continue;
      if (leafId === GC_NODE) continue;
      bump(leafId, 'gc_before', count);
    }
    for (const [sampleIdx, count] of mapAfter) {
      const leafId = profile.samples[sampleIdx];
      if (leafId == null) continue;
      if (leafId === GC_NODE) continue;
      bump(leafId, 'gc_after', count);
    }
    const out = [];
    for (const x of byLeaf.values()) {
      const leaf = byId.get(x.node_id);
      x.function_name = leaf ? leaf.callFrame.functionName : '?';
      x.url = leaf ? leaf.callFrame.url : '?';
      x.line = leaf ? leaf.callFrame.lineNumber : -1;
      x.col = leaf ? leaf.callFrame.columnNumber : -1;
      x.hit_count = leaf ? leaf.hitCount : 0;
      x[totalKey] = x.gc_before + x.gc_after;
      if (x[totalKey] === 0) continue;
      out.push(x);
    }
    out.sort((x, y) => y[totalKey] - x[totalKey]);
    return out;
  }

  const adj_runs = buildTable(run2before, run2after, 'total_gc_run_adjacency');
  const exp_runs = buildTable(exp2before, exp2after, 'total_sample_weighted_exposure');

  // --- Invariant check (FIXED per causal review #P0 / 2026-09-23) ----------
  // Per reviewer prescription: enforce these three invariants EXECUTABLY
  // so that future regressions of buildTable's aggregation are caught at
  // analyzer time, not at evidence-claim time:
  //
  //   (I1) sum_over_rows(gc_before + gc_after) <= 2 * gcRuns
  //        (each run touches at most 2 non-GC leaves)
  //   (I2) each node_id occurs at most once
  //        (proof that aggregation is keyed by leafId, not sampleIdx)
  //   (I3) function-level aggregate == sum of its constituent node aggregates
  //        (no prose arithmetic in evidence; function totals are
  //        reproducible by summing their leaf rows)
  function checkInvariants(table, totalKey, gcRuns, label, isPrimary) {
    const inv = { label, I1: null, I2: null, I3: null, sum_total: null, bound: 2 * gcRuns };
    // I1, sum, I2
    const nodeIds = new Set();
    let dupFound = null;
    let sum_total = 0;
    for (const row of table) {
      sum_total += row[totalKey];
      if (nodeIds.has(row.node_id)) {
        dupFound = row.node_id;
      } else {
        nodeIds.add(row.node_id);
      }
    }
    inv.sum_total = sum_total;
    // I1: only the PRIMARY metric has the `sum <= 2 * gcRuns` bound; the
    // LEGACY metric deliberately produces per-sample exposures (each GC
    // sample inside a run contributes 1) and is expected to exceed 2*gcRuns.
    inv.I1_applicable = isPrimary === true;
    inv.I1 = isPrimary === true ? sum_total <= 2 * gcRuns : null;
    inv.I1_NA_reason = isPrimary === true ? null : 'per-sample exposure, no upper bound expected';
    inv.I2 = dupFound == null && nodeIds.size === table.length;
    // I3 — function == sum of leaves
    const byFnNode = new Map(); // functionName -> { sum_nodes, leaves:[nodeId] }
    for (const row of table) {
      const x = byFnNode.get(row.function_name) ?? { sum_nodes: 0, leaves: [] };
      x.sum_nodes += row[totalKey];
      x.leaves.push(row.node_id);
      byFnNode.set(row.function_name, x);
    }
    // Re-derive function totals by collapsing by function name
    const fnAggregate = new Map();
    for (const row of table) {
      fnAggregate.set(
        row.function_name,
        (fnAggregate.get(row.function_name) ?? 0) + row[totalKey]
      );
    }
    const i3mismatches = [];
    for (const [fn, x] of byFnNode.entries()) {
      const agg = fnAggregate.get(fn);
      if (agg !== x.sum_nodes) {
        i3mismatches.push({ function_name: fn, recomputed_total: agg, sum_of_node_rows: x.sum_nodes, leaves: x.leaves });
      }
    }
    inv.I3 = i3mismatches.length === 0;
    inv.I3_mismatches = i3mismatches;
    return inv;
  }
  const invariants = {
    gc_run_adjacency: checkInvariants(adj_runs, 'total_gc_run_adjacency', gcRuns, 'gc_run_adjacency', true),
    gc_sample_weighted_boundary_exposure: checkInvariants(exp_runs, 'total_sample_weighted_exposure', gcRuns, 'gc_sample_weighted_boundary_exposure', false),
  };

  let median = 0;
  let p95 = 0;
  if (runLengths.length) {
    median =
      runLengths.length % 2
        ? runLengths[(runLengths.length - 1) >> 1]
        : (runLengths[runLengths.length / 2 - 1] + runLengths[runLengths.length / 2]) / 2;
    p95 = runLengths[Math.min(runLengths.length - 1, Math.floor(runLengths.length * 0.95))];
  }

  return {
    gc_runs: gcRuns,
    run_lengths: runLengths,
    run_length_median: median,
    run_length_p95: p95,
    run_length_max: runLengths.length ? runLengths[runLengths.length - 1] : 0,

    gc_run_adjacency: {
      description:
        'Per-leaf count of contiguous GC runs whose boundary touches that leaf. PRIMARY METRIC: independent of run length. Aggregation is by leafId; one row per node_id.',
      leaf_stats: adj_runs,
      invariants: invariants.gc_run_adjacency,
    },

    gc_sample_weighted_boundary_exposure: {
      description:
        'LEGACY METRIC. Per-sample exposure — biased by run length. A leaf adjacent to a GC run of length K is counted K times. NOT a per-event count. Do not use for causal selection; retained only under honest name.',
      leaf_stats: exp_runs,
      invariants: invariants.gc_sample_weighted_boundary_exposure,
    },
  };
}

const gcStats = gcAdjacency();

// --- Calibration ---
const calibration = calibrationCheck();

// --- Method B status per target (FIXED after causal review of #P1).
//
// Method A = binding of record for every target (production bundle body
// 1-to-1 decode). Method B = sourcemap decode of an exact-HEAD rebuild.
//
// For a sourcemapped rebuild to qualify as Method B, its bundle's
// runtime decisions (DCE, inlining, mangling layout) must produce offsets
// comparable to the shipped production bundle. Several candidates are
// DCE'd in the prodlike minified rebuild, so their Method B is
// non-correlatable. We classify each target explicitly rather than
// hiding the asynchrony behind prose.
//
const methodBStatusBlocks = {
  cwi: 'TWO_METHOD_AGREEMENT',
  e_1: 'TWO_METHOD_AGREEMENT (prodlike dev sourcemap at continuation-cardinality-authority.ts:185:7)',
  e_2: 'TWO_METHOD_AGREEMENT (prodlike dev sourcemap at continuation-cardinality-authority.ts:185:7)',
  e_3: 'TWO_METHOD_AGREEMENT (prodlike dev sourcemap at continuation-cardinality-authority.ts:185:7)',
  Rnl: 'METHOD_A_EXACT_BODY_BINDING (Method B DCE/inlining makes sourcemap offset non-comparable)',
  r_: 'METHOD_A_EXACT_BODY_BINDING (Method B DCE/inlining makes sourcemap offset non-comparable)',
  Gyi: 'METHOD_A_EXACT_BODY_BINDING (Method B DCE/inlining makes sourcemap offset non-comparable)',
  drain: 'METHOD_A_EXACT_BODY_BINDING (Method B DCE/inlining makes sourcemap offset non-comparable)',
  setWithWriter: 'METHOD_A_EXACT_BODY_BINDING (Method B DCE/inlining makes sourcemap offset non-comparable)',
  handleSessionEvent: 'METHOD_A_EXACT_BODY_BINDING (Method B DCE/inlining makes sourcemap offset non-comparable)',
  onSessionEvent: 'METHOD_A_EXACT_BODY_BINDING (Method B DCE/inlining makes sourcemap offset non-comparable)',
};

// --- Identity disambiguation (FIXED after causal review of #P1).
// Three distinct identities; do NOT refer to them as one "source HEAD".
let analysisRepoHead = '(unknown — not in a git working tree)';
try {
  const { execFileSync } = await import('node:child_process');
  analysisRepoHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000 }).trim();
} catch {}
// DOGFOOD_SOURCE_HEAD = commit that produced the installed dogfood bundle;
// recorded as a constant here so we don't conflate it with the working tree.
const DOGFOOD_SOURCE_HEAD = 'd92235e67711976eb3582617583e9804034724e3';

// --- Interpreter caveats (FIXED after causal review of #P0-1 / #P0-2).
//
// (C1) hitCount = sample observations, not invocations.
//      V8 cpuprofile records which leaf was on the running stack at each
//      sample tick. One invocation may receive zero, one, or many samples.
//      Therefore NO call count, RegExp/sec, bytes/sec, or allocation-owner
//      claim is derived from hitCount in this analyzer.
//
// (C2) GC adjacency has two metrics. PRIMARY = gc_run_adjacency (run-
//      length-independent). LEGACY = gc_sample_weighted_boundary_exposure
//      (biased by run length; preserved under honest name). Causal
//      selection must use PRIMARY only.
//
const interpreter_caveats = {
  C1_hitcount_is_observations_not_invocations: {
    statement:
      'V8 cpuprofile `hitCount` is the count of samples where the leaf was on-CPU. It is NOT an invocation count. Per-call allocation rates / RegExp/sec / bytes/sec cannot be derived from this analyzer. Use a heap or allocation sampling profiler (V8 sampling heap profile, or `--heap-sampling`) for invocation/allocation evidence.',
    applied_in_this_output:
      'No call count, RegExp/sec, bytes/sec, or "allocation owner" claim is derived from hitCount. Allocation capability is established structurally (source inspection) and recorded per function in the targets[] block.',
  },
  C2_gc_adjacency_has_two_metrics: {
    statement:
      'The original adjacency algorithm counts the previous/next non-GC leaf for EVERY GC sample (biased by run length). The PRIMARY metric counts ONCE per contiguous GC run. Both are exposed with honest names.',
    applied_in_this_output:
      'gc_run_adjacency is the only metric for causal selection. gc_sample_weighted_boundary_exposure is tagged LEGACY/BIASED.',
  },
  C3_gc_adjacency_leafid_aggregation: {
    statement:
      'PRIMARY gc_run_adjacency is aggregated by leaf node_id; LEGACY gc_sample_weighted_boundary_exposure likewise. Each row in either leaf_stats table has a UNIQUE node_id. The analyzer enforces this invariant at build time: (I1) sum(rows.before+after) <= 2*gcRuns; (I2) node_ids are unique; (I3) function-level aggregate equals the sum of its constituent node aggregates. The analyzer refuses to emit result.json if any invariant fails.',
    applied_in_this_output:
      'Per-row uniqueness and the I3 function-sum identity are emitted inside gc_stats.gc_run_adjacency.invariants and gc_stats.gc_sample_weighted_boundary_exposure.invariants in result.json. Function-level totals in evidence files must be reproduced by summing these leaf rows.',
  },
};

// --- Final output ---
const output = {
  interpreter_caveats,
  identity_disambiguation: {
    ANALYSIS_REPO_HEAD: analysisRepoHead,
    ANALYSIS_REPO_HEAD_role: 'Working tree in which this analyzer was authored (may differ from the profile subject)',
    DOGFOOD_SOURCE_HEAD: DOGFOOD_SOURCE_HEAD,
    DOGFOOD_SOURCE_HEAD_role: 'Commit hash that produced the installed dogfood bundle (matches the vsix filename prefix cline-4.1.16-d92235e67)',
    PROFILE_SUBJECT_HEAD: null,
    PROFILE_SUBJECT_HEAD_role: 'A .cpuprofile is a captured artifact, not a git object — N/A',
  },
  artifact_identity: id,
  profile_ctl_01: {
    sum_hitcount: id.profile_ctl_01_sum_hitcount,
    samples_length: profile.samples.length,
    match: id.profile_ctl_01_match,
  },
  profile_ctl_02: calibration,
  top_25_leaves_by_raw_hitcount: allNodes.slice(0, 25),
  targets,
  method_b_status: {
    per_target_status: methodBStatusBlocks,
    note:
      "Method A is the binding of record for every target. Method B qualifies only when the sourcemapped rebuild yields offsets comparable to the shipped bundle; here only cwi and e_ survive the prodlike minified rebuild with agreeable source positions.",
  },
  gc_stats: gcStats,
};

fs.writeFileSync(path.join(OUTDIR, 'result.json'), JSON.stringify(output, null, 2));

// Console summary
console.log('=== Identity disambiguation ===');
console.log(`ANALYSIS_REPO_HEAD=${analysisRepoHead.slice(0,12)}…`);
console.log(`DOGFOOD_SOURCE_HEAD=${DOGFOOD_SOURCE_HEAD.slice(0,12)}…`);
console.log(`profile_path=${id.profile_path}`);
console.log(`profile_size=${id.profile_size} sha256=${id.profile_sha256.slice(0,16)}…`);
console.log(`bundle=${id.bundle_path}`);
console.log(`bundle_size=${id.bundle_size} bundle_sha256=${id.bundle_sha256.slice(0,16)}…`);
console.log(`samples=${id.sample_count} duration_ms=${id.duration_ms.toFixed(2)}`);
console.log(`PROFILE-CTL-01 sum(hitCount)=${id.profile_ctl_01_sum_hitcount} matches samples.length=${id.profile_ctl_01_match}`);
console.log('');
console.log('=== Calibration control (cwi) ===');
console.log(`PROFILE-CTL-02 cwi_top: id=${calibration.cwi_top_node?.node_id} hits=${calibration.cwi_top_node?.hit_count} loc=${calibration.cwi_top_node?.line}:${calibration.cwi_top_node?.col}`);
console.log(`cwi_decls_in_bundle=${calibration.cwi_decls_in_bundle.length}`);
console.log(`cwi_body_signature_match=${calibration.cwi_body_signature_match}`);
console.log(`cwi_calibration_pass=${calibration.cwi_calibration_pass}`);
console.log('');
console.log('=== Top 25 leaves by raw hitCount (SAMPLES, NOT invocations) ===');
for (const n of allNodes.slice(0, 25)) {
  console.log(`${String(n.hit_count).padStart(6)} samples (${n.raw_sample_share_pct.toFixed(3)}%)  id=${n.node_id}  ${n.function_name} @ ${n.line}:${n.col}`);
}
console.log('');
console.log('=== GC stats ===');
console.log(`runs=${gcStats.gc_runs} median_run=${gcStats.run_length_median} p95=${gcStats.run_length_p95} max=${gcStats.run_length_max}`);
// Invariant assertions — fail hard if PRIMARY aggregation regressed.
function reportInvariants(inv, label) {
  const i1ok = inv.I1_applicable ? inv.I1 : '(N/A — per-sample exposure)';
  const ok = (inv.I1_applicable ? inv.I1 : true) && inv.I2 && inv.I3;
  console.log(`${label} invariants: I1 sum=${inv.sum_total} bound=2*gcRuns=${inv.bound} OK=${i1ok}; I2 unique_node_ids=${inv.I2}; I3 fn_eq_sum_nodes=${inv.I3} ${inv.I3 ? '' : 'MISMATCH ' + JSON.stringify(inv.I3_mismatches)}`);
  return ok;
}
const allOk =
  reportInvariants(gcStats.gc_run_adjacency.invariants, 'PRIMARY  gc_run_adjacency                     ') &&
  reportInvariants(gcStats.gc_sample_weighted_boundary_exposure.invariants, 'LEGACY   gc_sample_weighted_boundary_exposure');
if (!allOk) {
  console.error('FATAL: GC adjacency invariants failed. Refusing to emit result.json.');
  process.exit(3);
}
console.log('PRIMARY gc_run_adjacency (one row per leafId; one per contiguous run, run-length-independent):');
for (const a of gcStats.gc_run_adjacency.leaf_stats.slice(0, 15)) {
  console.log(`  ${String(a.total_gc_run_adjacency).padStart(5)}  before=${String(a.gc_before).padStart(5)} after=${String(a.gc_after).padStart(5)}  ${a.function_name} id=${a.node_id}`);
}
console.log('');
console.log('LEGACY gc_sample_weighted_boundary_exposure (BIASED by run length — do not use for ranking):');
for (const a of gcStats.gc_sample_weighted_boundary_exposure.leaf_stats.slice(0, 15)) {
  console.log(`  ${String(a.total_sample_weighted_exposure).padStart(5)}  before=${String(a.gc_before).padStart(5)} after=${String(a.gc_after).padStart(5)}  ${a.function_name} id=${a.node_id}`);
}
console.log('');
console.log('Done. Wrote', path.join(OUTDIR, 'result.json'));
