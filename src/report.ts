import type { RunReport, RunRow, Task } from "benchmark-core";
import { gradeCall } from "./grader.js";

export interface GradeDetails {
  mutationKind: string;
  staleSchemaUsed: boolean;
}

export type EnrichedRow = RunRow & { details: GradeDetails };

export interface SchemaMutationReport extends Omit<RunReport, "rows"> {
  rows: EnrichedRow[];
  perMutationKind: Record<string, { tasks: number; passed: number }>;
  staleSchemaUsedRate: number;
}

function rowDetails(row: RunRow, task: Task | undefined): GradeDetails {
  const kind = typeof task?.metadata?.mutationKind === "string" ? task.metadata.mutationKind : "unknown";
  const graded = task !== undefined && typeof row.submission?.answer === "string"
    ? (gradeCall(task, row.submission.answer).details as GradeDetails | undefined)
    : undefined;
  return graded ?? { mutationKind: kind, staleSchemaUsed: row.reason.includes("staleSchemaUsed") };
}

export function enrichReport(report: RunReport, tasks: readonly Task[]): SchemaMutationReport {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const rows = report.rows.map((row) => ({ ...row, details: rowDetails(row, byId.get(row.taskId)) }));
  const perMutationKind: Record<string, { tasks: number; passed: number }> = {};
  let stale = 0;
  for (const row of rows) {
    const bucket = (perMutationKind[row.details.mutationKind] ??= { tasks: 0, passed: 0 });
    bucket.tasks += 1;
    bucket.passed += row.score === 1 ? 1 : 0;
    if (row.details.staleSchemaUsed) stale += 1;
  }
  return { ...report, rows, perMutationKind, staleSchemaUsedRate: rows.length === 0 ? 0 : stale / rows.length };
}
