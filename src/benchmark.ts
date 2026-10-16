import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineBenchmark, type Benchmark, type Task } from "benchmark-core";
import { gradeCall } from "./grader.js";

const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));
const DEFAULT_TASKS = new URL("../data/tasks.jsonl", import.meta.url);

// Colon-separated list of task files the API and MCP surfaces may load.
export const TASKS_ALLOW_ENV = "BENCHMARK_SCHEMA_MUTATION_TASKS_ALLOW";

export async function loadTasksFile(path: string | URL): Promise<Task[]> {
  const text = await readFile(path, "utf8");
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Task);
}

// A fresh Benchmark object per call: benchmark-core caches the task list
// inside the object (`loaded ??=`), so two paths can never share one object.
export function makeBenchmark(loadTasks: () => Promise<readonly Task[]>): Benchmark<Task> {
  return defineBenchmark({
    id: "benchmark-schema-mutation",
    name: "Schema Mutation",
    tagline: "Tool schemas change. Does the model call the current one?",
    tags: ["helpful"],
    category: "tools",
    whatItMeasures:
      "Whether a model follows the current tool schema after a migration — renamed fields, new required fields, changed enums, split endpoints and type changes — instead of the version it memorized.",
    version: "0.1.0",
    status: "alpha",
    loadTasks,
    grade: (task, submission) => gradeCall(task, submission.answer),
    provenance: [
      {
        name: "Seeded schema-mutation task generator",
        kind: "synthetic",
        url: "https://github.com/pooriaarab/benchmark-schema-mutation/blob/main/scripts/gen-tasks.mjs",
        licence: "MIT",
        howToGet:
          "Run `node scripts/gen-tasks.mjs` for the public split (seed 20261015) or `node scripts/gen-tasks.mjs --seed <n> --split hidden` for a held-out split.",
        retrievedAt: "2026-10-15T00:00:00.000Z",
        contaminationNotes:
          "All 60 public tasks are synthetic mutations of 12 hand-authored base tool schemas. The hidden split uses a different seed, which selects different values, mutation variants, field names and enum targets, and is never committed, so public tasks may enter training data without leaking final evaluation items.",
        refresh: "Change the seed, rerun the generator, and review the JSONL diff. Rotate mutation parameters quarterly.",
      },
    ],
    gradingMethod:
      "Canonical JSON equality on the tool name and arguments after normalisation; exact matches against the pre-migration call are reported as staleSchemaUsed.",
  });
}

export const benchmarkForTasksFile = (path: string | URL): Benchmark<Task> =>
  makeBenchmark(() => loadTasksFile(path));

export const benchmark = makeBenchmark(() => loadTasksFile(DEFAULT_TASKS));

// Resolve a caller-supplied tasks path for the remote surfaces (API, MCP).
// Bare file names resolve inside the package data/ directory; anything else
// must be listed in TASKS_ALLOW_ENV. Returns undefined when not allowed.
export function resolveAllowedTasksPath(requested: string): string | undefined {
  const candidate = requested.includes("/") || requested.includes("\\")
    ? resolve(requested)
    : resolve(DATA_DIR, requested);
  if (candidate === DATA_DIR.slice(0, -1) || candidate.startsWith(DATA_DIR)) return candidate;
  const allowed = (process.env[TASKS_ALLOW_ENV] ?? "")
    .split(":")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => resolve(entry));
  return allowed.includes(candidate) ? candidate : undefined;
}
