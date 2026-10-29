import { readFileSync as read, writeFileSync as write } from 'node:fs';
import { execFileSync as exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { run, score, benchmark } from '../../dist/index.js';
import { wilson, bootstrap, mean } from '../template/stats.mjs';
const json = (path, x) => write(path, JSON.stringify(x, null, 2) + '\n');
const hash = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const tasks = await benchmark.listTasks();
const code = read('scripts/e2e.mjs', 'utf8');
const solverCode = code.slice(code.indexOf('const READERS ='), code.indexOf('const probe = createNetServer()'));
assert(solverCode.includes('function solveFromPrompt') && !/task\.expected|metadata\.stale/.test(solverCode));
const solve = vm.runInNewContext(solverCode + '\nsolveFromPrompt', { assert });
const toolsFor = prompt => JSON.parse(prompt.split('CURRENT TOOLS:\n')[1].split('\n\nUSER REQUEST:')[0]).tools;
const policies = { visible: p => solve(p), oracle: (_, t) => t.expected, stale: (_, t) => t.metadata.stale, empty: () => '', noop: () => '{"name":"noop","arguments":{}}', refuse: () => 'I cannot do that.', echo: p => p, first: p => JSON.stringify({ name: toolsFor(p)[0].name, arguments: {} }) };
const semantic = report => report.rows.map(r => ({ taskId: r.taskId, answer: r.submission.answer, score: r.score, details: r.details }));
const runs = {}, repeat = {};
for (const [id, policy] of Object.entries(policies)) {
  const adapter = { id: `scripted-${id}`, complete: async (prompt, ctx) => ({ content: policy(prompt, ctx.task) }), chat: async () => { throw new Error('Unexpected chat path'); } };
  runs[id] = await run(adapter, { concurrency: 1, retries: 0, seed: 20261029 });
  const again = await run(adapter, { concurrency: 1, retries: 0, seed: 20261029 });
  repeat[id] = { report: again, firstHash: hash(semantic(runs[id])), secondHash: hash(semantic(again)) };
  assert.equal(repeat[id].firstHash, repeat[id].secondHash);
}
// Shape-only control sees current schemas, never answer keys.
function valid(call, specs) {
  const spec = specs.find(t => t.name === call.name)?.parameters;
  if (!spec || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) return false;
  const args = call.arguments, props = spec.properties;
  if (spec.required.some(k => !(k in args)) || Object.keys(args).some(k => !(k in props))) return false;
  return Object.entries(args).every(([k, v]) => {
    const p = props[k], type = p.type === 'array' ? Array.isArray(v) && v.every(x => typeof x === p.items.type) : p.type === 'integer' ? Number.isInteger(v) : typeof v === p.type;
    return type && (!p.enum || p.enum.includes(v));
  });
}
const simulated = [];
for (let seed = 1; seed <= 100; seed++) {
  let state = seed >>> 0;
  const draws = tasks.map(() => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; });
  for (const q of [0, .25, .5, .75, 1]) for (const layer of ['pass', 'validate']) {
    const rows = [];
    for (const [i, t] of tasks.entries()) {
      const proposed = draws[i] < q ? t.expected : t.metadata.stale;
      const blocked = layer === 'validate' && !valid(JSON.parse(proposed), toolsFor(t.prompt));
      const answer = blocked ? '' : proposed, result = await score(t.id, { answer });
      rows.push({ taskId: t.id, proposed, answer, blocked, proposedStale: draws[i] >= q, score: result.score, stale: result.details.staleSchemaUsed });
    }
    simulated.push({ simulated: true, seed, q, layer, rows });
  }
}
const baseline = Object.fromEntries(Object.entries(runs).map(([id, report]) => [id, { accuracy: wilson(report.rows.filter(r => r.score === 1).length, tasks.length), stale: wilson(report.rows.filter(r => r.details.staleSchemaUsed).length, tasks.length) }]));
const families = [...new Set(tasks.map(t => t.metadata.tool))], kinds = [...new Set(tasks.map(t => t.metadata.mutationKind))];
const coverage = kinds.map(kind => ({ kind, n: tasks.filter(t => t.metadata.mutationKind === kind).length }));
const paired = bootstrap([families], gs => mean(gs[0].map(f => mean(tasks.filter(t => t.metadata.tool === f).map(t => runs.visible.rows.find(r => r.taskId === t.id).score - runs.stale.rows.find(r => r.taskId === t.id).score)))));
const sweep = [];
for (const q of [0, .25, .5, .75, 1]) for (const layer of ['pass', 'validate']) {
  const cells = simulated.filter(r => r.q === q && r.layer === layer), row = { simulated: true, q, layer, agents: cells.length };
  for (const key of ['score', 'stale', 'blocked', 'proposedStale']) row[key] = bootstrap([cells], gs => mean(gs[0].map(c => mean(c.rows.map(r => Number(r[key])))))) ;
  const other = simulated.filter(r => r.q === q && r.layer === 'pass');
  row.accuracyDifference = bootstrap([cells.map((c, i) => mean(c.rows.map(r => r.score)) - mean(other[i].rows.map(r => r.score)))], gs => mean(gs[0]));
  sweep.push(row);
}
json('paper/data/runs.generated.json', runs);
json('paper/data/repeat.generated.json', repeat);
json('paper/data/simulated.generated.json', simulated);
json('paper/data/summary.generated.json', { n: tasks.length, families: families.length, kinds: kinds.length, baseline, coverage, paired, sweep, freeModels: 'Not configured; availability untested; no learned-model scores.' });
const sources = ['data/tasks.jsonl', 'src/grader.ts', 'src/benchmark.ts', 'src/report.ts', 'scripts/e2e.mjs', 'paper/PREREG.md', 'paper/scripts/run.mjs', 'package-lock.json'];
json('paper/data/provenance.generated.json', { benchmarkCommit: '558460b9242c798f7ee538d878bd796a205331a7', planCommit: exec('git', ['log', '--reverse', '--format=%H', '--', 'paper/PREREG.md'], { encoding: 'utf8' }).trim().split('\n')[0], sources: Object.fromEntries(sources.map(p => [p, hash(read(p, 'utf8'))])), semanticHash: hash(Object.fromEntries(Object.entries(runs).map(([id, r]) => [id, semantic(r)]))), simulationHash: hash(simulated), node: process.version });
console.log(JSON.stringify({ baseline, paired, sweep: sweep.filter(x => x.q === .5) }, null, 2));
