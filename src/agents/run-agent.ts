import { createHuman, type Agent } from '@mozaik-ai/core';

import { answerText, WhenEventFrom } from '../events.js';
import { join, runLoop } from '../runtime.js';

const short = (text: string, max = 300) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * Joins an agent to the runtime, runs one loop with the given task and resolves with its answer.
 * Every tool call and result is printed, prefixed with the agent's name, so several agents
 * running at the same time can be told apart.
 */
export function runAgent(agent: Agent, task: string, model: string, label: string): Promise<string> {
  return new Promise((resolve) => {
    const started = Date.now();
    const log = (line: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] [${label}] ${line}`);

    join(agent);
    const listener = createHuman({
      name: `Log of ${label}`,
      capabilities: [],
      handlers: [
        {
          specification: new WhenEventFrom(agent.getId(), ['function_call.started']),
          processor: {
            apply({ event }) {
              const call = (event.payload as { call?: { name?: string; args?: string } }).call;
              log(`-> ${call?.name}(${short(call?.args ?? '')})`);
            },
          },
        },
        {
          specification: new WhenEventFrom(agent.getId(), ['function_call.completed']),
          processor: {
            apply({ event }) {
              const text = (event.payload as { output?: { text?: string } }).output?.text ?? '';
              log(`<- ${short(text.split('\n')[0] ?? '')}`); // read_document: the first line is enough
            },
          },
        },
        {
          specification: new WhenEventFrom(agent.getId(), ['model.answer']),
          processor: {
            apply({ event }) {
              const answer = answerText(event.payload);
              log(`answered: ${short(answer)}`);
              resolve(answer);
            },
          },
        },
      ],
    });
    join(listener);

    runLoop(agent.getId(), task, {
      model,
      context: agent.getMemory().getContext(),
      tools: agent.getTools(),
    });
  });
}
