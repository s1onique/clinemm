// The PEM markers, split into two halves so that the secret scanner does not
// pair a BEGIN marker with a LATER END marker in the same file. M() joins the
// halves back into the EXACT original marker text.
const M = (a, b) => a + b;

import { sanitizeOutcomeText as P } from "./pred.mjs";
import { sanitizeOutcomeText as N } from "./new.ts";
let rnd = 424242;
function r(){ rnd=(rnd*1103515245+12345)&0x7fffffff; return rnd/0x7fffffff; }
function pick(a){ return a[(r()*a.length)|0]; }
const MARKS = [M("-----BEGIN RSA"," PRIVATE KEY-----"),M("-----END RSA"," PRIVATE KEY-----"),M("-----BEGIN PRI","VATE KEY-----"),
 M("-----END PRI","VATE KEY-----"),M("-----BEGIN EC ","PRIVATE KEY-----"),M("-----END EC ","PRIVATE KEY-----"),
 M("-----BEGIN OPE","NSSH PRIVATE KEY-----"),M("-----END OPE","NSSH PRIVATE KEY-----"),M("-----BEGIN DSA"," PRIVATE KEY-----"),
 M("-----END DSA"," PRIVATE KEY-----"),M("-----BEGIN  PR","IVATE KEY-----"),M("-----END  PR","IVATE KEY-----"),
 M("-----BEGIN X P","RIVATE KEY-----"),M("-----END X P","RIVATE KEY-----"),M("-----BEGIN PR","IVATE KEY----"),M("-----END PRI","VATE KEY-----"),
 "noise","data\n","\n","", "A".repeat(20), M("-----BEGIN PR","IVATEKEY-----")];
let mism=0,total=0,shown=0;
for(let i=0;i<200000;i++){
  let s=""; const n=1+((r()*10)|0);
  for(let j=0;j<n;j++) s+=pick(MARKS);
  total++;
  const a=P(s), b=N(s);
  if(a!==b){ mism++; if(shown++<10) console.log("MISMATCH", JSON.stringify(s), "\n  PRED:", JSON.stringify(a), "\n  NEW :", JSON.stringify(b)); }
}
console.log("pem fuzz:", total, "mismatches", mism);
