import { createMcpServer as create, type Benchmark, type Task } from "benchmark-core";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { benchmark, benchmarkForTasksFile, resolveAllowedTasksPath } from "./benchmark.js";

const CALL_METHOD = CallToolRequestSchema.shape.method.value;
const LIST_METHOD = ListToolsRequestSchema.shape.method.value;
const TASKS_TOOLS = new Set(["list_tasks", "get_task", "score_answer", "run_benchmark"]);

type RequestHandler = (request: unknown, extra: unknown) => Promise<unknown>;

// benchmark-core stores its installed request handlers on the server under
// `_requestHandlers`; there is no public accessor. Failing loudly here keeps
// an SDK internals change from silently dropping the wrapper below.
function installedHandler(server: Server, method: string): RequestHandler {
  const handlers: unknown = Reflect.get(server, "_requestHandlers");
  if (!(handlers instanceof Map)) throw new Error("MCP SDK internals changed: no _requestHandlers map.");
  const handler = handlers.get(method);
  if (typeof handler !== "function") throw new Error(`MCP SDK internals changed: no ${method} handler.`);
  return handler as RequestHandler;
}

const content = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  isError: true,
});

const callArgs = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

// A `tasks` argument switches a call to a fresh core server bound to the
// allow-listed file, so every tool keeps exactly its core behaviour.
export function createMcpServer(bench: Benchmark<Task> = benchmark): Server {
  const server = create(bench);
  const callDelegate = installedHandler(server, CALL_METHOD);
  const listDelegate = installedHandler(server, LIST_METHOD);
  const alternates = new Map<string, RequestHandler>();
  const altHandler = (path: string): RequestHandler => {
    let handler = alternates.get(path);
    if (handler === undefined) {
      handler = installedHandler(create(benchmarkForTasksFile(path)), CALL_METHOD);
      alternates.set(path, handler);
    }
    return handler;
  };
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tasks = callArgs(request.params.arguments).tasks;
    if (tasks === undefined) return (await callDelegate(request, extra)) as CallToolResult;
    if (typeof tasks !== "string") return content({ error: "tasks must be a file path string." });
    const resolved = resolveAllowedTasksPath(tasks);
    if (resolved === undefined) return content({ error: `tasks path not allowed: ${tasks}` });
    return (await altHandler(resolved)(request, extra)) as CallToolResult;
  });
  server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = (await listDelegate(request, extra)) as { tools?: Array<Record<string, unknown>> };
    const tasksProp = { type: "string", description: "Task file: a name inside the package data/ directory or a path in BENCHMARK_SCHEMA_MUTATION_TASKS_ALLOW." };
    const tools = (result.tools ?? []).map((tool) => {
      if (!TASKS_TOOLS.has(tool.name as string)) return tool;
      const schema = tool.inputSchema as Record<string, unknown>;
      return { ...tool, inputSchema: { ...schema, properties: { ...(schema.properties as Record<string, unknown>), tasks: tasksProp } } };
    });
    return { ...result, tools };
  });
  return server;
}

export const startMcp = async (bench: Benchmark<Task> = benchmark): Promise<void> => {
  await createMcpServer(bench).connect(new StdioServerTransport());
};
