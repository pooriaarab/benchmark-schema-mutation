# Changelog

## Unreleased

### Fixed

- Hidden splits now generate into `.hidden/`, outside the npm `files` list, so `npm pack` can never ship the held-out set.
- An alternate JSONL task file now runs on every surface: `--tasks` on the CLI, `{ tasks }` on the SDK `run`/`score`, `?tasks=` on the API and a `tasks` argument on the MCP tools. Remote paths resolve inside the package `data/` directory or the `BENCHMARK_SCHEMA_MUTATION_TASKS_ALLOW` allow-list.
- MCP `run_benchmark` accepts `provider` (`openrouter`/`openai`/`mock`), `seed` and `tasks`, and its report carries `perMutationKind`, `staleSchemaUsedRate` and per-row `details` like the other surfaces.
- Requests print money with the exact decimals the call expects (`97.80`, not `97.8`), so every task is solvable from the visible prompt; the e2e gate proves it on public and hidden splits.

## 0.1.0

Initial alpha: 60 schema-mutation tasks, deterministic canonical-JSON grading, and CLI, SDK, API and MCP surfaces.
