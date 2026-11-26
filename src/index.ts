
import 'dotenv/config';

import {
  defineRuntime,
  RuntimeState,
  createAgent,
  createHuman,
  SituationSpecification,
  Agent,
  type SituationHandler,
  type SituationContext,
} from '@mozaik-ai/core';

// 1. Runtime state
class AppState extends RuntimeState {}

// 2. Initialize Mozaik runtime
const {
  initializeRuntime,
  join,
  sendMessage,
  runLoop,
} = defineRuntime<AppState>();

initializeRuntime({
  state: new AppState(),
});

// 3. Define when agents should react
class WhenOthersSendAMessage
  extends SituationSpecification {

  isSatisfiedBy({
    event,
    participant,
  }: SituationContext): boolean {
    return (
      event.type === 'message.sent' &&
      event.producerId !== participant.getId()
    );
  }
}

// 4. Shared handler for both agents
const agentHandler: SituationHandler = {
  specification: new WhenOthersSendAMessage(),

  processor: {
    apply({ event, participant }) {
      if (!(participant instanceof Agent)) return;

      const { message } = event.payload as {
        message: string;
      };

      console.log(
        `\n[Agent ID: ${participant.getId()}] Received: ${message}`
      );

      runLoop(participant.getId(), message, {
        model: 'gemini-3.5-flash',
        context: participant.getMemory().getContext(),
        tools: participant.getTools(),
      });
    },
  },
};

// 5. Create first agent
const analyst = createAgent({
  name: 'Analyst',
  capabilities: ['inference'],
  instruction: `
    You are a business analyst.
    Analyze the user's message.
    Give a concise and useful answer.
  `,
  tools: [],
  handlers: [agentHandler],
});

// 6. Create second agent
const reviewer = createAgent({
  name: 'Reviewer',
  capabilities: ['inference'],
  instruction: `
    You are a critical reviewer.
    Evaluate the user's request independently.
    Give a different perspective and useful suggestions.
  `,
  tools: [],
  handlers: [agentHandler],
});

// 7. Create monitoring participant
class WhenAgentAnswers extends SituationSpecification {
  isSatisfiedBy({ event }: SituationContext): boolean {
    return event.type === 'model.answer';
  }
}

const monitoringHandler: SituationHandler = {
  specification: new WhenAgentAnswers(),

  processor: {
    apply({ event }) {
      console.log('\n========== AGENT RESPONSE ==========');
      console.log('Agent ID:', event.producerId);
      console.log(
        'Response:',
        JSON.stringify(event.payload, null, 2)
      );
      console.log('====================================\n');
    },
  },
};

const monitor = createHuman({
  name: 'Monitoring',
  capabilities: [],
  handlers: [monitoringHandler],
});

// 8. Join participants to runtime
join(analyst);
join(reviewer);
join(monitor);

// 9. Send initial message
const user = createHuman({
  name: 'User',
  capabilities: [],
  handlers: [],
});

join(user);

console.log('Mozaik runtime initialized!');
console.log('Agents: Analyst, Reviewer');
console.log('Monitoring: Active');

// 10. Start the test
sendMessage(
  'Analyze a small grocery store. How can we reduce food waste and improve inventory management?',
  user.getId()
);
