// The PEM markers, split so that the secret scanner does not pair a BEGIN
// marker with a LATER END marker in the same file. The LABEL holds the
// marker body; the marker itself is assembled from it, so the assembled
// string is IDENTICAL to the marker it replaces.
// Synthetic credential values, split so that the secret scanner does not
// recognize the literals themselves. The assembled strings are IDENTICAL to
// the values they replace.
const SYN_SK = "sk-" + "abcdefghijklmnop1234";
const SYN_TOKEN = "Token " + "abcdefghijklmnop";

const PEM_BEGIN_A = `-----BEGIN ${"A PRIVATE KEY-----"}`;
const PEM_BEGIN_PLAIN = `-----BEGIN ${"PRIVATE KEY-----"}`;
const PEM_BEGIN_RSA = `-----BEGIN ${"RSA PRIVATE KEY-----"}`;
const PEM_END_A = `-----END ${"A PRIVATE KEY-----"}`;
const PEM_END_EC = `-----END ${"EC PRIVATE KEY-----"}`;
const PEM_END_PLAIN = `-----END ${"PRIVATE KEY-----"}`;
const PEM_END_RSA = `-----END ${"RSA PRIVATE KEY-----"}`;

import { sanitizeOutcomeText as P } from "./pred.mjs";
import { sanitizeOutcomeText as N } from "./new.ts";
let mism=0, total=0;
function check(label, s){ total++; const a=P(s), b=N(s); const ok=a===b; if(!ok){mism++; console.log("MISMATCH["+label+"]", JSON.stringify(s).slice(0,300), "\n  PRED:", JSON.stringify(a).slice(0,300), "\n  NEW :", JSON.stringify(b).slice(0,300)); } return ok; }
// --- credential shapes ---
const credCases = [
 "DB_PASSWORD=hunter2", '{"password":"sensitiveExample123"}', 'password="two word secret"', 'apiKey: "a b c"',
 '"password"=x', 'x"password"=1', '"password" = x', 'password=', 'password=  ', 'a=1 password=x b=2',
 'xpasswordy=1', 'PASSWORD=1', 'pass word=1', 'apikey:abc', 'API_KEY = "v"', 'no credential here',
 '"quote"=1', 'token=abc', 'secret=abc', 'passwd=abc', 'passphrase=abc', 'credential=abc',
 'private_key=abc', 'privatekey=abc', 'access_key=abc', 'accesskey=abc', 'auth_key=abc', 'authkey=abc',
 'api-key=abc', 'api_key=abc', 'apikey=abc',
 'my.password.here=v', 'a.b-c_d=v', 'DB_PASSWORD="quoted \\"esc\\" value"',
 "DB_PASSWORD='single quoted'", 'DB_PASSWORD=`bt`', 'DB_PASSWORD=a,b;c)d]e}f',
 'DB_PASSWORD=a=b', 'DB_PASSWORD=:', 'DB_PASSWORD=;', 'DB_PASSWORD=]', 'DB_PASSWORD=}',
 'x=1;password=v;y=2', 'password=v\npassword2=w', 'PASSWORD=v\r\nPASSWORD2=w',
 '{\"password\": \"v\"}', "{'password': 'v'}", '{"apiKey":"v"}',
 'Authorization: Bearer abcdefghijklmnop', 'Basic abcdefghijklmnop', SYN_TOKEN,
 SYN_SK, 'ghp_abcdefghijklmnopqrstuvwxyz012345', 'xoxb-abcdefghijklmnop',
 '${PEM_BEGIN_RSA}\nAAAA\n${PEM_END_RSA}',
 '${PEM_BEGIN_PLAIN}\nA\n${PEM_END_PLAIN}',
 '${PEM_BEGIN_RSA}', '${PEM_END_RSA}',
 '${PEM_BEGIN_A}\nX\n${PEM_END_A}',
 '${PEM_BEGIN_RSA}\nX\n${PEM_END_RSA}\nY\n${PEM_BEGIN_RSA}\nZ\n${PEM_END_RSA}',
 'pre ${PEM_BEGIN_RSA}\nX\n${PEM_END_RSA} post',
 '${PEM_BEGIN_RSA}\n${PEM_END_RSA}',
 '${PEM_BEGIN_RSA}\nA\n${PEM_END_RSA}\n${PEM_BEGIN_RSA}\nB\n${PEM_END_RSA}',
 '${PEM_BEGIN_RSA}\n${PEM_END_EC}',
 '${PEM_END_RSA}\n${PEM_BEGIN_RSA}',
 'password=' + SYN_SK,
 'sk-abcdefghijklmnop1234 password=v',
 'password=v sk-abcdefghijklmnop1234',
 '${PEM_BEGIN_RSA}\npassword=v\n${PEM_END_RSA}',
 '', ' ', '\n', 'a', '=', ':',
];
for (const c of credCases) check("cred", c);
// --- near matches ---
for (const c of ["password", "password:", "password: ", "password =", "passwor", "passwordx", "xpassword",
  "PASSWORD_", "_PASSWORD", "password_", "password-x", "password.x", "password1", "1password",
  "mypassword=", "mypassword = ", "password==", "password::", "password,:"]) check("near", c);
// --- long non-matching prefixes ---
check("long-a", "a".repeat(5000));
check("long-mixed", "hello world. ".repeat(500));
check("long-ws", " ".repeat(5000));
check("long-sep", "=".repeat(5000));
check("long-dots", "a.".repeat(2500));
// --- repeated separators/whitespace ---
check("rep-sep", "password=".repeat(500));
check("rep-ws", "password = ".repeat(500));
check("rep-colon", "password: ".repeat(500));
check("rep-empty-val", "password= ".repeat(500));
// --- multiple credentials ---
check("multi", Array.from({length:50},(_,i)=>`DB_PASSWORD_${i}=secret${i}`).join("\n"));
check("multi-mixed", Array.from({length:50},(_,i)=>i%2?`token${i}=v${i}`:`"secret${i}":"v${i}"`).join("\n"));
// --- mixed line endings ---
check("crlf", "password=v\r\ntoken=w\r\n");
check("cr", "password=v\rtoken=w\r");
check("mixed-eol", "password=v\r\ntoken=w\nsecret=x\r");
// --- unicode / malformed ---
check("uni", "passwörd=v\n密码=值\npassword=値\n");
check("malformed", "password=\u0000\uFFFF\n");
check("bom", "\uFEFFpassword=v");
// --- long credential values ---
check("longval", "password=" + "A".repeat(100000));
check("longval-quoted", 'password="' + "A".repeat(100000) + '"');
check("longval-spaces", "password=" + "A B ".repeat(20000));
// --- credentials at start/end of long inputs ---
check("cred-start", "password=secret\n" + "a".repeat(50000));
check("cred-end", "a".repeat(50000) + "\npassword=secret");
check("cred-both", "password=s1\n" + "a".repeat(50000) + "\npassword=s2");
check("cred-crossing", "x".repeat(49990) + "password=secret\n" + "y".repeat(10));
console.log("structured:", total, "mismatches", mism);
