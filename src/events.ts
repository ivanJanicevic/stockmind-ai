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

// The exact model.answer payload shape is not documented here, so take the
// first string field we recognise and fall back to JSON.
export function answerText(payload: unknown): string {
  if (typeof payload === 'string') return payload;

  if (payload && typeof payload === 'object') {
    for (const key of ['text', 'content', 'answer', 'message']) {
      const value = (payload as Record<string, unknown>)[key];
      if (typeof value === 'string') return value;
    }
  }

  return JSON.stringify(payload, null, 2);
}
