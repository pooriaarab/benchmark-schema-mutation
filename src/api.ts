import { existsSync } from "node:fs";
import { createHandler, type Benchmark, type Task } from "benchmark-core";
import { benchmark, benchmarkForTasksFile, resolveAllowedTasksPath } from "./benchmark.js";

const notAllowed = () =>
  new Response(
    JSON.stringify({
      error: {
        code: "TASKS_NOT_ALLOWED",
        message:
          "The requested tasks file is not inside the package data/ directory and is not listed in BENCHMARK_SCHEMA_MUTATION_TASKS_ALLOW.",
      },
    }),
    { status: 403, headers: { "content-type": "application/json" } },
  );

// The task file may be selected with a `?tasks=<path>` query parameter on the
// GET routes or a `"tasks"` field in the POST /v1/score body. The path must
// resolve inside the package data/ directory or appear in the allow-list env
// var; anything else is a 403 rather than a silent fall-back to the default.
async function requestedTasksPath(request: Request): Promise<string | undefined> {
  const query = new URL(request.url).searchParams.get("tasks");
  if (query !== null) return query;
  if (request.method !== "POST") return undefined;
  try {
    const payload: unknown = await request.clone().json();
    const tasks = payload !== null && typeof payload === "object" ? Reflect.get(payload, "tasks") : undefined;
    return typeof tasks === "string" ? tasks : undefined;
  } catch {
    return undefined;
  }
}

export function createApiHandler(bench: Benchmark<Task> = benchmark): (request: Request) => Promise<Response> {
  const base = createHandler(bench);
  const alternates = new Map<string, (request: Request) => Promise<Response>>();
  return async (request: Request): Promise<Response> => {
    const tasksPath = await requestedTasksPath(request);
    if (tasksPath === undefined) return base(request);
    const resolved = resolveAllowedTasksPath(tasksPath);
    if (resolved === undefined) return notAllowed();
    let handler = alternates.get(resolved);
    if (handler === undefined) {
      handler = createHandler(benchmarkForTasksFile(resolved));
      // Bare names resolve inside data/ without an allow-list, so cache only
      // when the file exists; otherwise the map grows one entry per request.
      if (existsSync(resolved)) alternates.set(resolved, handler);
    }
    return handler(request);
  };
}

export const handler = createApiHandler();
