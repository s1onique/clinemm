import fs from 'node:fs'
const head = fs.readFileSync('/tmp/hooks-HEAD.ts','utf8').split('\n')
const now  = fs.readFileSync('apps/vscode/src/sdk/hooks-adapter.ts','utf8').split('\n')
const norm = (s) => s.replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/[ \t]+/g,' ').replace(/\n\s*/g,'\n').trim()
const a = norm(head.slice(251,516).join('\n'))
const b = norm(now.slice(240,505).join('\n'))
// collapse ALL whitespace (incl. newlines) -> pure token stream
const tok = (s) => s.replace(/\s+/g,' ').trim()
const ta=tok(a), tb=tok(b)
console.log('token-stream EQUAL:', ta===tb, '(', ta.length, 'vs', tb.length, ')')
if(ta!==tb){ let i=0; while(i<Math.min(ta.length,tb.length)&&ta[i]===tb[i])i++; console.log('div at',i); console.log('HEAD:'+ta.slice(i-120,i+200)); console.log('NOW :'+tb.slice(i-120,i+200)); }
// SHA of the token stream
import crypto from 'node:crypto'
console.log('HEAD sha256:', crypto.createHash('sha256').update(ta).digest('hex'))
console.log('NOW  sha256:', crypto.createHash('sha256').update(tb).digest('hex'))
