import {
  ConditionContract,
  commandRegistry,
  conditionRegistry,
  inputResolverRegistry,
  type CommandContract,
  type InputResolverContract,
  type PolicyDefinition,
} from '@jigjoy/mozaik-rule-engine';

import { figuresAreSourced, type RetailEvidenceFacts } from './retail-parsing.js';
import type { RetailFinding, RetailTeamMessage } from './retail-prompts.js';

interface NetworkEnvelope {
  id: string;
  type: string;
  senderId: string;
  payload: unknown;
}

type MessageHandler = (
  message: RetailTeamMessage,
  senderId: string,
  envelopeId: string
) => void;

const CONDITION_ID = 'stockmind.team.message-sent';
const RESOLVER_ID = 'stockmind.team.message-input';
const COMMAND_ID = 'stockmind.team.receive-message';
let messageHandler: MessageHandler | undefined;
let activeDatasetKey = '';
let activeEvidenceFacts: RetailEvidenceFacts = new Map();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRole(value: unknown): value is RetailTeamMessage['role'] {
  return value === 'sales' || value === 'inventory' || value === 'finance' ||
    value === 'invoice_audit' || value === 'planner';
}

function isFinding(value: unknown, knownEvidence: ReadonlySet<string>): value is RetailFinding {
  return isRecord(value) &&
    typeof value.title === 'string' &&
    value.title.length <= 200 &&
    typeof value.detail === 'string' &&
    value.detail.length <= 800 &&
    Array.isArray(value.evidenceIds) &&
    value.evidenceIds.length > 0 &&
    value.evidenceIds.every((id) => typeof id === 'string' && knownEvidence.has(id));
}

export function parseRetailTeamMessage(
  text: string,
  datasetKey: string,
  evidenceFacts: RetailEvidenceFacts
): RetailTeamMessage | undefined {
  if (text.length > 16_000) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    !isRecord(value) ||
    value.protocol !== 'stockmind.team.v1' ||
    typeof value.messageId !== 'string' ||
    value.messageId.length > 100 ||
    typeof value.runId !== 'string' ||
    value.runId.length > 100 ||
    value.datasetKey !== datasetKey ||
    !isRole(value.role) ||
    value.status !== 'completed' ||
    typeof value.summary !== 'string' ||
    value.summary.length > 1000 ||
    !Array.isArray(value.findings) ||
    value.findings.length > 8
  ) {
    return undefined;
  }
  const findings = value.findings;
  const knownEvidence = new Set(evidenceFacts.keys());
  if (!findings.every((finding) => isFinding(finding, knownEvidence))) {
    return undefined;
  }
  for (const finding of findings) {
    const sources = finding.evidenceIds.flatMap((id) => {
      const facts = evidenceFacts.get(id);
      return facts ? [facts] : [];
    });
    if (!figuresAreSourced(finding.title, sources) || !figuresAreSourced(finding.detail, sources)) {
      return undefined;
    }
  }
  const parsed: RetailTeamMessage = {
    protocol: 'stockmind.team.v1',
    messageId: value.messageId,
    runId: value.runId,
    datasetKey: value.datasetKey,
    role: value.role,
    status: 'completed',
    summary: value.summary,
    findings,
  };
  const summarySources = [...new Set(findings.flatMap((finding) => finding.evidenceIds))]
    .flatMap((id) => {
      const facts = evidenceFacts.get(id);
      return facts ? [facts] : [];
    });
  if (!figuresAreSourced(parsed.summary, summarySources)) return undefined;
  return parsed;
}

export function setRetailNetworkMessageHandler(handler: MessageHandler): void {
  messageHandler = handler;
}

class IsNetworkMessage extends ConditionContract<unknown> {
  isSatisfiedBy(value: unknown): boolean {
    return isRecord(value) && value.type === 'message.sent' && isRecord(value.payload) &&
      typeof value.payload.message === 'string';
  }
}

const resolver: InputResolverContract<unknown, NetworkEnvelope> = {
  async resolve(value) {
    if (!isRecord(value) || typeof value.id !== 'string' ||
      typeof value.senderId !== 'string' || typeof value.type !== 'string' ||
      !('payload' in value)) {
      throw new Error('Network message envelope is malformed.');
    }
    return {
      id: value.id,
      type: value.type,
      senderId: value.senderId,
      payload: value.payload,
    };
  },
};

const command: CommandContract<NetworkEnvelope, void> = {
  invoke(envelope) {
    if (!isRecord(envelope.payload) || typeof envelope.payload.message !== 'string') {
      throw new Error('Network message payload is malformed.');
    }
    if (!messageHandler) {
      throw new Error('StockMind network message handler is not initialized.');
    }
    const parsed = parseRetailTeamMessage(envelope.payload.message, activeDatasetKey, activeEvidenceFacts);
    if (!parsed) {
      console.warn('[network] ignored a message that failed StockMind protocol validation.');
      return;
    }
    messageHandler(parsed, envelope.senderId, envelope.id);
  },
};

export function configureRetailNetwork(datasetKey: string, evidenceFacts: RetailEvidenceFacts): void {
  activeDatasetKey = datasetKey;
  activeEvidenceFacts = evidenceFacts;
}

conditionRegistry.register(CONDITION_ID, new IsNetworkMessage());
inputResolverRegistry.register(RESOLVER_ID, resolver);
commandRegistry.register(COMMAND_ID, command);

export const retailNetworkPolicy: PolicyDefinition = {
  rules: [{
    condition: CONDITION_ID,
    inputResolver: RESOLVER_ID,
    command: COMMAND_ID,
  }],
};
