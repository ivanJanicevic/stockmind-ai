import { supportedModels } from '@mozaik-ai/core';

// Several agents running at once can send more model calls per minute than the provider allows
// (Gemini free tier: 15 per minute). This makes every model call wait for a free slot in a sliding
// 60-second window, whichever agent sends it.

const patched = new WeakSet<object>();
const callTimes: number[] = [];
let queue: Promise<void> = Promise.resolve();
let limit = Number.POSITIVE_INFINITY;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function nextSlot(): Promise<void> {
  const slot = queue.then(async () => {
    for (;;) {
      const now = Date.now();
      while (callTimes.length > 0 && now - callTimes[0]! >= 60_000) callTimes.shift();
      if (callTimes.length < limit) {
        callTimes.push(now);
        return;
      }
      const waitMs = 60_000 - (now - callTimes[0]!) + 50;
      console.log(`[rate limit] ${limit} model calls per minute reached; waiting ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs);
    }
  });
  queue = slot.catch(() => {});
  return slot;
}

/** Allows at most `perMinute` model calls in any 60 seconds. Safe to call more than once. */
export function limitModelCalls(perMinute: number): void {
  limit = perMinute;
  for (const model of supportedModels) {
    const endpoint = model.endpoint as unknown as { infer: (input: unknown) => Promise<unknown> };
    if (patched.has(endpoint)) continue;
    patched.add(endpoint);
    const infer = endpoint.infer.bind(endpoint);
    endpoint.infer = async (input) => {
      await nextSlot();
      return infer(input);
    };
  }
}
