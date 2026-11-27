// What every agent loop did, kept in memory so the app can show a live timeline: which agent,
// which loop, when it started and ended, every tool call and its result.

export type ActivityType = 'loop.started' | 'tool.started' | 'tool.completed' | 'loop.answered' | 'loop.failed' | 'note';

export interface ActivityEvent {
  seq: number;
  at: string;
  type: ActivityType;
  /** The agent's label, e.g. "Zalihe" or "Document agent (otpremnica-05-kafa.pdf)". */
  agent: string;
  /** The agent id: every run creates its own agent, so it identifies the loop. */
  loopId: string;
  /** What the loop was asked, for loop.started. */
  task?: string | undefined;
  tool?: string | undefined;
  detail?: string | undefined;
}

type Listener = (event: ActivityEvent) => void;

const events: ActivityEvent[] = [];
const listeners = new Set<Listener>();
let seq = 0;

export function recordActivity(event: Omit<ActivityEvent, 'seq' | 'at'>): void {
  const full: ActivityEvent = { ...event, seq: ++seq, at: new Date().toISOString() };
  events.push(full);
  if (events.length > 5000) events.shift();
  for (const listener of listeners) listener(full);
}

export function activitySince(afterSeq = 0): ActivityEvent[] {
  return events.filter((e) => e.seq > afterSeq);
}

export function onActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
