import type { JsonValue, Task, TaskScore } from "benchmark-core";

interface Call {
  name: JsonValue;
  arguments: JsonValue;
}

export function canonize(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonize(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const DURATION = /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

function normalizeValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, normalizeValue(v)]));
  }
  if (typeof value !== "string") return value;
  // ISO-8601 durations equal by length compare equal (PT45M == PT0H45M).
  const duration = DURATION.exec(value);
  if (duration && duration.slice(1).some((part) => part !== undefined)) {
    const parts = duration.slice(1).map((part) => (part === undefined ? 0 : Number(part)));
    const seconds = (parts[0] ?? 0) * 604800 + (parts[1] ?? 0) * 86400 + (parts[2] ?? 0) * 3600 + (parts[3] ?? 0) * 60 + (parts[4] ?? 0);
    return `PT${seconds}S`;
  }
  // Comma-separated lists ignore whitespace around items ("a, b" == "a,b").
  if (value.includes(",")) return value.split(",").map((part) => part.trim()).join(",");
  return value;
}

function* objectSpans(text: string): Generator<string> {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") { if (depth === 0) start = index; depth += 1; }
    else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) yield text.slice(start, index + 1);
      if (depth < 0) depth = 0;
    }
  }
}

function toCall(record: Record<string, JsonValue>): Call | undefined {
  if (typeof record.name === "string") {
    let args = record.arguments;
    // OpenAI-style wire format: arguments may arrive as a JSON string.
    if (typeof args === "string") {
      try { args = JSON.parse(args) as JsonValue; } catch { return undefined; }
    }
    if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) return undefined;
    return { name: record.name, arguments: args ?? {} };
  }
  const fn = record.function;
  if (fn !== null && typeof fn === "object" && !Array.isArray(fn)) return toCall(fn as Record<string, JsonValue>);
  const calls = record.tool_calls;
  if (Array.isArray(calls)) {
    let found: Call | undefined;
    for (const element of calls) {
      if (element === null || typeof element !== "object" || Array.isArray(element)) continue;
      const call = toCall(element as Record<string, JsonValue>);
      if (call !== undefined) found = call;
    }
    return found;
  }
  return undefined;
}

export function extractCall(answer: string): Call | undefined {
  let found: Call | undefined;
  for (const span of objectSpans(answer)) {
    let value: unknown;
    try { value = JSON.parse(span); } catch { continue; }
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const call = toCall(value as Record<string, JsonValue>);
    if (call !== undefined) found = call;
  }
  return found;
}

function quote(value: JsonValue): string {
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function firstDiff(got: JsonValue, expected: JsonValue, path: string): string {
  const isRecord = (v: JsonValue): v is Record<string, JsonValue> =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  if (isRecord(got) && isRecord(expected)) {
    for (const key of Object.keys(expected)) if (!(key in got)) return `${path}.${key} is missing`;
    for (const key of Object.keys(got)) if (!(key in expected)) return `${path}.${key} is unexpected`;
    for (const key of Object.keys(expected).sort()) {
      if (canonize(normalizeValue(got[key]!)) !== canonize(normalizeValue(expected[key]!))) return firstDiff(got[key]!, expected[key]!, `${path}.${key}`);
    }
    return `${path} differs`;
  }
  return `${path}: expected ${quote(expected)}, got ${quote(got)}`;
}

function normalizeCanon(text: string): string | undefined {
  try {
    return canonize(normalizeValue(JSON.parse(text) as JsonValue));
  } catch {
    return undefined;
  }
}

export function gradeCall(task: Task, answer: string | undefined): TaskScore {
  const kind = typeof task.metadata?.mutationKind === "string" ? task.metadata.mutationKind : "unknown";
  const details = { mutationKind: kind, staleSchemaUsed: false };
  if (typeof answer !== "string" || answer.trim() === "") {
    return { score: 0, reason: `[${kind}] no answer returned`, details };
  }
  const call = extractCall(answer);
  if (call === undefined) {
    return { score: 0, reason: `[${kind}] answer has no parseable {"name","arguments"} object`, details };
  }
  let normalized: string;
  try {
    normalized = canonize(normalizeValue({ name: call.name, arguments: call.arguments }));
  } catch {
    return { score: 0, reason: `[${kind}] answer is too deeply nested to normalise`, details };
  }
  const expected = typeof task.expected === "string" ? normalizeCanon(task.expected) : undefined;
  if (expected !== undefined && normalized === expected) {
    return { score: 1, reason: `[${kind}] call matches the current schema`, details };
  }
  const stale = typeof task.metadata?.stale === "string" ? normalizeCanon(task.metadata.stale) : undefined;
  if (stale !== undefined && normalized === stale) {
    return {
      score: 0,
      reason: `[${kind}] staleSchemaUsed: answer matches the pre-migration call`,
      details: { mutationKind: kind, staleSchemaUsed: true },
    };
  }
  let reason = `call does not match the current schema`;
  try {
    const expectedCall = JSON.parse(task.expected as string) as Record<string, JsonValue>;
    reason = firstDiff({ name: call.name, arguments: call.arguments }, expectedCall, "").replace(/^\./, "");
  } catch { /* expected is always canonical JSON; fall through to the generic reason */ }
  return { score: 0, reason: `[${kind}] ${reason}`, details };
}
