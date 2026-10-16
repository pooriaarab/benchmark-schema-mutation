import {
  createMcpServer as create, mockAdapter, openaiCompatAdapter, openrouterAdapter,
  run as runBenchmark, type Benchmark, type ModelAdapter, type Task,
} from "benchmark-core";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { benchmark, benchmarkForTasksFile, resolveAllowedTasksPath } from "./benchmark.js";
import { enrichReport } from "./report.js";

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

const result = (value: unknown, isError = false): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});
const fail = (value: unknown): CallToolResult => result(value, true);

const callArgs = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function pickAdapter(input: Record<string, unknown>): { adapter?: ModelAdapter; error?: CallToolResult } {
  const provider = input.provider === undefined ? "openrouter" : input.provider;
  if (provider === "mock") return { adapter: mockAdapter({ seed: typeof input.seed === "number" ? input.seed : 1 }) };
  if (provider === "openrouter") {
    if (!process.env.OPENROUTER_API_KEY) return { error: fail({ error: "OPENROUTER_API_KEY is required to run a benchmark." }) };
    return { adapter: openrouterAdapter({ model: input.model as string }) };
  }
  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL) return { error: fail({ error: "OPENAI_API_KEY or OPENAI_BASE_URL is required to run a benchmark." }) };
    return { adapter: openaiCompatAdapter({ model: input.model as string }) };
  }
  return { error: fail({ error: "provider must be openrouter, openai, or mock." }) };
}

// Resolves an optional `tasks` argument to a benchmark object; remote paths
// go through the same data/-or-allow-list rule as the HTTP surface.
function tasksTarget(tasks: unknown, fallback: Benchmark<Task>): { target?: Benchmark<Task>; error?: CallToolResult } {
  if (tasks === undefined) return { target: fallback };
  if (typeof tasks !== "string") return { error: fail({ error: "tasks must be a file path string." }) };
  const resolved = resolveAllowedTasksPath(tasks);
  return resolved === undefined ? { error: fail({ error: `tasks path not allowed: ${tasks}` }) } : { target: benchmarkForTasksFile(resolved) };
}

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
    const input = callArgs(request.params.arguments);
    if (request.params.name === "run_benchmark") {
      // Wrapped locally so the report carries perMutationKind and
      // staleSchemaUsedRate like the CLI, SDK and API; provider may be mock.
      if (typeof input.model !== "string") return fail({ error: "model is required." });
      const picked = pickAdapter(input);
      if (picked.adapter === undefined) return picked.error ?? fail({ error: "provider could not be resolved." });
      const { target, error } = tasksTarget(input.tasks, bench);
      if (target === undefined) return error ?? fail({ error: "tasks could not be resolved." });
      return result(enrichReport(await runBenchmark(target, picked.adapter), await target.listTasks()));
    }
    const tasks = input.tasks;
    if (tasks === undefined) return (await callDelegate(request, extra)) as CallToolResult;
    if (typeof tasks !== "string") return fail({ error: "tasks must be a file path string." });
    const resolved = resolveAllowedTasksPath(tasks);
    if (resolved === undefined) return fail({ error: `tasks path not allowed: ${tasks}` });
    return (await altHandler(resolved)(request, extra)) as CallToolResult;
  });
  server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const listed = (await listDelegate(request, extra)) as { tools?: Array<Record<string, unknown>> };
    const tasksProp = { type: "string", description: "Task file: a name inside the package data/ directory or a path in BENCHMARK_SCHEMA_MUTATION_TASKS_ALLOW." };
    const tools = (listed.tools ?? []).map((tool) => {
      if (!TASKS_TOOLS.has(tool.name as string)) return tool;
      const schema = tool.inputSchema as Record<string, unknown>;
      const properties = { ...(schema.properties as Record<string, unknown>), tasks: tasksProp };
      if (tool.name !== "run_benchmark") return { ...tool, inputSchema: { ...schema, properties } };
      return {
        ...tool,
        description: "Run every task through an OpenRouter, OpenAI-compatible or mock model.",
        inputSchema: {
          ...schema,
          properties: {
            ...properties,
            provider: { type: "string", enum: ["openrouter", "openai", "mock"], description: "Model provider; mock runs offline without keys." },
            seed: { type: "number", description: "Mock-provider seed." },
          },
        },
      };
    });
    return { ...listed, tools };
  });
  return server;
}

export const startMcp = async (bench: Benchmark<Task> = benchmark): Promise<void> => {
  await createMcpServer(bench).connect(new StdioServerTransport());
};
