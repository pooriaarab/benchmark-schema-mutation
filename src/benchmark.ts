import { readFile } from "node:fs/promises";
import { defineBenchmark, exactMatch, replay, type Environment, type JsonValue, type Task, type ToolResult } from "benchmark-core";

async function loadTasks(): Promise<Task[]> {
  const text = await readFile(new URL("../data/tasks.jsonl", import.meta.url), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Task);
}
class StarterEnvironment implements Environment {
  #finished = false;
  reset() {
    this.#finished = false;
    return { system: "Call finish_task once, then stop.", tools: [{ name: "finish_task", description: "Mark the task finished.", parameters: { type: "object" as const, properties: {}, additionalProperties: false } }] };
  }
  callTool(name: string, _args: Record<string, JsonValue>): ToolResult {
    if (name !== "finish_task") return { result: null, error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` } };
    this.#finished = true; return { result: { finished: true } };
  }
  state() { return { finished: this.#finished }; }
  done() { return this.#finished; }
}
export const benchmark = defineBenchmark({
  id: "benchmark-schema-mutation", name: "Schema Mutation", tagline: "Tool schemas change. Does the model call the current one?", tags: ["helpful"], category: "tools",
  whatItMeasures: "Whether a model follows the current tool schema after a migration — renamed fields, new required fields, changed enums, split endpoints and type changes — instead of the version it memorized.",
  version: "0.1.0", status: "alpha", loadTasks,
  async grade(task, submission, context) {
    if (task.kind === "single") return submission.answer === undefined ? { score: 0, reason: "Submission has no answer." } : exactMatch(task.expected ?? null, submission.answer);
    const state = await replay(new StarterEnvironment(), task, submission.toolLog ?? [], context.seed) as { finished?: boolean };
    return state.finished ? { score: 1, reason: "The trace finished the task." } : { score: 0, reason: "The trace did not finish the task." };
  },
  environment: () => new StarterEnvironment(),
  mockPolicies: {
    good: (task) => task.kind === "episode" ? [{ toolCalls: [{ name: "finish_task", args: {} }] }] : [],
    bad: (task) => task.kind === "episode" ? [{ content: "Skipped the tool." }] : [],
  },
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
