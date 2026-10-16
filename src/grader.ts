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

export function extractCall(answer: string): Call | undefined {
  let found: Call | undefined;
  for (const span of objectSpans(answer)) {
    let value: unknown;
    try { value = JSON.parse(span); } catch { continue; }
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, JsonValue>;
    if (typeof record.name !== "string") continue;
    const args = record.arguments;
    if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) continue;
    found = { name: record.name, arguments: args ?? {} };
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
      if (canonize(got[key]!) !== canonize(expected[key]!)) return firstDiff(got[key]!, expected[key]!, `${path}.${key}`);
    }
    return `${path} differs`;
  }
  return `${path}: expected ${quote(expected)}, got ${quote(got)}`;
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
    normalized = canonize({ name: call.name, arguments: call.arguments });
  } catch {
    return { score: 0, reason: `[${kind}] answer is too deeply nested to normalise`, details };
  }
  if (normalized === task.expected) {
    return { score: 1, reason: `[${kind}] call matches the current schema`, details };
  }
  const stale = typeof task.metadata?.stale === "string" ? task.metadata.stale : undefined;
  if (stale !== undefined && normalized === stale) {
    return {
      score: 0,
      reason: `[${kind}] staleSchemaUsed: answer matches the pre-migration call`,
      details: { mutationKind: kind, staleSchemaUsed: true },
    };
  }
  let reason = `call does not match the current schema`;
  try {
    const expected = JSON.parse(task.expected as string) as Record<string, JsonValue>;
    reason = firstDiff({ name: call.name, arguments: call.arguments }, expected, "").replace(/^\./, "");
  } catch { /* expected is always canonical JSON; fall through to the generic reason */ }
  return { score: 0, reason: `[${kind}] ${reason}`, details };
}
