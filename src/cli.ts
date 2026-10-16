#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  bootstrapCI, createCli, mockAdapter, openaiCompatAdapter, openrouterAdapter,
  renderMarkdown, run as runBenchmark, type ModelAdapter, type RunReport,
} from "benchmark-core";
import { benchmark } from "./benchmark.js";
import { enrichReport, type SchemaMutationReport } from "./report.js";

const bin = "benchmark-schema-mutation";
const usage = `Usage: ${bin} <list|show|run|score|card|provenance|index-entry|serve|mcp> [options]`;

class UsageError extends Error {}

function isUsageError(error: unknown): boolean {
  if (error instanceof UsageError) return true;
  const code = error !== null && typeof error === "object" ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS");
}

function pickAdapter(provider: string | undefined, model: string | undefined, seed: number): ModelAdapter {
  if (!model || !provider) throw new UsageError("run needs --model and --provider.");
  if (provider === "mock") return mockAdapter({ seed });
  if (provider === "openrouter") return openrouterAdapter({ model });
  if (provider === "openai") return openaiCompatAdapter({ model });
  throw new UsageError("--provider must be openrouter, openai, or mock.");
}

function render(report: SchemaMutationReport, jsonOutput: boolean): void {
  if (jsonOutput) { console.log(JSON.stringify(report)); return; }
  const lines = [renderMarkdown(report), "", "## Schema mutation breakdown", ""];
  for (const [kind, bucket] of Object.entries(report.perMutationKind)) lines.push(`- ${kind}: ${bucket.passed}/${bucket.tasks}`);
  lines.push(`- staleSchemaUsed rate: ${(report.staleSchemaUsedRate * 100).toFixed(1)}%`);
  console.log(lines.join("\n"));
}

async function runCommand(clean: string[], jsonOutput: boolean): Promise<number> {
  const parsed = parseArgs({
    args: clean,
    options: {
      model: { type: "string" }, provider: { type: "string" }, concurrency: { type: "string" },
      timeout: { type: "string" }, retries: { type: "string" }, seed: { type: "string" },
      "max-turns": { type: "string" }, "max-tool-calls": { type: "string" }, budget: { type: "string" },
    },
    strict: true,
  });
  const seed = Number(parsed.values.seed ?? 1);
  const adapter = pickAdapter(parsed.values.provider, parsed.values.model, seed);
  const report = await runBenchmark(benchmark, adapter, {
    ...parsed.values.concurrency ? { concurrency: Number(parsed.values.concurrency) } : {},
    ...parsed.values.timeout ? { timeoutMs: Number(parsed.values.timeout) } : {},
    ...parsed.values.retries ? { retries: Number(parsed.values.retries) } : {},
    seed,
    ...parsed.values["max-turns"] ? { maxTurns: Number(parsed.values["max-turns"]) } : {},
    ...parsed.values["max-tool-calls"] ? { maxToolCalls: Number(parsed.values["max-tool-calls"]) } : {},
    ...parsed.values.budget ? { budgetUsd: Number(parsed.values.budget) } : {},
  });
  const enriched = enrichReport(report, await benchmark.listTasks());
  render(enriched, jsonOutput);
  return enriched.rows.some((row) => row.error) ? 2 : 0;
}

async function scoreCommand(clean: string[], jsonOutput: boolean): Promise<number> {
  const file = clean[0];
  if (!file) throw new UsageError("score needs a results JSON file.");
  const original = JSON.parse(await readFile(file, "utf8")) as RunReport;
  if (original === null || typeof original !== "object" || !Array.isArray(original.rows)) {
    throw new UsageError("File is not a run report.");
  }
  const rows = [];
  for (const row of original.rows) {
    const task = await benchmark.getTask(row.taskId);
    if (!task || row.submission === undefined) throw new UsageError(`Cannot score task ${row.taskId}.`);
    const grade = await benchmark.score(task, row.submission, { seed: original.seed });
    rows.push({ ...row, score: grade.score, reason: grade.reason });
  }
  const scores = rows.map((row) => row.score);
  const rescored = { ...original, rows, mean: scores.reduce((a, b) => a + b, 0) / scores.length, confidenceInterval95: bootstrapCI(scores, original.seed) };
  render(enrichReport(rescored, await benchmark.listTasks()), jsonOutput);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  const rest = argv.slice(1);
  const jsonOutput = rest.includes("--json");
  const clean = rest.filter((arg) => arg !== "--json");
  try {
    if (command === "run") return await runCommand(clean, jsonOutput);
    if (command === "score") return await scoreCommand(clean, jsonOutput);
    return await createCli(benchmark, { bin }).main(argv);
  } catch (caught) {
    const invalid = isUsageError(caught);
    console.error(caught instanceof Error ? caught.message : String(caught));
    if (invalid) console.error(usage);
    return invalid ? 1 : 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
