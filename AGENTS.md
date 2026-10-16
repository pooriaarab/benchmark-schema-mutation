# Working on benchmark-schema-mutation

## Commands

- Install with `npm ci`.
- Run the full gate with `npm run ci:local`.
- Generate tasks with `npm run generate:tasks`; a held-out set comes from `node scripts/gen-tasks.mjs --seed <n> --split hidden` and is never committed.
- Generate provenance after building with `npm run provenance`.
- Add no unit tests. Extend `scripts/e2e.mjs` through a public surface.

## Contracts

Keep tasks, deterministic grading, and provenance in sync. Tasks are single-turn: each stores a canonical `expected` call and the stale pre-migration call in `metadata.stale`. `docs/grading.md` lists the grader's failure modes; update it before changing `src/grader.ts`.

Never read provider keys from repository files. OpenRouter uses `OPENROUTER_API_KEY`. OpenAI-compatible providers use `OPENAI_BASE_URL` and `OPENAI_API_KEY`.

Open an issue before a branch. Use `bsmu-<issue>-<slug>` and `[bsmu-<issue>] Imperative subject`. Keep pull requests below 500 counted lines. Do not merge your own pull request or push `release`.
