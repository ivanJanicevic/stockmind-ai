# Mozaik for the JigJoy Finance Hackathon

This guide explains the published hackathon requirements and the Mozaik components relevant to meeting them. It is intentionally independent of any particular product idea or agent roles.

## Short answer: Mozaik Cloud is not required

The [hackathon brief](https://build.jigjoy.ai/tracks/finance) requires projects to be built on Mozaik and to demonstrate multiple agents working together. It does **not** require Mozaik Cloud or Mozaik Network.

You can run a Mozaik application locally as a Node.js process. The runtime, participants, shared state, and event handling can all live in that process. The model provider may still be remote: this project's current configuration calls Gemini and needs a provider API key. “Runs locally” therefore means the application/runtime is local, not necessarily that model inference is offline.

Cloud is optional for account features or observing activity. Network is optional for communication between peers, including processes on different machines. Neither one is a substitute for implementing real collaboration among Mozaik runtime agents.

## What the hackathon requires

The official track says:

- Solve a finance or fintech task.
- Use at least two agents that work together.
- Build on Mozaik; one agent with many tools is not a multi-agent system.
- Demonstrate genuine concurrency, shared state, and checks between agents. Independent work should run at the same time rather than being disguised as a fixed sequential pipeline.
- Use synthetic or public data only. Do not use real customer data, real accounts, or move real money.
- Provide sources for every reported number. Do not invent unsupported figures.
- Include a “not financial advice” disclaimer where appropriate.
- Submit a public GitHub repository with a README explaining the project, architecture, and how to run it. A video is not required.

Scoring:

| Criterion | Points |
| --- | ---: |
| Usefulness: solves a finance problem | 30 |
| Multi-agent design on Mozaik: parallel agents, shared state, checks | 30 |
| Working system: runnable from the README | 25 |
| Financial-data care: sourced figures, no invented numbers | 15 |

The published submission deadline is midnight CET at the end of Friday, November 27, 2026. Resubmissions are allowed; the last submission counts.

## Mozaik components: do not confuse them

| Component | What it is | Needed for multiple local agents? |
| --- | --- | --- |
| **Mozaik Runtime** (`@mozaik-ai/core`) | An in-process runtime: participants, shared `RuntimeState`, semantic events, and agent loops. | This is the runtime API used by this project. |
| **Mozaik Agent** (`@jigjoy/mozaik-agent`) | An agent-loop package focused on breakpoints, inspection, pausing, resuming, and optional persistence. | Not required just to run multiple agents in one local runtime. |
| **Mozaik Network** (`@jigjoy/mozaik-network`) | A communication layer for peers that exchange messages across a network. | No. It is optional when agents already share one local runtime. |
| **Mozaik Cloud / Cloud SDK** | Account and hosted product features; pairing can enable Cloud-related observation. | No. The hackathon brief does not require it. |

There are two different meanings of “join”:

- Runtime `join(participant)` adds a Human or Agent to the local Mozaik Runtime.
- Network `join(peer, networkId, client)` connects a Network peer to a Mozaik Network.

Adding a Network peer does not register a local runtime participant in a Cloud agent panel. Likewise, adding a Cloud agent does not automatically make it a participant in a local runtime.

## Recommended local runtime pattern

The currently documented Runtime API uses `defineRuntime`, `RuntimeState`, `createAgent`, `join`, and `runLoop`:

1. Define a typed `RuntimeState` for the shared task and initialize the runtime once.
2. Create and join the participants that will work on that task.
3. Start independent agent loops without awaiting one result before starting the next. In this API, `runLoop` is fire-and-forget.
4. Have each agent publish its result through the runtime's event flow; handlers should filter on event type and producer.
5. Store results and status in shared state, then run deterministic checks and combine results.
6. Wait for all required work to finish before producing the final report or decision.

Conceptually:

```text
local input
    -> shared RuntimeState
    -> join runtime participants
    -> start independent runLoop calls concurrently
    -> collect result events into shared state
    -> validate and check conflicts
    -> final result for human review
```

The runtime is an event bus; participants react to events rather than polling. Shared `RuntimeState` does not mean every agent automatically has another agent's private model context: pass the data an agent needs into its loop input, and keep shared results in the application state.

Useful documentation:

- [Installation and provider keys](https://docs.jigjoy.ai/docs/installation)
- [Quickstart](https://docs.jigjoy.ai/docs/quickstart)
- [Runtime API](https://docs.jigjoy.ai/docs/runtime)
- [Participants](https://docs.jigjoy.ai/docs/participants)
- [Semantic events](https://docs.jigjoy.ai/docs/semantic-events)
- [Concurrent agents](https://docs.jigjoy.ai/docs/concurrent-agents)
- [Models and custom inference runners](https://docs.jigjoy.ai/docs/models)

## Local execution, Cloud, and model-provider costs

### Local execution

The application can run on a developer machine using Node.js and the Mozaik package. It does not need a Cloud deployment to create runtime participants, share local state, publish events, or run concurrent loops.

Local runtime state is normally in memory. If the process exits, its participants and connections stop. Persistence must be implemented separately if state or loops need to survive a restart.

### Cloud

The hackathon brief does not require Cloud. Pairing a machine with the Cloud SDK is optional and is for Cloud-related account/observation features; it does not, by itself, deploy local `createAgent()` objects as Cloud-managed agents. The project README describes pairing as optional loop telemetry:

```bash
npx @mozaik-ai/cloud-sdk pair
```

Use the Cloud Agents panel only if the goal is to create or manage Cloud-side agents. That is different from creating local runtime participants.

### Inference

The local runtime still needs an inference provider for model-backed loops. Provider keys are read from environment variables such as `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`. Keep them out of source control and never print them.

The current project uses Gemini. Running its real application command makes model calls and may use API quota or credits. Unit tests can be run separately without live model calls. A fully local model would require configuring a supported/custom inference runner; it is not what the current project does.

## When Mozaik Network is useful

Use Network when agents or people need to exchange messages as peers, particularly across separate processes or machines. A Network peer needs a policy that handles messages; an empty policy creates a connected participant that does not respond.

Network is not needed for agents inside the same local Mozaik Runtime to collaborate through shared state and runtime events. If Network is added, explicitly bridge its incoming messages to the runtime and send appropriate responses back. Keep the process alive while the peer must remain connected.

See the [Network introduction](https://docs.jigjoy.ai/network), [peer example](https://docs.jigjoy.ai/network/example), and [policy/decorator guide](https://docs.jigjoy.ai/network/decorators).

## Version and migration note

The Mozaik documentation home currently says the earlier Mozaik Runtime will be sunset, while the detailed Runtime pages still document `@mozaik-ai/core` and its concurrent-agent API. The separate [Mozaik Agent package](https://docs.jigjoy.ai/agent) focuses on persistable, inspectable loops; it is not the Cloud service or Network.

The hackathon brief does not specify a package version. Follow the event starter/template and mentor guidance. Do not migrate a working project to a different package solely to satisfy the Cloud or Network requirement—neither is required by the brief. If starting fresh, confirm the recommended package/version with the organizers because the published docs describe both APIs.

## Current project notes

- The application uses `@mozaik-ai/core` for its local Runtime, shared state, participants, events, and model loops.
- The Extractor and Auditor work concurrently; the Verifier is conditional on the results.
- `@jigjoy/mozaik-network` is optional and separate from the local Runtime.
- The current application uses Gemini for real inference, so a live run is not an offline/test-only run.
- Follow the repository README for this project's exact commands and environment variables.

## Submission checklist

- [ ] Public GitHub repository with a clear README and runnable instructions.
- [ ] At least two actual Mozaik runtime agents, not only Cloud records or Network peers.
- [ ] Independent loops start concurrently and share relevant task state/results.
- [ ] Checks and error handling run before final output.
- [ ] Every numeric claim has a source or a stated derivation.
- [ ] Synthetic/public data only; no real money movement.
- [ ] Appropriate financial disclaimer.
- [ ] No committed secrets.

## Sources

- [Hackathon track, scoring, and submission requirements](https://build.jigjoy.ai/tracks/finance)
- [Mozaik documentation home](https://docs.jigjoy.ai)
- [Mozaik Runtime quickstart](https://docs.jigjoy.ai/docs/quickstart)
- [Concurrent agents guide](https://docs.jigjoy.ai/docs/concurrent-agents)
- [Mozaik Agent introduction](https://docs.jigjoy.ai/agent)
- [Mozaik Network introduction](https://docs.jigjoy.ai/network)
