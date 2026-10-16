import { run as runBenchmark, type ModelAdapter, type RunOptions, type Trace } from "benchmark-core";
import { benchmark, benchmarkForTasksFile } from "./benchmark.js";
import { enrichReport } from "./report.js";
export { benchmark, benchmarkForTasksFile, loadTasksFile, resolveAllowedTasksPath, TASKS_ALLOW_ENV } from "./benchmark.js";
export { enrichReport, type SchemaMutationReport } from "./report.js";

export interface BenchmarkCallOptions extends RunOptions {
  // Alternate task file. A fresh benchmark object is built per call because
  // benchmark-core caches the task list inside the object (`loaded ??=`).
  tasks?: string;
}

export const run = async (adapter: ModelAdapter, options?: BenchmarkCallOptions) => {
  const { tasks, ...rest } = options ?? {};
  const bench = tasks === undefined ? benchmark : benchmarkForTasksFile(tasks);
  return enrichReport(await runBenchmark(bench, adapter, rest), await bench.listTasks());
};

export async function score(taskId: string, submission: Trace, options?: { tasks?: string }) {
  const bench = options?.tasks === undefined ? benchmark : benchmarkForTasksFile(options.tasks);
  const task = await bench.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return bench.score(task, submission);
}
