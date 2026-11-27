import {
  SituationSpecification,
  type SituationContext,
} from '@mozaik-ai/core';

// Every agent trigger is scoped to a single producer. Reacting to "any message
// from someone else" lets agents answer each other forever and burn API credits.

export class WhenAnswerFrom extends SituationSpecification {
  constructor(private readonly producerId: string) {
    super();
  }

  isSatisfiedBy({ event }: SituationContext): boolean {
    return (
      event.type === 'model.answer' && event.producerId === this.producerId
    );
  }
}

export class WhenAnyAnswer extends SituationSpecification {
  isSatisfiedBy({ event }: SituationContext): boolean {
    return event.type === 'model.answer';
  }
}

export class WhenMessageSent extends SituationSpecification {
  isSatisfiedBy({ event }: SituationContext): boolean {
    return event.type === 'message.sent';
  }
}

// Carries tokenUsage for each model call.
export class WhenInferenceCompleted extends SituationSpecification {
  isSatisfiedBy({ event }: SituationContext): boolean {
    return event.type === 'inference.completed';
  }
}

const TEXT_KEYS = ['text', 'content', 'answer', 'message', 'output', 'parts', 'result', 'data'];

// Finds the model's text in a model.answer payload. Providers nest it
// differently (plain string, { text }, content: [{ type: 'text', text }], ...).
function findText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined;

  if (Array.isArray(value)) {
    const parts = value.map(findText).filter((t): t is string => t !== undefined);
    return parts.length ? parts.join('') : undefined;
  }

  if (value && typeof value === 'object') {
    for (const key of TEXT_KEYS) {
      const text = findText((value as Record<string, unknown>)[key]);
      if (text !== undefined) return text;
    }
  }

  return undefined;
}

export function answerText(payload: unknown): string {
  return findText(payload) ?? JSON.stringify(payload, null, 2);
}
