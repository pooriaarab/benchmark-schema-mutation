# Schema Mutation paper packet

Install with `npm ci`. Then run `sh paper/template/reproduce.sh` from the repository root.
The command builds the benchmark, runs scripted and simulated experiments, renders data,
builds the paper, and verifies the artifact. Requirements: Node 22 (matching repository CI), Python 3,
Tectonic, and Poppler (`pdfinfo`, `pdftotext`). Output: `paper/schema-mutation-paper.pdf`.
The PDF, downloaded style, build logs, and review images stay untracked.
The unchanged pilot template downloads the official NeurIPS style and checks its archive hash.

## Evidence
The plan commit precedes all result files. This is a local study plan, not external registration.
The runner executes eight scripted policies twice through the public SDK.
It extracts the existing prompt-only solver from the frozen E2E source without changing it.
Oracle and stale controls use answer metadata by design; the visible solver does not.
The simulated sweep uses 100 seeds, five adherence settings, and two control layers.
Raw simulation records preserve proposals, emitted answers, blocking, scores, and stale flags.
No model inference occurs. No provider availability or publication terms are claimed verified.

`data/summary.generated.json` drives the tables, figures, abstract, and metadata.
`data/verification.generated.json` records raw-output rescoring, repeat agreement, source
hashes, and PDF checks. `data/provenance.generated.json` records the source and plan commits.
The repeat hashes omit timing fields. No task is excluded. Repeats do not enlarge the task sample.
Wilson intervals describe hypothetical task sampling. Bootstrap intervals preserve tool-family
clusters for scripted contrasts and agent clusters for simulated rates. Boundary intervals collapse.
The simulated population chooses only current or obsolete calls. It is not a learned-model result.
The null completion effect of simulated blocking remains a null.

## Scope and license
The study measures final-call compatibility, not executed service effects or memory causes.
No human validation, fresh hidden split, learned-model leaderboard, or external review is claimed.
The main text follows PayBench's construct-first structure, with benchmark-specific metrics.
The family paper's schema-mutation description supplies the house definition.
The paper and figures use CC-BY-4.0. Existing benchmark code and data retain MIT.
The parent handles publication and merge decisions. This packet does neither.

Local CI fails with npm 12 because its pack JSON changes shape. Node 22 with npm 10
passes the existing pack check. No benchmark or test code was changed for this paper.
