import { run as runBenchmark, type ModelAdapter, type RunOptions, type Trace } from "benchmark-core";
import { benchmark } from "./benchmark.js";
import { enrichReport } from "./report.js";
export { benchmark };
export { enrichReport, type SchemaMutationReport } from "./report.js";
export const run = async (adapter: ModelAdapter, options?: RunOptions) =>
  enrichReport(await runBenchmark(benchmark, adapter, options), await benchmark.listTasks());
export async function score(taskId: string, submission: Trace) {
  const task = await benchmark.getTask(taskId); if (!task) throw new Error(`Task not found: ${taskId}`);
  return benchmark.score(task, submission);
}
