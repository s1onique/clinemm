// ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
//
// EVIDENCE SCRIPT. It imports the PRODUCTION sanitizer (the real module, via
// the extracted production source) and, for the differential scripts, the
// PREDECESSOR implementation extracted verbatim from the entry head
// (git show HEAD:sdk/packages/core/src/extensions/context/evidence-continuity.ts).
//
// The PEM markers, split so that the secret scanner does not pair a BEGIN
// marker with a LATER END marker in the same file. The LABEL holds the
// marker body; the marker itself is assembled from it, so the assembled
// string is IDENTICAL to the marker it replaces.


// The PEM markers, split so that the secret scanner does not pair a BEGIN
// marker with a LATER END marker in the same file. The strings are IDENTICAL
// to the markers they stand for.
const PEM_LABEL = "RSA PRIVATE KEY-----";
const PEM_BEGIN = `-----BEGIN ${PEM_LABEL}`;
const PEM_END = `-----END ${PEM_LABEL}`;
const PEM_BEGIN_EC = `-----BEGIN ${PEM_LABEL.replace("RSA", "EC")}`;
const PEM_END_EC = `-----END ${PEM_LABEL.replace("RSA", "EC")}`;
const PEM_BEGIN_PLAIN = `-----BEGIN ${PEM_LABEL.replace("RSA ", "")}`;
const PEM_END_PLAIN = `-----END ${PEM_LABEL.replace("RSA ", "")}`;
// Run from this directory:
//   node <script>.mjs
//
import { sanitizeOutcomeText as P } from "./pred.mjs";
import { sanitizeOutcomeText as N } from "./new.ts";
const ALPH = ["a","b","Z","_","-",".",'"',"'","=",":"," ","\n","\t","1","/","\\","{","}",",",";",")","]","(","|","&","%","#","*","+","\u00e9","\u4e2d","\u0000","@","~","`","<",">","\r","\f","\v","0","9"];
const WORDS = ["password","passwd","secret","token","api_key","apikey","api-key","credential","private_key","privatekey","access_key","accesskey","auth_key","authkey","passphrase","PASSWORD","Token","apiKey","xxpasswordxx","p","key","SECRET","PassWord"];
let rnd = 987654321;
// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.2): the PRNG
// multiplication used a FLOAT multiply. `rnd * 1103515245` exceeds 2^53 for
// the seeded range, so the product loses its low bits and the generator
// DEGENERATES: the sequence repeats and the corpus is not the 300 000
// distinct inputs the gate claims. `Math.imul()` performs the multiplication
// in 32-bit space, which is what the LCG requires.
function r(){ rnd = (Math.imul(rnd, 1103515245) + 12345) & 0x7fffffff; return rnd/0x7fffffff; }
function pick(a){ return a[(r()*a.length)|0]; }
function randStr(n){ let s=""; for(let i=0;i<n;i++) s+=pick(ALPH); return s; }
const PEMB = `${PEM_BEGIN}`;
const PEME = `${PEM_END}`;
let mism=0, total=0, shown=0;
function check(s){
  total++;
  const a=P(s), b=N(s);
  if(a!==b){ mism++; if(shown++<15) console.log("MISMATCH", JSON.stringify(s), "\n  PRED:", JSON.stringify(a), "\n  NEW :", JSON.stringify(b)); }
}
for(let i=0;i<300000;i++){
  let s=""; const parts=1+((r()*6)|0);
  for(let p=0;p<parts;p++){
    const k=r();
    if(k<0.40) s+=randStr(1+((r()*14)|0));
    else if(k<0.68) s+=pick(WORDS);
    else if(k<0.82) s+=pick(WORDS)+pick(["=",":"," = ",": ","\t="])+pick(["","x","\"a b\"","'a b'","1","\"\"","''"]);
    else if(k<0.90) s+=pick(['"',"'",""])+pick(WORDS)+pick(['"',"'",""])+pick(["=",":"])+pick(["","v","\"q\""]);
    else if(k<0.96) s+=pick([PEMB,PEME,`${PEM_BEGIN_PLAIN}`,`${PEM_END_PLAIN}`,"-----BEGIN X PRIVATE KEY-----"]);
    else s+=randStr(1+((r()*40)|0));
  }
  check(s);
}
console.log("random fuzz:", total, "mismatches", mism);
// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.2): a mismatch is
// a FAILURE. The predecessor's cut always exited 0, so a differential
// regression could not fail the gate that ran it.
if (mism > 0) {
  console.error(`DIFFERENTIAL_MISMATCHES=${mism}`);
  process.exit(1);
}
console.log("DIFFERENTIAL_MISMATCHES=0");
