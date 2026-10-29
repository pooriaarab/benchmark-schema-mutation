# Schema Mutation study plan

Written before study outputs. Source: 558460b9242c798f7ee538d878bd796a205331a7, package 0.1.0.
No study data collected. Existing generator, grader, and E2E policy were inspected.
The honesty pilot informs layout only. Git records this plan before results.
No external registration or publication is authorized; this is a local preregistration.

## Questions and hypotheses
H1: the existing prompt-only scripted solver passes every public task; empty,
constant-noop, refusal, prompt echo, and first-tool-empty controls fail every task.
H2: exact pre-migration calls fail every task and receive the stale diagnostic.
H3 (simulated): increasing adherence increases accuracy; blocking stale proposals
reduces emitted stale calls without improving completion. This is a mechanism
check under explicit assumptions, not an estimate of learned-model behavior.

## Design and measurements
Use the public SDK run and score paths on all 60 public tasks. Seven controls:
visible solver, oracle expected call, stale call, empty, noop, refuse, echo,
and first-tool with empty arguments (eight controls in total).
Oracle and stale controls intentionally access answer metadata; others do not.
Extract the unchanged visible solver from the existing E2E source into a VM.
Run every control twice; exclude timings from repeat hashes.
Measure exact current-call accuracy and exact stale-call rate with Wilson 95%
intervals across tasks. Report per-mutation counts. Never infer memory from a
stale match alone. Bootstrap paired accuracy differences by tool family, using
2,000 draws and seed 20261029; families keep their five mutation siblings.

Simulated sweep: adherence q in {0, .25, .5, .75, 1}; 100 agents with seeds
1 through 100; every agent attempts all public tasks. Generate one deterministic
uniform draw per seed/task and share it across q and control conditions.
Below q choose the current expected call, otherwise choose the stale call.
Compare pass-through with a current-schema shape validator that blocks invalid
proposals by emitting an empty answer. Validator checks names, required and extra
fields, types and enums; it never reads expected or stale metadata.
Measure proposal stale rate, emitted stale rate, blocking rate, accuracy, and
paired accuracy difference. Bootstrap agents as clusters (2,000 draws) for
simulated rate intervals. Report boundary collapse and separate task intervals.
No general claim of validator completeness; document residual accepted stale calls.

## Exclusions and stopping
No task exclusions. Malformed, empty, or refused outputs count as failures.
Infrastructure errors abort collection; do not silently score or drop them.
Stop after the fixed grid and repeat checks. No paid or hosted inference.
Free-only proxy is not configured for this study; provider availability is untested.
No human study, production deployment, or learned-model ranking is claimed.

## Failure checks and outputs
Before implementation: risks are oracle leakage into the visible solver, incorrect
pairing, stale rates confused with failures, validator checking answer keys,
repeat hashes retaining timings, generated text drifting from raw reports,
and artificially narrow intervals from treating related tasks as independent.
Save raw outputs, scores, diagnostics, hashes, source provenance, summary JSON,
three or more figures, and a repeatable verification JSON artifact.
Report all nulls. Record deviations here before affected data collection.
