import { join, leave, sendMessage } from '@jigjoy/mozaik-network';
import type { Envelope } from '@jigjoy/mozaik-network/envelope';
import { HOSTED_NETWORK, readInviteLink } from '@jigjoy/mozaik-network/invite-link';
import { NetworkClient } from '@jigjoy/mozaik-network/network-client';
import type { Peer } from '@jigjoy/mozaik-network/peer';
import {
  ConditionContract,
  commandRegistry,
  conditionRegistry,
  inputResolverRegistry,
  type PolicyDefinition,
  type RuleDefinition,
} from '@jigjoy/mozaik-rule-engine';

/** What the network says about a peer in peer.joined and peer.welcomed. */
export interface PeerInfo {
  id: string;
  name: string;
  role?: string;
}

export type MessageSent = Envelope<{ message: string; senderName?: string; to?: string }>;
export type PeerWelcomed = Envelope<{
  network: { id: string; name: string };
  peers: PeerInfo[];
  messages: Envelope<{ message?: string; senderName?: string }>[];
}>;

export interface NetworkSession {
  peer: Peer;
  networkId: string;
  /** Sends to everyone, or with `to` to one peer only (such messages are not kept by the network). */
  send(message: string, to?: string): Promise<void>;
  leave(): Promise<void>;
}

/** Joins the network named by MOZAIK_INVITE in .env. Resolves once the network has welcomed the peer. */
export async function connectPeer(options: {
  name: string;
  role: 'agent' | 'user';
  policy: PolicyDefinition;
}): Promise<NetworkSession> {
  const link = readInviteLink(process.env.MOZAIK_INVITE?.trim() ?? '', HOSTED_NETWORK);
  if (!link) {
    throw new Error('MOZAIK_INVITE in .env is not an invite link. Check it: npx tsx scripts/check-network-invite.ts');
  }
  const client = new NetworkClient({ origin: link.origin });
  const peer = await client.createPeer({
    name: options.name,
    role: options.role,
    capabilities: ['message'],
    invite: link.invite,
    policy: options.policy,
  });
  const networkId = peer.invitedTo;
  if (!networkId) throw new Error(`The network did not say which network peer "${options.name}" belongs to.`);

  await join(peer, networkId, client);
  return {
    peer,
    networkId,
    send: (message, to) => sendMessage(peer, networkId, message, to),
    leave: () => leave(peer, networkId),
  };
}

class EnvelopeCondition extends ConditionContract<Envelope<unknown>> {
  constructor(private readonly test: (envelope: Envelope<any>) => boolean) {
    super();
  }

  isSatisfiedBy(envelope: Envelope<unknown>): boolean {
    return this.test(envelope);
  }
}

/**
 * One rule of a peer's policy: when `when` holds for an envelope, `then` runs with it.
 * Registers the condition, input resolver and command under `${name}.*`, which is what the
 * @Condition / @InputResolver / @Command decorators do, but lets them use local variables.
 * The rule with the smallest priority among those whose condition holds is the one that runs.
 */
export function rule<T extends Envelope<any>>(
  name: string,
  priority: number,
  when: (envelope: Envelope<any>) => boolean,
  then: (envelope: T) => Promise<void> | void,
): RuleDefinition {
  conditionRegistry.register(`${name}.condition`, new EnvelopeCondition(when));
  inputResolverRegistry.register(`${name}.input`, { resolve: async (envelope: unknown) => envelope });
  commandRegistry.register(`${name}.command`, {
    invoke: async (envelope: T) => {
      try {
        await then(envelope);
      } catch (error) {
        console.error(`[network] rule ${name} failed:`, error instanceof Error ? error.message : error);
      }
    },
  });
  return { condition: `${name}.condition`, inputResolver: `${name}.input`, command: `${name}.command`, priority };
}

/** Keeps track of who is in the network, so a message's sender can be checked by role. */
export class PeerDirectory {
  private readonly peers = new Map<string, PeerInfo>();

  static readonly ENVELOPES = ['peer.welcomed', 'peer.joined', 'peer.left'];

  observe(envelope: Envelope<any>): void {
    if (envelope.type === 'peer.welcomed') {
      for (const peer of (envelope as PeerWelcomed).payload.peers) this.peers.set(peer.id, peer);
    } else if (envelope.type === 'peer.joined') {
      const peer = envelope.payload as PeerInfo;
      this.peers.set(peer.id, peer);
    } else if (envelope.type === 'peer.left') {
      this.peers.delete((envelope.payload as { peerId: string }).peerId);
    }
  }

  get(id: string): PeerInfo | undefined {
    return this.peers.get(id);
  }
}
