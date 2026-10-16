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

// Hidden-split pass: a differently seeded split must produce different
// expected calls and prompts, not just new version strings. It is generated
// first so every later pass can use it, and it lives in .hidden/ -- inside
// .gitignore and outside the npm `files` list -- so it can never ship.
await execFile(process.execPath, ["scripts/gen-tasks.mjs", "--seed", "424242", "--split", "hidden"]);
const hiddenFile = ".hidden/tasks-hidden.jsonl";
const hiddenAbs = `${process.cwd()}/${hiddenFile}`;
const hidden = (await readFile(hiddenFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
assert.equal(hidden.length, tasks.length);
const publicExpected = new Set(tasks.map((task) => task.expected));
const mask = (text) => text.replace(/\d+\.\d+\.\d+/g, "V");
const publicPrompts = new Set(tasks.map((task) => mask(task.prompt)));
const graderPasses = {};
graderPasses.hidden_expected_differ = hidden.filter((task) => !publicExpected.has(task.expected)).length;
graderPasses.hidden_prompts_differ = hidden.filter((task) => !publicPrompts.has(mask(task.prompt))).length;
assert.ok(graderPasses.hidden_expected_differ >= tasks.length / 2, "hidden split reuses public expected calls");
assert.ok(graderPasses.hidden_prompts_differ >= tasks.length / 2, "hidden split reuses public prompts");

await execFile("npm", ["run", "build"]);
const cli = await execFile(process.execPath, ["dist/cli.js", "run", "--model", "offline", "--provider", "mock", "--json"], { maxBuffer: 4_000_000 });
const report = JSON.parse(cli.stdout);
assert.equal(report.rows.length, tasks.length);
assert.ok(report.rows.some((row) => row.score === 1));
assert.ok(report.rows.some((row) => row.score === 0));

// Report pass: rows carry grader details and the report carries the
// per-kind breakdown and staleSchemaUsed rate the charter requires.
const byIdEarly = new Map(tasks.map((task) => [task.id, task]));
assert.ok(report.rows.every((row) => row.details?.mutationKind === byIdEarly.get(row.taskId)?.metadata?.mutationKind));
assert.ok(report.rows.every((row) => typeof row.details?.staleSchemaUsed === "boolean"));
assert.deepEqual(Object.keys(report.perMutationKind).sort(), ["enumChange", "newRequired", "renamedField", "splitEndpoint", "typeChange"]);
assert.equal(typeof report.staleSchemaUsedRate, "number");
assert.ok(report.perMutationKind.enumChange.tasks === 12);

const markdown = await execFile(process.execPath, ["dist/cli.js", "run", "--model", "offline", "--provider", "mock"]);
assert.match(markdown.stdout, /## Schema mutation breakdown/);
assert.match(markdown.stdout, /staleSchemaUsed rate: \d+\.\d%/);

// CLI tasks pass: --tasks must run the alternate file on every command.
const cliHidden = await execFile(process.execPath, ["dist/cli.js", "run", "--model", "offline", "--provider", "mock", "--tasks", hiddenFile, "--json"], { maxBuffer: 4_000_000 });
const hiddenReport = JSON.parse(cliHidden.stdout);
assert.equal(hiddenReport.rows.length, hidden.length);
assert.ok(hiddenReport.rows.every((row) => row.taskId.startsWith("smh-")), "run --tasks did not use the hidden split");
const cliList = await execFile(process.execPath, ["dist/cli.js", "list", "--tasks", hiddenFile, "--json"], { maxBuffer: 4_000_000 });
assert.ok(JSON.parse(cliList.stdout).tasks.every((task) => task.id.startsWith("smh-")), "list --tasks did not use the hidden split");
graderPasses.cli_tasks_option = 2;

// SDK caching pass: default, hidden, default, hidden in ONE process. If the
// benchmark object cached the task list across options (the `loaded ??=` trap
// in benchmark-core), the third or fourth run would return the wrong ids.
const { mockAdapter } = await import("benchmark-core");
const sdk = await import("../dist/index.js");
const adapter = mockAdapter({ seed: 7 });
const sequence = [
  (await sdk.run(adapter)).rows.map((row) => row.taskId),
  (await sdk.run(adapter, { tasks: hiddenFile })).rows.map((row) => row.taskId),
  (await sdk.run(adapter)).rows.map((row) => row.taskId),
  (await sdk.run(adapter, { tasks: hiddenFile })).rows.map((row) => row.taskId),
];
assert.ok(sequence[0].every((id) => id.startsWith("smu-")) && sequence[2].every((id) => id.startsWith("smu-")), "SDK default run leaked alternate tasks");
assert.ok(sequence[1].every((id) => id.startsWith("smh-")) && sequence[3].every((id) => id.startsWith("smh-")), "SDK run ignored the tasks option");
assert.equal((await sdk.score(hidden[0].id, { answer: hidden[0].expected }, { tasks: hiddenFile })).score, 1);
graderPasses.sdk_alternate_tasks = 5;

// --- Visible-information policy --------------------------------------------
// READERS turn each tool's request sentence into {description: value} pairs,
// mirroring the property descriptions the base schema uses.
const READERS = [
  ["Create an issue", /In (\S+) open a '([^']+)' issue titled '([^']+)' with body '([^']+)', label (\S+), visible to (\w+)/,
    (m) => ({ "Repository as owner/name": m[1], "Issue kind": m[2], "Issue title": m[3], "Markdown body": m[4], "Label names": [m[5]], "Who can see it": m[6] })],
  ["Create a payment charge", /Charge customer (\S+) (\d+(?:\.\d+)?) in '([^']+)' for '([^']+)' with (\w+) capture/,
    (m) => ({ "Customer id": m[1], "Amount in dollars": Number(m[2]), "Settlement currency": m[3], "Statement text": m[4], "Capture mode": m[5] })],
  ["Post a message", /Post '([^']+)' to (\S+) with attachment (\S+) at '([^']+)' priority for (\w+)/,
    (m) => ({ "Message text": m[1], "Channel name": m[2], "Attachment URLs": [m[3]], "Delivery priority": m[4], "Who may read it": m[5] })],
  ["Create a calendar event", /On calendar (\S+) create '([^']+)' starting (\S+) lasting (\d+) minutes with attendees (.+?), status '([^']+)', on the (\w+) calendar/,
    (m) => ({ "Calendar id": m[1], "Event title": m[2], "ISO 8601 start time": m[3], "Length in minutes": Number(m[4]), "Attendee emails": m[5].split(" and "), "Event status": m[6], "Calendar scope": m[7] })],
  ["Open a support ticket", /Open a ticket in the '([^']+)' queue for (\S+) titled '([^']+)' saying '([^']+)', tag (\S+), priority '([^']+)'/,
    (m) => ({ "Routing queue": m[1], "Requester email": m[2], "Ticket subject": m[3], "First comment": m[4], "Tag names": [m[5]], "Ticket priority": m[6] })],
  ["Send a transactional email", /Email (\S+) subject '([^']+)' body '([^']+)', cc (\S+), '([^']+)' importance, (\w+) audience/,
    (m) => ({ "Recipient address": m[1], "Subject line": m[2], "Plain text body": m[3], "CC addresses": [m[4]], "Importance flag": m[5], "Recipient class": m[6] })],
  ["Upload an object", /Upload (\S+) \(([^)]+)\) to bucket (\S+), tags (.+?), '([^']+)' storage, (\w+) acl/,
    (m) => ({ "Object key": m[1], "MIME type": m[2], "Bucket name": m[3], "Object tags": m[4].split(" and "), "Storage class": m[5], "Access policy": m[6] })],
  ["Run a keyword search", /Search the '([^']+)' index for '([^']+)', limit (\d+), filter (\S+), scope (\w+)/,
    (m) => ({ "Index to search": m[1], "Query text": m[2], "Max results": Number(m[3]), "Filter expressions": [m[4]], "Result scope": m[5] })],
  ["Send a text message", /Text (\S+) from (\S+) saying '([^']+)' with media (\S+), '([^']+)' priority over (\w+)/,
    (m) => ({ "Recipient number": m[1], "Sender number": m[2], "Message body": m[3], "Media URLs": [m[4]], "Send priority": m[5], "Bearer channel": m[6] })],
  ["Trigger a deployment", /Deploy (\S+) ref (\S+) with (\d+) replicas to '([^']+)' using a (\w+) strategy; notify (.+?)\./,
    (m) => ({ "Service name": m[1], "Git ref or tag": m[2], "Replica count": Number(m[3]), "Target environment": m[4], "Rollout strategy": m[5], "Notification channels": m[6].split(" and ") })],
  ["Update a CRM contact", /Update contact (\S+): email (\S+), phone (\S+), tag (\S+), stage '([^']+)', owner (\w+)/,
    (m) => ({ "Contact id": m[1], "Email address": m[2], "Phone number": m[3], "Contact tags": [m[4]], "Pipeline stage": m[5], "Owning team": m[6] })],
  ["Refund a captured payment", /Refund payment (\S+) for \$(\d+(?:\.\d+)?), reason '([^']+)', back to (\w+)/,
    (m) => ({ "Payment id": m[1], "Amount in dollars": Number(m[2]), "Refund reason": m[3], "Refund destination": m[4] })],
];

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function coerceValue(prop, base, request) {
  const legend = prop.description.match(/Pre-migration values map as: (.+)$/);
  if (legend) {
    const map = Object.fromEntries(legend[1].split(",").map((pair) => pair.trim().split(" -> ")));
    return map[base] ?? base;
  }
  if (prop.type === "array") return Array.isArray(base) ? base : [base];
  if (prop.type === "string") {
    if (/ISO 8601 duration/.test(prop.description)) return `PT${base}M`;
    if (Array.isArray(base)) return base.join(",");
    if (typeof base === "number") {
      // Money is printed with the exact decimals the schema expects; fall
      // back to the numeric token in the request that equals the base value.
      return request.match(/\d+\.\d{2}\b/g)?.find((token) => Number(token) === base)
        ?? request.match(/\d+(?:\.\d+)?/g)?.find((token) => Number(token) === base)
        ?? String(base);
    }
    return base;
  }
  if (prop.type === "integer" || prop.type === "number") {
    if (/cents/i.test(prop.description)) return Math.round(base * 100);
    return typeof base === "number" ? base : Number(base);
  }
  return base;
}

// Builds {"name","arguments"} from the prompt alone. A type-changed field
// keeps neither name nor description, so after matching every other property
// by description the one leftover property pairs with the one leftover value.
function solveFromPrompt(prompt) {
  const tools = JSON.parse(prompt.split("CURRENT TOOLS:\n")[1].split("\n\nUSER REQUEST:")[0]).tools;
  const request = prompt.split("USER REQUEST:\n")[1].split("\n\nRespond with")[0];
  const tool = tools.length === 1 ? tools[0] : tools.find((candidate) => {
    const tag = candidate.description.match(/\((\w+): ([^)]+)\)$/);
    return tag !== null && new RegExp(`\\b${escapeRe(tag[2])}\\b`).test(request);
  });
  assert.ok(tool, "policy found no tool matching the request");
  const reader = READERS.find(([desc]) => tool.description.startsWith(desc));
  assert.ok(reader, `policy has no reader for ${tool.description}`);
  const match = request.match(reader[1]);
  assert.ok(match, `policy cannot parse request: ${request}`);
  const base = reader[2](match);
  const added = {};
  for (const clause of request.matchAll(/New required field '(\w+)': set it to (.+?)\.(?=\s|$)/g)) added[clause[1]] = JSON.parse(clause[2]);
  const args = {};
  const used = new Set();
  const pending = [];
  for (const [name, prop] of Object.entries(tool.parameters.properties)) {
    if (name in added) { args[name] = added[name]; continue; }
    const desc = Object.keys(base).find((d) => prop.description === d || prop.description.startsWith(`${d}.`));
    if (desc === undefined) pending.push([name, prop]);
    else { args[name] = coerceValue(prop, base[desc], request); used.add(desc); }
  }
  const leftover = Object.keys(base).filter((d) => !used.has(d));
  // A type change leaves one unmatched prop and one unmatched base value; a
  // split endpoint leaves only the removed field's value. Anything else is a
  // shape the policy cannot solve.
  assert.ok(pending.length <= 1 && leftover.length >= pending.length, `policy cannot pair ${pending.length} renamed fields with ${leftover.length} values`);
  pending.forEach(([name, prop], i) => { args[name] = coerceValue(prop, base[leftover[i]], request); });
  return JSON.stringify({ name: tool.name, arguments: args });
}

const probe = createNetServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const address = probe.address(); assert.ok(address && typeof address === "object");
await new Promise((resolve) => probe.close(resolve));
const server = spawn(process.execPath, ["dist/cli.js", "serve", String(address.port)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, BENCHMARK_SCHEMA_MUTATION_TASKS_ALLOW: hiddenAbs },
});
const base = `http://127.0.0.1:${address.port}`; const routes = {};
async function get(path) {
  const response = await fetch(`${base}${path}`); routes[`GET ${path}`] = response.status;
  return { response, value: await response.json() };
}
async function postScore(taskId, submission, tasksPath) {
  const query = tasksPath === undefined ? "" : `?tasks=${encodeURIComponent(tasksPath)}`;
  const response = await fetch(`${base}/v1/score${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId, submission }) });
  routes[`POST /v1/score${query === "" ? "" : "?tasks=<path>"}`] = response.status;
  return { status: response.status, value: await response.json() };
}
try {
  for (let attempt = 0; attempt < 100; attempt++) { try { await get("/health"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); } }
  const health = await get("/health"); assert.equal(health.response.status, 200);
  const listed = await get("/v1/tasks"); assert.equal(listed.value.tasks.length, tasks.length);
  const shown = await get(`/v1/tasks/${first}`); assert.equal(shown.value.task.id, first);
  const score = await postScore(first, report.rows[0].submission);
  assert.equal(score.status, 200);
  assert.equal(score.value.details?.mutationKind, tasks[0].metadata.mutationKind);
  assert.equal(typeof score.value.details?.staleSchemaUsed, "boolean");
  assert.equal((await get("/v1/provenance")).response.status, 200);
  assert.equal((await get("/v1/index-entry")).value.task_count, tasks.length);

  // API tasks pass: an allow-listed file switches every route, anything else
  // is refused rather than silently graded against the default split.
  const altListed = await get(`/v1/tasks?tasks=${encodeURIComponent(hiddenAbs)}`);
  assert.ok(altListed.value.tasks.every((task) => task.id.startsWith("smh-")));
  const altShown = await get(`/v1/tasks/${hidden[0].id}?tasks=${encodeURIComponent(hiddenAbs)}`);
  assert.equal(altShown.value.task.id, hidden[0].id);
  const altScore = await postScore(hidden[0].id, { answer: hidden[0].expected }, hiddenAbs);
  assert.equal(altScore.value.score, 1);
  const refused = await get(`/v1/tasks?tasks=${encodeURIComponent("/etc/passwd")}`);
  assert.equal(refused.response.status, 403);
  graderPasses.api_alternate_tasks = 4;

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

  // Enum-wording pass: enumChange requests keep pre-migration wording, so the
  // new enum value must not appear in the request and a verbatim copy of the
  // user's words is the stale call.
  let enumOldWording = 0;
  for (const task of tasks.filter((t) => t.metadata.mutationKind === "enumChange")) {
    const expected = JSON.parse(task.expected);
    const stale = JSON.parse(task.metadata.stale);
    const changed = Object.keys(expected.arguments).find((k) => JSON.stringify(expected.arguments[k]) !== JSON.stringify(stale.arguments[k]));
    const request = task.prompt.split("USER REQUEST:")[1].split("Respond with")[0];
    assert.ok(!new RegExp(`\\b${expected.arguments[changed]}\\b`).test(request), `${task.id} request leaks the new enum value`);
    assert.ok(task.prompt.includes(`-> ${expected.arguments[changed]}`), `${task.id} schema lacks the old->new legend`);
    const result = await postScore(task.id, { answer: task.metadata.stale });
    assert.equal(result.value.score, 0);
    assert.ok(result.value.reason.includes("staleSchemaUsed"));
    enumOldWording += 1;
  }
  assert.equal(enumOldWording, tasks.length / 5);
  graderPasses.enum_old_wording = enumOldWording;

  // Equivalence pass: prose, code fences, key reordering, wire wrappers and
  // string-encoded arguments must all score 1; foreign envelopes score 0.
  let equivalent = 0;
  for (const task of tasks) {
    const call = JSON.parse(task.expected);
    const reordered = JSON.stringify({ arguments: Object.fromEntries(Object.entries(call.arguments).reverse()), name: call.name });
    const prose = `Here is the call:\n\`\`\`json\n${reordered}\n\`\`\`\nDone.`;
    assert.equal((await postScore(task.id, { answer: prose })).value.score, 1);
    const wire = JSON.stringify({ tool_calls: [{ id: "c1", type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] });
    assert.equal((await postScore(task.id, { answer: wire })).value.score, 1);
    const strArgs = JSON.stringify({ name: call.name, arguments: JSON.stringify(call.arguments) });
    assert.equal((await postScore(task.id, { answer: strArgs })).value.score, 1);
    const foreign = JSON.stringify({ tool: call.name, args: call.arguments });
    assert.equal((await postScore(task.id, { answer: foreign })).value.score, 0);
    equivalent += 1;
  }
  assert.equal(equivalent, tasks.length);
  graderPasses.equivalent_answers = equivalent;

  // Value-form pass: number folding, comma-list whitespace and equal ISO
  // durations must score 1; string-typed numbers still score 0.
  const intTask = tasks.find((t) => Object.values(JSON.parse(t.expected).arguments).some((v) => Number.isInteger(v)));
  const intCall = JSON.parse(intTask.expected);
  const intKey = Object.keys(intCall.arguments).find((k) => Number.isInteger(intCall.arguments[k]));
  const intText = JSON.stringify(intCall);
  assert.equal((await postScore(intTask.id, { answer: intText.replace(`:${intCall.arguments[intKey]}`, `:${intCall.arguments[intKey]}.0`) })).value.score, 1);
  assert.equal((await postScore(intTask.id, { answer: intText.replace(`:${intCall.arguments[intKey]}`, `:"${intCall.arguments[intKey]}"`) })).value.score, 0);
  graderPasses.number_folding = 2;
  const commaTask = tasks.find((t) => Object.values(JSON.parse(t.expected).arguments).some((v) => typeof v === "string" && v.includes(",")));
  const commaCall = JSON.parse(commaTask.expected);
  const commaKey = Object.keys(commaCall.arguments).find((k) => typeof commaCall.arguments[k] === "string" && commaCall.arguments[k].includes(","));
  commaCall.arguments[commaKey] = commaCall.arguments[commaKey].split(",").join(", ");
  assert.equal((await postScore(commaTask.id, { answer: JSON.stringify(commaCall) })).value.score, 1);
  graderPasses.comma_list_spacing = 1;

  // Visible-information pass: the prompt-only policy must solve every task on
  // both splits; a miss means the request withholds a value the answer needs.
  let solvedPublic = 0;
  for (const task of tasks) {
    const result = await postScore(task.id, { answer: solveFromPrompt(task.prompt) });
    if (result.value.score === 1) solvedPublic += 1;
  }
  let solvedHidden = 0;
  for (const task of hidden) {
    const result = await postScore(task.id, { answer: solveFromPrompt(task.prompt) }, hiddenAbs);
    if (result.value.score === 1) solvedHidden += 1;
  }
  graderPasses.visible_info_solved = `${solvedPublic}/${tasks.length} public, ${solvedHidden}/${hidden.length} hidden`;
  assert.equal(solvedPublic, tasks.length, "public tasks unsolvable from the visible prompt");
  assert.equal(solvedHidden, hidden.length, "hidden tasks unsolvable from the visible prompt");
} finally { if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); } }

// Duration pass: no public task carries a duration argument, so grade a
// synthetic task through the SDK to prove equal durations compare equal.
const { benchmark: bench } = await import("../dist/index.js");
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : (v !== null && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v));
const durTask = { id: "e2e-duration", kind: "single", prompt: "", expected: canonical({ name: "events.create", arguments: { duration_min: "PT45M" } }), metadata: { mutationKind: "typeChange" } };
assert.equal((await bench.score(durTask, { answer: '{"name":"events.create","arguments":{"duration_min":"PT0H45M"}}' })).score, 1);
graderPasses.equal_durations = 1;

const transport = new StdioClientTransport({
  command: process.execPath, args: ["dist/cli.js", "mcp"], cwd: process.cwd(), stderr: "pipe",
  env: { ...process.env, BENCHMARK_SCHEMA_MUTATION_TASKS_ALLOW: hiddenAbs },
});
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
  // MCP tasks pass: a `tasks` argument switches tools to the allow-listed file.
  const altTools = await client.callTool({ name: "list_tasks", arguments: { tasks: hiddenAbs } });
  const altIds = JSON.parse(altTools.content[0].text).tasks.map((task) => task.id);
  assert.ok(altIds.every((id) => id.startsWith("smh-")), "MCP list_tasks ignored the tasks argument");
  const altAnswer = await client.callTool({ name: "score_answer", arguments: { taskId: hidden[0].id, submission: { answer: hidden[0].expected }, tasks: hiddenAbs } });
  assert.equal(JSON.parse(altAnswer.content[0].text).score, 1);
  const refused = await client.callTool({ name: "list_tasks", arguments: { tasks: "/etc/passwd" } });
  assert.equal(refused.isError, true);
  graderPasses.mcp_alternate_tasks = 3;
  // MCP run pass: run_benchmark accepts the mock provider, honours tasks, and
  // reports the same per-kind breakdown and stale rate as the CLI and API.
  const mcpRun = await client.callTool({ name: "run_benchmark", arguments: { model: "offline", provider: "mock" } });
  assert.notEqual(mcpRun.isError, true);
  const mcpReport = JSON.parse(mcpRun.content[0].text);
  assert.equal(mcpReport.rows.length, tasks.length);
  assert.deepEqual(Object.keys(mcpReport.perMutationKind).sort(), ["enumChange", "newRequired", "renamedField", "splitEndpoint", "typeChange"]);
  assert.equal(typeof mcpReport.staleSchemaUsedRate, "number");
  const mcpAlt = await client.callTool({ name: "run_benchmark", arguments: { model: "offline", provider: "mock", tasks: hiddenAbs } });
  assert.ok(JSON.parse(mcpAlt.content[0].text).rows.every((row) => row.taskId.startsWith("smh-")), "MCP run_benchmark ignored the tasks argument");
  graderPasses.mcp_run_breakdown = 4;
} finally { await client.close(); }

// SDK pass: non-string answers reach the grader through score(), not the API.
const { score: scoreOne } = await import("../dist/index.js");
let nonString = 0;
for (const answer of [null, 42, { name: "x" }, ["a", "b"]]) {
  const result = await scoreOne(first, { answer });
  assert.equal(result.score, 0);
  nonString += 1;
}
const deep = `{"name":"issues.create","arguments":{"x":${"[".repeat(5000)}${"]".repeat(5000)}}}`;
assert.equal((await scoreOne(first, { answer: deep })).score, 0);
graderPasses.non_string_answers = nonString + 1;

// Pack pass: the npm tarball must never list a hidden-split file. This runs
// after the hidden fixture exists, so a regression that writes it back into
// data/ (or anywhere else inside `files`) fails here.
const packed = JSON.parse((await execFile("npm", ["pack", "--dry-run", "--json"])).stdout);
const packedNames = packed.flatMap((entry) => entry.files.map((file) => file.path));
assert.ok(!packedNames.some((name) => name.includes("hidden")), `npm pack lists hidden files: ${packedNames.filter((name) => name.includes("hidden")).join(", ")}`);
graderPasses.pack_excludes_hidden = packedNames.length;

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
