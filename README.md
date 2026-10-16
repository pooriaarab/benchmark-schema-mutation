# benchmark-schema-mutation

[![npm](https://img.shields.io/npm/v/benchmark-schema-mutation)](https://www.npmjs.com/package/benchmark-schema-mutation) [![downloads](https://img.shields.io/npm/dm/benchmark-schema-mutation)](https://www.npmjs.com/package/benchmark-schema-mutation) [![license](https://img.shields.io/npm/l/benchmark-schema-mutation)](./LICENSE) [![types](https://img.shields.io/badge/TypeScript-types-3178c6)](#sdk)

[AI Benchmark Index](https://aibenchmarkindex.com/benchmarks/benchmark-schema-mutation) · [npm](https://www.npmjs.com/package/benchmark-schema-mutation) · [API](#http-api) · [MCP](#model-context-protocol)

APIs change under a model's feet. A field gets renamed, an enum gains new values, one endpoint splits into two — and the model has to decide between the schema in front of it and the one it memorized in training. benchmark-schema-mutation measures that choice: 60 tasks, each one a freshly migrated tool schema plus a user request, graded by exact match on the emitted JSON tool call.

```bash
npx benchmark-schema-mutation run --model offline --provider mock
```

```text
# Schema Mutation

- Model: `mock:1`
- Score: 50.0%
- 95% CI: 38.3%–61.7%
- Tasks: 60
```

The mock provider answers half the tasks correctly by design, so 50% is the expected baseline — it proves the wiring, not a model. No real-model runs are published yet; see "Run it on a real model".

## Install

Requires Node.js 20 or newer.

```bash
npm install benchmark-schema-mutation
```

## What a task looks like

Each prompt shows only the *current* schema — here `issues.create` migrated from v3.2.0, where `title` became `subject`:

```json
{"name": "issues.create",
 "parameters": {"required": ["repo", "subject", "kind", "visibility"],
  "properties": {"repo": "...", "subject": "...", "body": "...",
                 "labels": "...", "kind": {"enum": ["bug","feature","chore"]},
                 "visibility": {"enum": ["public","maintainers"]}}}}
```

The user request is ordinary: *"In acme/widgets open a feature issue titled 'Dark mode' ..."*. The correct answer calls `issues.create` with `subject`. A model that answers with `title` used the memorized schema — that call is stored on the task as the stale reference, and the grader flags it.

Five mutation kinds appear 12 times each:

| Kind | Example mutation | Stale answer gives |
| --- | --- | --- |
| `renamedField` | `title` -> `subject` | old field name |
| `newRequired` | required `severity` added | call without it |
| `enumChange` | `kind: [bug,feature,chore]` -> `[defect,enhancement,task]` | old enum value |
| `splitEndpoint` | `issues.create` -> `issues.create_public` / `issues.create_team` | old unsplit tool |
| `typeChange` | `amount` dollars -> integer cents | dollar value |

## How it is graded

Deterministic, no judge. The grader extracts the last `{"name","arguments"}` object from the answer (prose and code fences are tolerated), canonicalises it — object keys sorted recursively — and compares it to the canonical expected call:

- **1** — exact match on tool name and arguments.
- **0, `staleSchemaUsed`** — exact match against the pre-migration call.
- **0** — otherwise, with the first differing path in the reason.

`docs/grading.md` lists the ways this can go wrong — the failure modes were written before the grader, and `scripts/e2e.mjs` proves them: 60 canonical answers score 1, while empty, junk, replayed and stale answers all score 0.

## Run it on a real model

```bash
export OPENROUTER_API_KEY=...
npx benchmark-schema-mutation run --model anthropic/claude-sonnet-4 --provider openrouter
```

Any OpenAI-compatible endpoint works too, via `OPENAI_BASE_URL` and `OPENAI_API_KEY`. Reports carry a mean, a bootstrap 95% CI, per-task rows, and token cost. Each row also carries grader `details` (`mutationKind`, `staleSchemaUsed`), and the report carries the headline numbers directly: `perMutationKind` (tasks and passes per mutation kind) and `staleSchemaUsedRate` — the share of rows that used the old schema. The markdown report ends with the same breakdown.

There is no public leaderboard yet — no model runs have been published for this benchmark.

## Where the data comes from

Every task is synthetic, produced by the committed generator from 12 hand-authored base schemas resembling everyday SaaS tools. No third-party benchmark text is copied.

```bash
npm run generate:tasks                          # public split, seed 20261015
node scripts/gen-tasks.mjs --seed 7 --split hidden   # held-out split, not committed (writes .hidden/)
```

`data/PROVENANCE.md` records the licence (MIT), the hidden-split plan and the refresh cadence. Because the public split is committed, treat it as practice data; use a differently seeded hidden split for final comparisons.

## Prior art

The Berkeley Function-Calling Leaderboard (BFCL) measures function calling broadly; this benchmark isolates one failure mode — schema drift — with a deterministic canonical-JSON grader instead of AST checks or a judge, and it records the exact stale call so "used the memorized schema" is a measurable rate, not an anecdote.

## SDK

```ts
import { benchmark, run, score } from "benchmark-schema-mutation";
```

`run(adapter, options)` produces a report; `score(taskId, submission)` grades one trace.

## CLI

`list`, `show <task>`, `run`, `score`, `card`, `provenance`, `index-entry`, `serve`, `mcp`. Pass `--json` for machine-readable output. `card` writes a 1200×630 SVG share card.

## Model Context Protocol

```bash
npx benchmark-schema-mutation mcp
```

Tools: `list_tasks`, `get_task`, `score_answer`, `run_benchmark`, `get_provenance`. Only `run_benchmark` needs a key.

## HTTP API

Import `handler` from `benchmark-schema-mutation/api` (Node or Cloudflare Workers), or `npx benchmark-schema-mutation serve`. Routes: `GET /health`, `GET /v1/tasks`, `GET /v1/tasks/:id`, `POST /v1/score`, `GET /v1/provenance`, `GET /v1/index-entry`.

## Alternate task files

Every surface accepts a JSONL task file besides the shipped public split: `--tasks <path>` on any CLI command, `{ tasks: "<path>" }` on the SDK `run`/`score`, `?tasks=<path>` on API routes (or `"tasks"` in the `POST /v1/score` body), and a `tasks` argument on the MCP tools. Remote surfaces resolve bare names inside the package `data/` directory and anything else only when listed in `BENCHMARK_SCHEMA_MUTATION_TASKS_ALLOW` (colon-separated), so a held-out split stays opt-in.

## Limits and known weaknesses

- The mutation catalogue is authored, so the 60 tasks cover five kinds well but not every real-world migration (deprecation warnings, paginated renames, OAuth scope shifts).
- `staleSchemaUsed` fires only on an exact match with the recorded stale call; a half-adapted memorized answer is a lower-bound undercount.
- Prompts name a `schema_version` but do not show the old schema — a model that hallucinates *no* schema knowledge and one that perfectly memorizes the old version both land on the same stale call; the grader cannot distinguish intent.
- Array order matters in canonical comparison; schemas here never use unordered-set semantics.

## Status

Version 0.1.0 is alpha. Task shape and grading may change before 1.0. Report defects through the [issue tracker](https://github.com/pooriaarab/benchmark-schema-mutation/issues).

## License

[MIT](LICENSE) © Pooria Arab

## Cite

Please cite this package with its Zenodo DOI. The DOI below names all versions. GitHub also shows a "Cite this repository" box from `CITATION.cff`.

```bibtex
@software{arab2026benchmarkschemamutation,
  author  = {Arab, Pooria},
  title   = {benchmark-schema-mutation},
  year    = {2026},
  version = {0.1.0},
  doi     = {10.5281/zenodo.23422412},
  url     = {https://aibenchmarkindex.com/benchmarks/benchmark-schema-mutation}
}
```
