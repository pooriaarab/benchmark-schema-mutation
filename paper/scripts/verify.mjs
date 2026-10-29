import assert from 'node:assert/strict';
import { readFileSync as read, writeFileSync as write, readdirSync } from 'node:fs';
import { execFileSync as exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import { score } from '../../dist/index.js';
import { wilson, mean } from '../template/stats.mjs';
const load = p => JSON.parse(read(p, 'utf8')), hash = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const runs = load('paper/data/runs.generated.json'), repeats = load('paper/data/repeat.generated.json'), sim = load('paper/data/simulated.generated.json'), summary = load('paper/data/summary.generated.json'), provenance = load('paper/data/provenance.generated.json'), meta = load('paper/meta.json');
const semantic = r => r.rows.map(x => ({taskId:x.taskId, answer:x.submission.answer, score:x.score, details:x.details}));
for (const [id,r] of Object.entries(runs)) {
  assert.equal(hash(semantic(r)), repeats[id].firstHash); assert.equal(hash(semantic(repeats[id].report)), repeats[id].secondHash); assert.equal(repeats[id].firstHash, repeats[id].secondHash);
  assert.deepEqual(wilson(r.rows.filter(x=>x.score===1).length,r.rows.length),summary.baseline[id].accuracy);
  assert.deepEqual(wilson(r.rows.filter(x=>x.details.staleSchemaUsed).length,r.rows.length),summary.baseline[id].stale);
  for (const x of r.rows) { const g = await score(x.taskId,{answer:x.submission.answer}); assert.equal(g.score,x.score); assert.deepEqual(g.details,x.details); }
}
for (const cell of sim) for (const r of cell.rows) { const g = await score(r.taskId,{answer:r.answer}); assert.equal(g.score,r.score); assert.equal(g.details.staleSchemaUsed,r.stale); assert.equal(r.answer,r.blocked?'':r.proposed); }
for (const s of summary.sweep) for (const key of ['score','stale','blocked','proposedStale']) { const cells=sim.filter(c=>c.q===s.q&&c.layer===s.layer); assert.equal(mean(cells.map(c=>mean(c.rows.map(r=>Number(r[key]))))),s[key].value); assert(s[key].low<=s[key].value+1e-12 && s[key].high>=s[key].value-1e-12); }
assert.equal(hash(sim),provenance.simulationHash); assert.equal(hash(Object.fromEntries(Object.entries(runs).map(([id,r])=>[id,semantic(r)]))),provenance.semanticHash);
for (const [p,h] of Object.entries(provenance.sources)) assert.equal(hash(read(p,'utf8')),h);
assert.equal(exec('git',['show',`${provenance.planCommit}:paper/PREREG.md`],{encoding:'utf8'}),read('paper/PREREG.md','utf8'));
assert(!exec('git',['ls-tree','-r','--name-only',provenance.planCommit],{encoding:'utf8'}).includes('paper/data/'));
assert.equal(meta.license,'CC-BY-4.0'); assert(meta.abstract.length<=1920 && /^[\x00-\x7f]*$/.test(meta.abstract));
assert(!read('paper/paper.tex','utf8').includes('\u2014'));
const info = exec('pdfinfo',[`paper/${meta.artifact_name}`],{encoding:'utf8'}), pages = Number(info.match(/Pages:\s+(\d+)/)[1]); assert(pages>=8);
const text = exec('pdftotext',[`paper/${meta.artifact_name}`,'-'],{encoding:'utf8'}); assert(text.includes('Schema Mutation') && !text.includes('Honesty')); assert(!/undefined references|undefined citations|Overfull/.test(read('paper/paper.log','utf8')));
assert.equal((read('paper/paper.tex','utf8').match(/\\begin\{figure\}/g)||[]).length,3);
const templateHashes = Object.fromEntries(readdirSync('paper/template').sort().map(f=>[f,hash(read(`paper/template/${f}`,'utf8'))]));
const evidence = { verified:true, pages, baselineRows:Object.values(runs).reduce((n,r)=>n+r.rows.length,0), simulatedRows:sim.reduce((n,c)=>n+c.rows.length,0), semanticHash:provenance.semanticHash, simulationHash:provenance.simulationHash, pdfSha256:createHash('sha256').update(read(`paper/${meta.artifact_name}`)).digest('hex'), templateHashes };
write('paper/data/verification.generated.json',JSON.stringify(evidence,null,2)+'\n'); console.log(JSON.stringify(evidence,null,2));
