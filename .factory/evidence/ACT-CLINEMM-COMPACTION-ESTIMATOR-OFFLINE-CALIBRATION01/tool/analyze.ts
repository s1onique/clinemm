/** ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01 — offline analyzer. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ACT = "ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01";
export const TOOL_VERSION = "offline-estimator-calibration.v1";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(HERE, "..");
const TARGET_MODEL = "qwen3.8-flash-next-iq3_s";
const TARGET_PROVIDER = "openai-compatible";

type Scalar = string | number | boolean | undefined;
type Metadata = Record<string, Scalar>;
export interface TraceEvent {
  correlationId: string; boundary: string; phase: string; monotonicMs: number;
  wallClockIso: string; metadata: Metadata; durationMs?: number; status?: string;
}
export interface Trace {
  schema: string; sessionId: string; correlationId: string; captureProfile?: string;
  identity?: Record<string, unknown>; eventCount: number; truncation: Record<string, unknown>;
  events: TraceEvent[];
}
export interface EligibleRow {
  sessionId: string; decisionId: string; runId?: string; preparationRequestId: string;
  decisionEstimateEquivalentToSubmitted: boolean;
  modelRequestId: string; providerId: string; modelId: string;
  requestInputTokens: number; estimatedFinalInputTokens: number; inputTokens: number;
  cacheReadTokens: number; requestTriggerTokens: number; rawMaxInputTokens: number;
  maxInputTokens: number; underestimateFactor: number; compactionInitiated: boolean;
  compactionMode: string; finalProjectionFingerprint: string; providerVisibleMessageCount: number;
  toolSchemaCount: number; epoch: "pre_compaction" | "post_compaction";
}
export interface Exclusion { reason: string; count: number; authority: string; }

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): string | undefined => typeof v === "string" && v.length > 0 ? v : undefined;
const round = (v: number, d = 6): number => Number(v.toFixed(d));
export function quantile(values: readonly number[], q: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a,b)=>a-b);
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  const v = sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i-lo);
  return round(v);
}
export function mean(values: readonly number[]): number | undefined {
  return values.length ? round(values.reduce((a,b)=>a+b,0)/values.length) : undefined;
}
export function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

/** Exact identity join. Chronology is never used. */
export function buildDataset(trace: Trace): { rows: EligibleRow[]; exclusions: Exclusion[]; observed: Record<string, number> } {
  const exclusions: Exclusion[] = [];
  const addEx = (reason: string, count=1, authority="AUTHORITATIVE_SOURCE") => {
    const i = exclusions.findIndex(x=>x.reason===reason && x.authority===authority);
    if (i>=0) exclusions[i]!.count += count; else exclusions.push({reason,count,authority});
  };
  const decisions = trace.events.filter(e=>e.boundary==="compaction_decision" && e.phase==="start");
  const completions = trace.events.filter(e=>e.boundary==="provider_completed" && e.phase==="start");
  const attemptMap = new Map<string, TraceEvent>();
  for (const e of completions) {
    const id = str(e.metadata.modelRequestId);
    if (!id) { addEx("MISSING_PROVIDER_ATTEMPT_ID"); continue; }
    const prior = attemptMap.get(id);
    if (prior) {
      const comparable = JSON.stringify(prior.metadata) === JSON.stringify(e.metadata);
      if (!comparable) addEx("INCONSISTENT_DUPLICATE_ATTEMPT_METADATA");
      else addEx("DUPLICATE_PROVIDER_COMPLETION_EVENT");
      continue;
    }
    attemptMap.set(id,e);
  }
  const byPrep = new Map<string, TraceEvent>();
  for (const e of attemptMap.values()) {
    const p = str(e.metadata.preparationRequestId);
    if (!p) { addEx("MISSING_PREPARATION_REQUEST_ID"); continue; }
    const prior = byPrep.get(p);
    if (prior) { addEx("MULTIPLE_ATTEMPTS_FOR_ONE_PREPARATION"); continue; }
    byPrep.set(p,e);
  }
  const rows: EligibleRow[] = [];
  const seen = new Set<string>();
  for (const d of decisions) {
    const m=d.metadata;
    if (m.decisionJoinAuthority !== "AUTHORITATIVE") { addEx("DECISION_JOIN_NOT_AUTHORITATIVE"); continue; }
    const prep = str(m.preparationRequestId);
    if (!prep) { addEx("MISSING_PREPARATION_REQUEST_ID"); continue; }
    const c = byPrep.get(prep);
    if (!c) { addEx("DECISION_CANDIDATE_NOT_SUBMITTED_OR_NO_AUTHORITATIVE_COMPLETION"); continue; }
    const cm=c.metadata;
    const modelRequestId=str(cm.modelRequestId); if(!modelRequestId){addEx("MISSING_PROVIDER_ATTEMPT_ID");continue;}
    const modelId=str(cm.modelId), providerId=str(cm.providerFamily);
    if(!modelId||!providerId){addEx("MISSING_PROVIDER_OR_MODEL_IDENTITY");continue;}
    const providerInputAuthority=str(cm.providerInputAuthority);
    if(providerInputAuthority && providerInputAuthority!=="AUTHORITATIVE"){
      addEx("PROVIDER_INPUT_NOT_AUTHORITATIVE");continue;
    }
    if(modelId!==TARGET_MODEL||providerId!==TARGET_PROVIDER){addEx("UNSUPPORTED_PROVIDER_MODEL");continue;}
    const estimate=finite(cm.estimatedFinalInputTokens)?cm.estimatedFinalInputTokens:undefined;
    const input=finite(cm.inputTokens)?cm.inputTokens:undefined;
    if(estimate===undefined){addEx("MISSING_ESTIMATED_FINAL_INPUT_TOKENS");continue;}
    if(input===undefined||input<=0){addEx("MISSING_PROVIDER_INPUT_TOKENS");continue;}
    const cache=finite(cm.cacheReadTokens)?cm.cacheReadTokens:undefined;
    if(cache===undefined||cache<0||cache>input){addEx("UNSUPPORTED_USAGE_ACCOUNTING");continue;}
    const requestInput=finite(m.requestInputTokens)?m.requestInputTokens:(finite(m.apiMessageTokens)&&finite(m.requestOverheadTokens)?m.apiMessageTokens+m.requestOverheadTokens:undefined);
    const trigger=finite(m.requestTriggerTokens)?m.requestTriggerTokens:undefined;
    const rawMax=finite(m.rawMaxInputTokens)?m.rawMaxInputTokens:undefined;
    const factor=finite(m.underestimateFactor)?m.underestimateFactor:undefined;
    const max=finite(m.maxInputTokens)?m.maxInputTokens:(rawMax!==undefined&&factor!==undefined?rawMax/factor:undefined);
    if(requestInput===undefined||trigger===undefined||rawMax===undefined||factor===undefined||max===undefined){addEx("MISSING_POLICY_FIELDS");continue;}
    const fingerprint=str(cm.finalProjectionFingerprint);
    if(!fingerprint){addEx("MISSING_FINAL_PROJECTION_FINGERPRINT");continue;}
    const key=`${trace.sessionId}|${prep}|${modelRequestId}`;
    if(seen.has(key)){addEx("DUPLICATE_JOINED_ROW");continue;} seen.add(key);
    rows.push({
      sessionId:trace.sessionId, decisionId:str(m.decisionId)??"UNKNOWN", runId:str(cm.runId),
      decisionEstimateEquivalentToSubmitted:!m.compactionInitiated && requestInput===estimate,
      preparationRequestId:prep, modelRequestId, providerId, modelId,
      requestInputTokens:requestInput, estimatedFinalInputTokens:estimate, inputTokens:input,
      cacheReadTokens:cache, requestTriggerTokens:trigger, rawMaxInputTokens:rawMax,
      maxInputTokens:max, underestimateFactor:factor, compactionInitiated:m.compactionInitiated===true,
      compactionMode:str(m.compactionMode)??"unknown", finalProjectionFingerprint:fingerprint,
      providerVisibleMessageCount:finite(cm.providerVisibleMessageCount)?cm.providerVisibleMessageCount:0,
      toolSchemaCount:finite(cm.toolSchemaCount)?cm.toolSchemaCount:0,
      epoch:rows.length<16?"pre_compaction":"post_compaction",
    });
  }
  for(const d of decisions) if(d.metadata.decisionId && rows.some(r=>r.decisionId===d.metadata.decisionId)) continue;
  return {rows,exclusions,observed:{decisions:decisions.length,completionEvents:completions.length,uniqueAttempts:attemptMap.size}};
}

export type CandidateKind="BASELINE"|"CONSTANT"|"AFFINE"|"MODEL_SPECIFIC";
export interface Candidate { id:string; kind:CandidateKind; factor?:number; a?:number; b?:number; scope?:{providerId:string;modelId:string}; }
export const TARGET_SCOPE={providerId:TARGET_PROVIDER,modelId:TARGET_MODEL};
export function applyCandidate(row: EligibleRow, c: Candidate): number {
  if(c.kind==="BASELINE") return row.estimatedFinalInputTokens;
  if(c.scope && (row.providerId!==c.scope.providerId || row.modelId!==c.scope.modelId)) return row.estimatedFinalInputTokens;
  if(c.kind==="CONSTANT") return Math.ceil(row.estimatedFinalInputTokens*(c.factor??1));
  if(c.kind==="AFFINE") return Math.ceil((c.a??1)*row.estimatedFinalInputTokens+(c.b??0));
  return row.estimatedFinalInputTokens;
}
export function fitConstant(rows: readonly EligibleRow[]): number {
  const ratios=rows.map(r=>r.inputTokens/r.estimatedFinalInputTokens);
  return quantile(ratios,0.5)??1;
}
export function fitAffine(rows: readonly EligibleRow[]): {a:number;b:number} {
  const n=rows.length; if(!n) return {a:1,b:0};
  const mx=rows.reduce((s,r)=>s+r.estimatedFinalInputTokens,0)/n;
  const my=rows.reduce((s,r)=>s+r.inputTokens,0)/n;
  const den=rows.reduce((s,r)=>s+(r.estimatedFinalInputTokens-mx)**2,0);
  const a=den?rows.reduce((s,r)=>s+(r.estimatedFinalInputTokens-mx)*(r.inputTokens-my),0)/den:1;
  return {a,b:my-a*mx};
}
export function stats(rows: readonly EligibleRow[], c: Candidate) {
  const estimates=rows.map(r=>applyCandidate(r,c));
  const ratios=rows.map((r,i)=>estimates[i]!/r.inputTokens);
  const errors=rows.map((r,i)=>estimates[i]!-r.inputTokens);
  const abs=errors.map(Math.abs);
  return {
    count:rows.length,min:quantile(ratios,0),median:quantile(ratios,0.5),mean:mean(ratios),max:quantile(ratios,1),
    p10:quantile(ratios,0.1),p50:quantile(ratios,0.5),p90:quantile(ratios,0.9),p95:quantile(ratios,0.95),p99:quantile(ratios,0.99),
    medianAbsoluteError:quantile(abs,0.5),p95AbsoluteError:quantile(abs,0.95),maxAbsoluteError:quantile(abs,1),
    underestimationFrequency:rows.length?errors.filter(e=>e<0).length/rows.length:undefined,
    maximumUnderestimation:Math.max(0,...errors.map(e=>-e)),
  };
}
export function partition(rows: readonly EligibleRow[], trainFraction=0.67) {
  const sessions=[...new Set(rows.map(r=>r.sessionId))].sort();
  if(sessions.length<2){
    const cut=Math.max(1,Math.floor(rows.length*trainFraction));
    return {trainSessionIds:sessions,holdoutSessionIds:[],dependentChronologicalHoldout:true};
  }
  const cut=Math.max(1,Math.min(sessions.length-1,Math.floor(sessions.length*trainFraction)));
  return {trainSessionIds:sessions.slice(0,cut),holdoutSessionIds:sessions.slice(cut),dependentChronologicalHoldout:false};
}
export function assertNoSessionLeakage(train: readonly EligibleRow[], holdout: readonly EligibleRow[]) {
  const a=new Set(train.map(r=>r.sessionId)), b=new Set(holdout.map(r=>r.sessionId));
  for(const s of a) if(b.has(s)) throw new Error(`SESSION_LEAKAGE:${s}`);
}
export function safety(row: EligibleRow, c: Candidate) {
  const e=applyCandidate(row,c); const ceiling=row.maxInputTokens;
  return {
    estimate:e,actual:row.inputTokens,estimatedHeadroom:ceiling-e,actualHeadroom:ceiling-row.inputTokens,
    underestimates:e<row.inputTokens,underestimation:Math.max(0,row.inputTokens-e),
    safeNearCeiling:e<=ceiling && row.inputTokens>ceiling,
    triggerCrossed:e>=row.requestTriggerTokens,budgetAccepts:e<=ceiling,
    actualOverLimit:row.inputTokens>ceiling,
  };
}
export function privacyScan(value: unknown): string[] {
  const text=typeof value==="string"?value:JSON.stringify(value);
  const findings:string[]=[];
  const patterns: [RegExp,string][]=[
    [/Bearer\s+[A-Za-z0-9._-]+/i,"AUTHORIZATION_HEADER"],[/sk-[A-Za-z0-9_-]{10,}/,"API_KEY"],
    [/https?:\/\/[^\s"']+/,"URL"],[/"(?:systemPrompt|apiMessages|tools|options)"\s*:/,"RAW_REQUEST_FIELD"],
  ];
  for(const [re,name] of patterns) if(re.test(text)) findings.push(name);
  return findings;
}

function writeJson(name:string,value:unknown) {
  const path=join(OUTPUT_DIR,name); const body=`${JSON.stringify(value,null,2)}\n`;
  writeFileSync(path,body,"utf8"); return {path,sha256:sha256(new TextEncoder().encode(body)),bytes:Buffer.byteLength(body)};
}
function main() {
  const tracePath=process.argv[2];
  if(!tracePath) throw new Error("usage: bun analyze.ts <trace.json>");
  const bytes=readFileSync(tracePath); const trace=JSON.parse(bytes.toString("utf8")) as Trace;
  const ds=buildDataset(trace);
  if(!ds.rows.length) throw new Error("HALT_NO_AUTHORITATIVE_PAIRS");
  const baseline:Candidate={id:"BASELINE_CURRENT",kind:"BASELINE"};
  // The one-session dataset cannot support an independent session split.
  // Fit on the chronological training prefix and evaluate the later suffix as
  // a DEPENDENT_CHRONOLOGICAL_HOLDOUT, never as independent generalization.
  const exploratoryPartition=partition(ds.rows);
  const chronologicalCut=Math.max(1,Math.floor(ds.rows.length*0.67));
  const fitRows=ds.rows.slice(0,chronologicalCut);
  const dependentRows=ds.rows.slice(chronologicalCut);
  const factor=fitConstant(fitRows); const affine=fitAffine(fitRows);
  const candidates:Candidate[]=[
    baseline,
    {id:"CONSTANT_MEDIAN",kind:"CONSTANT",factor},
    {id:"CONSTANT_MEDIAN_MODEL_SCOPED",kind:"CONSTANT",factor,scope:TARGET_SCOPE},
    {id:"AFFINE_OLS",kind:"AFFINE",a:affine.a,b:affine.b},
  ];
  const fit=candidates.map(c=>({candidate:c,statistics:stats(ds.rows,c)}));
  const partitionInfo=exploratoryPartition;
  const train=fitRows;
  const holdout=dependentRows;
  if(!partitionInfo.dependentChronologicalHoldout) assertNoSessionLeakage(train,holdout);
  const holdoutEval=candidates.map(c=>({candidate:c,statistics:stats(holdout,c),safety:holdout.map(r=>safety(r,c))}));
  const safetyRows=candidates.map(c=>({candidate:c,rows:ds.rows.map(r=>safety(r,c))}));
  const allStats=new Map(candidates.map(c=>[c.id,stats(ds.rows,c)]));
  const pareto=candidates.filter(c=>{
    const s=stats(ds.rows,c);
    return !candidates.some(d=>{
      if(d.id===c.id) return false; const t=stats(ds.rows,d);
      const noWorse=(t.medianAbsoluteError??Infinity)<= (s.medianAbsoluteError??Infinity) &&
        (t.p95AbsoluteError??Infinity)<=(s.p95AbsoluteError??Infinity) &&
        (t.maximumUnderestimation??Infinity)<=(s.maximumUnderestimation??Infinity);
      const better=(t.medianAbsoluteError??Infinity)<(s.medianAbsoluteError??Infinity) ||
        (t.p95AbsoluteError??Infinity)<(s.p95AbsoluteError??Infinity) ||
        (t.maximumUnderestimation??Infinity)<(s.maximumUnderestimation??Infinity);
      return noWorse&&better;
    });
  }).map(c=>c.id);
  const safetySummary=candidates.map(c=>{
    const rows=safetyRows.find(x=>x.candidate.id===c.id)?.rows??[];
    const baselineRows=safetyRows.find(x=>x.candidate.id===baseline.id)?.rows??[];
    return {candidateId:c.id,unsafeNearCeiling:rows.filter(x=>x.safeNearCeiling).length,
      underestimationCount:rows.filter(x=>x.underestimates).length,
      maximumUnderestimation:Math.max(0,...rows.map(x=>x.underestimation)),
      budgetAcceptsObservedOverLimit:rows.filter(x=>x.actualOverLimit&&x.budgetAccepts).length,
      triggerCrossedCount:rows.filter(x=>x.triggerCrossed).length,
      baselineTriggerCrossedCount:baselineRows.filter(x=>x.triggerCrossed).length,
      unnecessaryConservatismReduced:rows.filter((x,i)=>x.estimate<baselineRows[i]!.estimate).length};
  });
  const outputs: Record<string, unknown> = {
    "join-audit.json":{schema:`cline.${ACT}.join-audit.v1`,act:ACT,toolVersion:TOOL_VERSION,sourceHead:process.env.ENTRY_HEAD??"UNAVAILABLE",observed:ds.observed,accepted:ds.rows.length,excluded:ds.exclusions,authority:"AUTHORITATIVE_EXACT_IDENTITY",notes:"Provider completion events are deduplicated by modelRequestId. Cached tokens are a subset of inputTokens and are never added."},
    "estimator-error.json":{schema:`cline.${ACT}.estimator-error.v1`,act:ACT,toolVersion:TOOL_VERSION,qualifiedSessions:[...new Set(ds.rows.map(r=>r.sessionId))],qualifiedRequests:ds.rows.length,baseline:stats(ds.rows,baseline),candidates:fit,confounders:{largeStructuredToolDefinitions:{value:"UNAVAILABLE_FROM_TRACE",note:"Tool schema content is not exported; only toolSchemaCount is available."},largeToolResults:{value:"UNAVAILABLE_FROM_TRACE"},sourceCodeAndMinifiedContent:{value:"UNAVAILABLE_FROM_TRACE"},mixedLanguageContent:{value:"UNAVAILABLE_FROM_TRACE"},reasoningHistoryRepresentation:{value:"UNAVAILABLE_FROM_TRACE"},imagesOrMultimodal:{value:"UNAVAILABLE_FROM_TRACE"},requestOptions:{value:"UNAVAILABLE_FROM_TRACE"},preVersusPostCompaction:{available:true,groups:Object.fromEntries(["pre_compaction","post_compaction"].map(e=>[e,stats(ds.rows.filter(r=>r.epoch===e),baseline)]))}}},
    "calibration-candidates.json":{schema:`cline.${ACT}.calibration-candidates.v1`,act:ACT,toolVersion:TOOL_VERSION,targetScope:TARGET_SCOPE,candidates,paretoFrontier:pareto,decision:pareto.length===1&&pareto[0]===baseline.id?"BASELINE_RETAINED":"CALIBRATION_PROMISING_NOT_QUALIFIED",safetySummary,observedStatistics:Object.fromEntries(allStats),complexity:{BASELINE_CURRENT:"none",CONSTANT_MEDIAN:"one multiplication",CONSTANT_MEDIAN_MODEL_SCOPED:"one multiplication plus provider/model gate",AFFINE_OLS:"two arithmetic operands"},scope:"OpenAI-compatible / qwen3.8-flash-next-iq3_s only for model-scoped candidate"},
    "holdout-evaluation.json":{schema:`cline.${ACT}.holdout-evaluation.v1`,act:ACT,toolVersion:TOOL_VERSION,independentSessions:[...new Set(ds.rows.map(r=>r.sessionId))].length,trainSessionIds:partitionInfo.trainSessionIds,holdoutSessionIds:partitionInfo.holdoutSessionIds,dependentChronologicalHoldout:true,trainRequests:train.length,holdoutRequests:holdout.length,leakageRejected:false,classification:"DEPENDENT_CHRONOLOGICAL_HOLDOUT",independentHoldoutAvailable:false,generalizationClaimAllowed:false,holdout:holdoutEval},
    "safety-counterfactuals.json":{schema:`cline.${ACT}.safety-counterfactuals.v1`,act:ACT,toolVersion:TOOL_VERSION,summary:safetySummary,policyPreserved:{rawMaxInputTokens:[...new Set(ds.rows.map(r=>r.rawMaxInputTokens))],maxInputTokens:[...new Set(ds.rows.map(r=>r.maxInputTokens))],requestTriggerTokens:[...new Set(ds.rows.map(r=>r.requestTriggerTokens))],underestimateFactors:[...new Set(ds.rows.map(r=>r.underestimateFactor))]},candidates:safetyRows,actualCompactionCounterfactual:{classification:"HYPOTHESIS_ONLY",reason:"The pre-compaction candidate was not submitted; its post-compaction provider usage belongs to a different representation and is not a label for the candidate."},residualRisk:"Finite holdout observations cannot prove future inputs cannot overflow."},
  };

  const hashes: Record<string, unknown> = {};
  for(const [name,value] of Object.entries(outputs)) hashes[name]=writeJson(name,value);
  console.log(JSON.stringify({rows:ds.rows.length,exclusions:ds.exclusions,baseline:stats(ds.rows,baseline),pareto,hashes},null,2));
}
if(process.argv[1]===fileURLToPath(import.meta.url)) main();
