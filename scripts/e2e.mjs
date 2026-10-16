import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const execFile = promisify(execFileCallback);

const tasks = (await readFile("data/tasks.jsonl", "utf8")).trim().split("\n").map((line) => JSON.parse(line));
assert.equal(tasks.length, 60);
const first = tasks[0].id;

await execFile("npm", ["run", "build"]);
const cli = await execFile(process.execPath, ["dist/cli.js", "run", "--model", "offline", "--provider", "mock", "--json"], { maxBuffer: 4_000_000 });
const report = JSON.parse(cli.stdout);
assert.equal(report.rows.length, tasks.length);
assert.ok(report.rows.some((row) => row.score === 1));
assert.ok(report.rows.some((row) => row.score === 0));

const probe = createNetServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const address = probe.address(); assert.ok(address && typeof address === "object");
await new Promise((resolve) => probe.close(resolve));
const server = spawn(process.execPath, ["dist/cli.js", "serve", String(address.port)], { stdio: ["ignore", "pipe", "pipe"] });
const base = `http://127.0.0.1:${address.port}`; const routes = {};
async function get(path) {
  const response = await fetch(`${base}${path}`); routes[`GET ${path}`] = response.status;
  return { response, value: await response.json() };
}
async function postScore(taskId, submission) {
  const response = await fetch(`${base}/v1/score`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId, submission }) });
  routes["POST /v1/score"] = response.status;
  return { status: response.status, value: await response.json() };
}
const graderPasses = {};
try {
  for (let attempt = 0; attempt < 100; attempt++) { try { await get("/health"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); } }
  const health = await get("/health"); assert.equal(health.response.status, 200);
  const listed = await get("/v1/tasks"); assert.equal(listed.value.tasks.length, tasks.length);
  const shown = await get(`/v1/tasks/${first}`); assert.equal(shown.value.task.id, first);
  const score = await postScore(first, report.rows[0].submission);
  assert.equal(score.status, 200);
  assert.equal((await get("/v1/provenance")).response.status, 200);
  assert.equal((await get("/v1/index-entry")).value.task_count, tasks.length);

  // Good-answers pass: the canonical expected call must score 1 on every task.
  let good = 0;
  for (const task of tasks) {
    const result = await postScore(task.id, { answer: task.expected });
    if (result.value.score === 1) good += 1;
  }
  assert.equal(good, tasks.length);
  graderPasses.good_answers = good;

  // Bad-answers pass: empty, junk, prose and other-task calls must score 0.
  const badSamples = ["", "__mock_incorrect__", '{"name":"noop","arguments":{}}', "Sure, I called the tool."];
  let bad = 0;
  for (const answer of badSamples) {
    for (const task of tasks) {
      const result = await postScore(task.id, { answer });
      assert.equal(result.value.score, 0);
      bad += 1;
    }
  }
  graderPasses.bad_answers = bad;

  // Same-answer pass: one canonical call replayed everywhere scores 0 elsewhere.
  let same = 0;
  for (const task of tasks.slice(1)) {
    const result = await postScore(task.id, { answer: tasks[0].expected });
    assert.equal(result.value.score, 0);
    same += 1;
  }
  graderPasses.same_answer_replays = same;

  // Stale pass: the pre-migration call scores 0 and is flagged staleSchemaUsed.
  let staleFlagged = 0;
  for (const task of tasks) {
    const result = await postScore(task.id, { answer: task.metadata.stale });
    assert.equal(result.value.score, 0);
    if (result.value.reason.includes("staleSchemaUsed")) staleFlagged += 1;
  }
  assert.equal(staleFlagged, tasks.length);
  graderPasses.stale_answers = staleFlagged;
} finally { if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); } }

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", "mcp"], cwd: process.cwd(), stderr: "pipe" });
const client = new Client({ name: "benchmark-schema-mutation-e2e", version: "0.1.0" });
await client.connect(transport); let toolNames;
try {
  const available = await client.listTools(); toolNames = available.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ["get_provenance", "get_task", "list_tasks", "run_benchmark", "score_answer"]);
  const calls = [
    ["list_tasks", {}], ["get_task", { taskId: first }],
    ["score_answer", { taskId: first, submission: report.rows[0].submission }],
    ["get_provenance", {}], ["run_benchmark", { model: "offline" }],
  ];
  for (const [name, args] of calls) {
    const result = await client.callTool({ name, arguments: args });
    if (name === "run_benchmark") assert.equal(result.isError, true); else assert.notEqual(result.isError, true);
  }
} finally { await client.close(); }

const byId = new Map(tasks.map((task) => [task.id, task]));
const perKind = {};
for (const row of report.rows) {
  const kind = byId.get(row.taskId)?.metadata?.mutationKind ?? "unknown";
  (perKind[kind] ??= { tasks: 0, correct: 0 }).tasks += 1;
  perKind[kind].correct += row.score === 1 ? 1 : 0;
}
const staleRate = report.rows.filter((row) => row.reason.includes("staleSchemaUsed")).length / report.rows.length;
const artifact = { task_count: report.rows.length, scores: report.rows.map((row) => row.score), per_mutation_kind: perKind, stale_schema_used_rate: staleRate, grader_passes: graderPasses, route_status_codes: routes, tool_names: toolNames };
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/e2e-report.json", `${JSON.stringify(artifact, null, 2)}\n`);
assert.match(await readFile("data/PROVENANCE.md", "utf8"), /Seeded schema-mutation task generator/);
console.log(`e2e: ${artifact.task_count} tasks, ${Object.keys(routes).length} routes, ${toolNames.length} tools -> all surfaces passed, ok`);
