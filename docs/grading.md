# Grading design and failure modes

Written before the grader, per the fleet rule: state the ways it can fail first.

Each task asks for one JSON tool call: `{"name": "<tool>", "arguments": {...}}`.
The grader extracts that object from the raw answer, unwraps common wire
formats, normalises it, canonicalises it (object keys sorted recursively;
arrays keep order), and compares the result to the `expected` string stored
on the task after the same normalisation. A canonical match against
`metadata.stale` (the call that was correct under the pre-migration schema)
scores 0 and is flagged `staleSchemaUsed` in the reason and details.

Normalisation applies two equivalences on string values: parts of
comma-separated lists are trimmed (`"web, hero"` == `"web,hero"`), and
ISO-8601 durations are compared by length (`"PT0H45M"` == `"PT45M"`).
Unwrapping accepts the OpenAI tool-call wire format: an answer may be
`{"tool_calls": [{"name": ..., "arguments": ...}]}` or nest each call under
`function`, and `arguments` may be a JSON-encoded string. The last usable
call in a `tool_calls` array wins, matching the last-object-wins rule below.

## Ways the grader can fail

1. **Answer echoes the schema or another object.** A model may paste back the
   `{"tools": [...]}` block or wrap the call in prose. Mitigation: the
   extractor scans every top-level balanced `{...}` span, parses each, keeps
   the *last* object that carries a `name` key, and requires `arguments` to be
   an object when present. Residual risk: a model that prints two calls is
   graded on the last one — documented, not special-cased.
2. **Markdown fences or prose around the JSON.** Mitigation: the extractor
   never requires the whole answer to be JSON; it works on balanced spans, so
   ```json fences and leading text are harmless.
3. **Envelope drift.** `{"tool": "...", "args": {...}}`, a bare arguments
   object, or a bare array of calls must not pass. Only `name` (string) plus
   `arguments` (object or JSON-encoded object string, default `{}`) are read;
   `tool_calls` arrays and `function` wrappers are unwrapped because
   OpenAI-compatible adapters emit them, while other envelope keys are
   ignored rather than rejected. This keeps the contract "did you call the
   right tool with the right arguments" instead of "did you match our wire
   format". An answer with no usable `name` scores 0.
4. **Number representation and value forms.** `4550` vs `4550.0` vs
   `"4550"`. `JSON.parse` already folds the first two to the same double;
   canonicalisation re-serialises it, so they compare equal. `"4550"` as a
   string does **not** equal `4550` — that is a genuine type error under the
   schema and scores 0. Edge case: `-0` serialises as `0`; accepted, and
   harmless at our scale. Two further equivalences: whitespace inside a
   comma-separated string is dropped per part (`"a, b"` == `"a,b"`), and
   ISO-8601 durations with equal length compare equal (`"PT0H45M"` ==
   `"PT45M"`; only the W/D/H/M/S form is recognised — `"P1M"` month
   ambiguity is left strict).
5. **Key order and formatting.** Both sides go through the same
   canonicaliser, so object key order and whitespace never matter. Array
   order does matter (`labels: ["a","b"]` != `["b","a"]`) — ordered lists are
   ordered in the schema semantics, so this is intended, but it is a known
   strictness the benchmark accepts.
6. **Near-stale answers.** `staleSchemaUsed` only fires on an exact canonical
   match with the recorded stale call. A memorizer that half-adapts (new enum
   value but old field name) scores 0 with a plain mismatch reason, not the
   stale flag. The flag therefore undercounts stale behaviour; the e2e report
   treats it as a lower bound.
7. **Drift between generator and grader canonicalisation.** The generator
   (plain JS, `scripts/gen-tasks.mjs`) and the grader (TypeScript,
   `src/grader.ts`) each implement `canon`. If they diverge, every task breaks
   at once, which the e2e good-answers pass (all 60 canonical expected
   strings must score 1) catches immediately.
8. **Duplicate JSON keys in the answer.** `JSON.parse` keeps the last value;
   the schema for grading accepts that semantics. A pathological answer that
   relies on duplicate keys is handled deterministically.
9. **Unicode and escapes.** Canonicalisation emits `JSON.stringify` output;
   equivalent escape sequences (e.g. `é` vs `é`) normalise identically
   on both sides. No Unicode normalisation (NFC/NFKC) is applied — strings
   must match code-point for code-point, which is intentional strictness.
10. **Non-JSON answers.** Empty strings, apologies, refusal text, or tool
    calls written in Python/TypeScript syntax fail extraction and score 0
    with an "answer has no parseable {\"name\",\"arguments\"} object"
    reason.
11. **Non-string answers.** `submission.answer` is typed `string`, but the
    SDK surface (`score()`) accepts untyped JSON — `null`, numbers, objects.
    The grader type-checks before parsing and scores 0. (`POST /v1/score`
    already rejects non-string answers with a request error.)
12. **Pathological nesting.** A very deeply nested `arguments` value can
    exhaust the stack inside canonicalisation; it is caught and scores 0
    rather than crashing the scorer.

## What scores what

- `1` — canonical `{name, arguments}` equality with `expected`.
- `0` with `staleSchemaUsed` — canonical equality with `metadata.stale`.
- `0` with a diff reason — otherwise; the reason names the first differing
  path (`name`, `arguments.<field>` missing, unexpected, or value mismatch).

Per-mutation-kind breakdowns and the stale rate ride on every run report
(`perMutationKind`, `staleSchemaUsedRate`, and per-row `details`) on the
CLI, SDK, API and MCP surfaces. The e2e gate recomputes them independently
from `task.metadata.mutationKind` plus the row reasons and writes them to
`artifacts/e2e-report.json`.
