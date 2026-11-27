# Hackathon Technical Requirements

This document summarizes the published requirements for the JigJoy Black Friday AI Hackathon and translates them into a technology-focused implementation checklist. It intentionally does not prescribe a product idea or agent roles.

## Official requirements

The [Agents in Finance track](https://build.jigjoy.ai/tracks/finance) states that:

- The project must solve a finance or fintech task.
- At least two agents must work together on the task.
- The project must be built on Mozaik. A single agent with many tools does not qualify as a multi-agent system.
- Synthetic or public data only: no real customer data, real accounts, or real money movement.
- Every reported number must have a source. Unsupported or invented numbers lose points.
- Outputs that could be taken as financial advice must say that they are not financial advice.
- Submit a public GitHub repository with a README describing what the project does, its architecture, and how to run it. A video is not required.
- The published deadline is midnight CET at the end of Friday, November 27, 2026. Resubmissions are allowed; the last submission counts.

The published scoring is:

| Criterion | Points |
| --- | ---: |
| Usefulness: solves a real finance problem | 30 |
| Multi-agent design on Mozaik: parallel agents, shared state, and checks between them | 30 |
| Working system: judges can run it from the README | 25 |
| Financial-data care: sources are shown and numbers are not invented | 15 |

The event page specifically says to expect weight on **genuine concurrency**: agents should actually work at the same time, not merely run one after another in a fixed pipeline.

## What genuine multi-agent work means

A strong technical demonstration should make all of the following observable:

1. **Multiple Mozaik agents are real participants in the runtime.** Creating records for agents in a dashboard or connecting Network peers alone is not enough.
2. **Independent work starts concurrently.** Launch independent agent loops without awaiting one completion before starting the next.
3. **Agents share task state.** Store task inputs, intermediate findings, completion status, errors, and validation results in shared runtime state.
4. **Agents coordinate through Mozaik events.** Event handlers should react to relevant results and update or validate shared state.
5. **Checks happen between agent work and final output.** Validate agent results and reject or flag malformed, unsupported, or conflicting claims.
6. **The final result can be traced.** Show which agent produced each finding, when it ran, which sources support its numbers, and which checks passed or failed.

Multiple agents called sequentially by application code, multiple idle agents, or multiple Network peers with no connection to the Mozaik runtime do not by themselves demonstrate parallel collaboration.

## Mozaik implementation pattern

Use the Mozaik runtime API documented for the project/starter version. In the currently documented runtime pattern, the main pieces are:

- `defineRuntime` and a `RuntimeState` subclass for the shared task state.
- `createAgent` for runtime participants and `join` to add them to the runtime.
- Event/situation handlers that react to results from relevant participants.
- `runLoop` to start independent work. It is fire-and-forget; starting one loop should not block launching other independent loops.

An implementation can follow this technology-level flow:

```text
Input
  -> shared RuntimeState
  -> join Mozaik participants
  -> start independent agent loops concurrently
  -> receive result events and update shared state
  -> run validation and conflict checks
  -> produce a traceable result for review
```

Keep event handlers scoped to relevant producers and event types. Record completion and errors explicitly so the application can tell when work is complete, partial, or invalid. Add guards against duplicate event handling and accidental agent loops.

See the [Mozaik quickstart](https://docs.jigjoy.ai/docs/quickstart) and [concurrent agents guide](https://docs.jigjoy.ai/docs/concurrent-agents) for the runtime concepts.

## Observability: Cloud and Network are different

- **Mozaik Cloud pairing/telemetry** can help inspect agent loops and runtime activity when configured. It is useful for development and demos, but the published hackathon requirements do not say that Cloud pairing is mandatory.
- **Mozaik Network** is a communication layer for peers that exchange messages. It is not the Mozaik runtime and does not automatically expose runtime loops. A Network peer is meaningful to the collaboration demo only when it is connected to actual work or messages.
- A local event timeline or simple UI can also make concurrency clear. At minimum, show participant/agent name, task or loop ID, start and completion times, status, result summary, checks, and source references.

Do not treat a list of connected peers as proof that agents collaborated. Show the runtime events and shared results that demonstrate it.

## Scoring-oriented engineering checklist

### Multi-agent design — 30 points

- [ ] At least two Mozaik agents perform distinct work on the same task.
- [ ] Independent loops start concurrently.
- [ ] Results are shared through runtime state and/or relevant Mozaik events.
- [ ] The code includes checks between agent work and before final output.
- [ ] The README and demo explain where parallel execution and coordination happen.

### Working system — 25 points

- [ ] A clean checkout can be installed and run using only the README instructions.
- [ ] Required environment variables are documented, and secrets are not committed.
- [ ] Synthetic/public fixtures are included so the project can be demonstrated repeatably.
- [ ] The app reports failures and partial results clearly.
- [ ] Tests cover important parsing, validation, and coordination behavior without requiring live model calls where practical.

### Financial-data care — 15 points

- [ ] Every numeric claim has a source reference or is clearly labeled as a derived calculation with its inputs/formula.
- [ ] Agent output is validated before it is included in the final result.
- [ ] Uncertainty, missing data, and conflicting evidence are surfaced instead of silently filled in.
- [ ] The required not-financial-advice disclaimer is visible in relevant output.
- [ ] No real customer data, account credentials, or real money movement is used.

### Usefulness — 30 points

- [ ] The README states the finance problem and the intended user clearly.
- [ ] The output supports a concrete decision or next step.
- [ ] The demo shows the system working on a representative, reproducible example.

## Submission checklist

- [ ] Public GitHub repository.
- [ ] README: problem, architecture, setup, run command, example output, and limitations.
- [ ] Architecture diagram or concise flow showing parallel loops, shared state, events, and checks.
- [ ] Clear source attribution and financial disclaimer.
- [ ] No secrets or real customer/account data in the repository.
- [ ] Verify the final run from the documented instructions before submission.

## Sources

- [Hackathon track and judging criteria](https://build.jigjoy.ai/tracks/finance)
- [Mozaik quickstart](https://docs.jigjoy.ai/docs/quickstart)
- [Mozaik concurrent agents](https://docs.jigjoy.ai/docs/concurrent-agents)
- [Mozaik Network introduction](https://docs.jigjoy.ai/network)
