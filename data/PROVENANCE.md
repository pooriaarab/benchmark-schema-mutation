# Schema Mutation provenance

This file is generated from the benchmark definition.

## Seeded schema-mutation task generator

- Kind: `synthetic`
- URL: https://github.com/pooriaarab/benchmark-schema-mutation/blob/main/scripts/gen-tasks.mjs
- Licence: `MIT`
- Retrieved: 2026-10-16T00:00:00.000Z
- How to get it: Run `node scripts/gen-tasks.mjs` for the public split (seed 20261015) or `node scripts/gen-tasks.mjs --seed <n> --split hidden` for a held-out split.
- Contamination notes: All 60 public tasks are synthetic mutations of 12 hand-authored base tool schemas. The hidden split uses a different seed and is never committed, so public tasks may enter training data without leaking final evaluation items.
- Refresh: Change the seed, rerun the generator, and review the JSONL diff. Rotate mutation parameters quarterly.
