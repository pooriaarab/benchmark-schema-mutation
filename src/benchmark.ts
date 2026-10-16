import { readFile } from "node:fs/promises";
import { defineBenchmark, type Task } from "benchmark-core";
import { gradeCall } from "./grader.js";

async function loadTasks(): Promise<Task[]> {
  const text = await readFile(new URL("../data/tasks.jsonl", import.meta.url), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Task);
}

export const benchmark = defineBenchmark({
  id: "benchmark-schema-mutation", name: "Schema Mutation", tagline: "Tool schemas change. Does the model call the current one?", tags: ["helpful"], category: "tools",
  whatItMeasures: "Whether a model follows the current tool schema after a migration — renamed fields, new required fields, changed enums, split endpoints and type changes — instead of the version it memorized.",
  version: "0.1.0", status: "alpha", loadTasks,
  grade: (task, submission) => gradeCall(task, submission.answer),
  provenance: [{
    name: "Seeded schema-mutation task generator", kind: "synthetic", url: "https://github.com/pooriaarab/benchmark-schema-mutation/blob/main/scripts/gen-tasks.mjs",
    licence: "MIT",
    howToGet: "Run `node scripts/gen-tasks.mjs` for the public split (seed 20261015) or `node scripts/gen-tasks.mjs --seed <n> --split hidden` for a held-out split.",
    retrievedAt: "2026-10-16T00:00:00.000Z",
    contaminationNotes: "All 60 public tasks are synthetic mutations of 12 hand-authored base tool schemas. The hidden split uses a different seed and is never committed, so public tasks may enter training data without leaking final evaluation items.",
    refresh: "Change the seed, rerun the generator, and review the JSONL diff. Rotate mutation parameters quarterly.",
  }],
  gradingMethod: "Canonical JSON equality on the tool name and arguments after normalisation; exact matches against the pre-mutation call are reported as staleSchemaUsed.",
});
