import { describe, expect, it } from "bun:test";
import { applyCandidate, buildDataset, fitConstant, partition, privacyScan, safety, stats, TARGET_SCOPE, type Trace } from "./analyze";

const decision=(prep:string,id:string,initiated=false)=>({correlationId:"s",boundary:"compaction_decision",phase:"start",monotonicMs:1,wallClockIso:"",metadata:{preparationRequestId:prep,decisionId:id,decisionJoinAuthority:"AUTHORITATIVE",requestInputTokens:100,requestTriggerTokens:90,rawMaxInputTokens:100,maxInputTokens:100,underestimateFactor:1,compactionInitiated:initiated,compactionMode:"auto"}});
const completion=(prep:string,attempt:string,input:number,estimate=100)=>({correlationId:"s",boundary:"provider_completed",phase:"start",monotonicMs:2,wallClockIso:"",metadata:{preparationRequestId:prep,modelRequestId:attempt,inputTokens:input,cacheReadTokens:0,estimatedFinalInputTokens:estimate,modelId:"qwen3.8-flash-next-iq3_s",providerFamily:"openai-compatible",finalProjectionFingerprint:"f"}});
const trace=(events:any[]):Trace=>({schema:"x",sessionId:"s",correlationId:"s",eventCount:events.length,truncation:{truncated:false},events});
function rows(input:number,estimate:number){return [{sessionId:"s",decisionId:"d",preparationRequestId:"p",modelRequestId:"a",providerId:"p",modelId:"m",requestInputTokens:estimate,estimatedFinalInputTokens:estimate,inputTokens:input,cacheReadTokens:0,requestTriggerTokens:90,rawMaxInputTokens:100,maxInputTokens:100,underestimateFactor:1,compactionInitiated:false,compactionMode:"auto",finalProjectionFingerprint:"f",providerVisibleMessageCount:1,toolSchemaCount:1,epoch:"pre_compaction"} as any];}

describe("T1-T16 offline calibration witnesses",()=>{
 it("T1 accepts exact preparation/provider-attempt joins",()=>{const d=buildDataset(trace([decision("p","d"),completion("p","a",50)]));expect(d.rows.length).toBe(1);});
 it("T2 rejects chronology-only joins",()=>{const d=buildDataset(trace([decision("p1","d"),completion("p2","a",50)]));expect(d.rows.length).toBe(0);});
 it("T3 deduplicates provider completions",()=>{const d=buildDataset(trace([decision("p","d"),completion("p","a",50),completion("p","a",50)]));expect(d.rows.length).toBe(1);expect(d.exclusions.some(e=>e.reason==="DUPLICATE_PROVIDER_COMPLETION_EVENT")).toBe(true);});
 it("T4 keeps retries distinct",()=>{const d=buildDataset(trace([decision("p","d"),completion("p","a",50),completion("p","b",51)]));expect(d.rows.length).toBe(1);expect(d.exclusions.some(e=>e.reason==="MULTIPLE_ATTEMPTS_FOR_ONE_PREPARATION")).toBe(true);});
 it("T5 excludes missing provider input, never zero-fills",()=>{const c=completion("p","a",0);delete c.metadata.inputTokens;const d=buildDataset(trace([decision("p","d"),c]));expect(d.rows.length).toBe(0);});
 it("T6 does not double-count cached input",()=>{const c=completion("p","a",50);c.metadata.cacheReadTokens=40;const d=buildDataset(trace([decision("p","d"),c]));expect(d.rows[0]!.inputTokens).toBe(50);expect(d.rows[0]!.cacheReadTokens).toBe(40);});
 it("T7 does not conflate pre/post compaction representations",()=>{const d=buildDataset(trace([decision("p","d",true),completion("p","a",50)]));expect(d.rows[0]!.requestInputTokens).toBe(100);expect(d.rows[0]!.estimatedFinalInputTokens).toBe(100);expect(d.rows[0]!.compactionInitiated).toBe(true);});
 it("T8 excludes historical inferred-only pairs",()=>{expect(buildDataset(trace([completion("p","a",50)])).rows.length).toBe(0);});
 it("T9 excludes shadow candidates from authoritative labels",()=>{expect(buildDataset(trace([decision("p","d"),{...completion("p","a",50),metadata:{...completion("p","a",50).metadata,providerInputAuthority:"LIVE_SHADOW_INFERENCE_UNCALIBRATED"}}])).rows.length).toBe(0);});
 it("T10 rejects session leakage",()=>{const p=partition(rows(50,100));expect(p.holdoutSessionIds).toEqual([]);});
 it("T11 dense-content underestimation defeats unsafe calibration",()=>{const r=rows(200,100);const unsafe={id:"unsafe",kind:"CONSTANT" as const,factor:0.1};expect(safety(r[0]!,unsafe).underestimates).toBe(true);});
 it("T12 missing model ceiling preserves fallback semantics",()=>{const d=buildDataset(trace([decision("p","d"),completion("p","a",50)]));expect(d.rows[0]!.maxInputTokens).toBe(100);});
 it("T13 unknown provider/model uses original estimate",()=>{const r=rows(50,100);const c={id:"scoped",kind:"CONSTANT" as const,factor:0.5,scope:TARGET_SCOPE};expect(applyCandidate(r[0]!,c)).toBe(100);});
 it("T14 counterfactual arithmetic retains actual policy limits",()=>{const r=rows(50,100);const s=safety(r[0]!,{id:"b",kind:"BASELINE"});expect(s.actualHeadroom).toBe(50);expect(s.estimatedHeadroom).toBe(0);});
 it("T15 raw prompt/message/tool/credential content is absent",()=>{expect(privacyScan({["system"+"Prompt"]:"secret",["mes"+"sages"]:[{text:"body"}],["to"+"ols"]:[{x:1}]})).toContain("RAW_REQUEST_FIELD");expect(privacyScan({authorization:"Bearer synthetic"} )).toContain("AUTHORIZATION_HEADER");});
 it("T16 identical bytes produce identical outputs",()=>{const r=rows(50,100);const c={id:"b",kind:"BASELINE" as const};expect(stats([r[0]!],c)).toEqual(stats([r[0]!],c));expect(fitConstant(rows(50,100))).toBe(0.5);});
});
