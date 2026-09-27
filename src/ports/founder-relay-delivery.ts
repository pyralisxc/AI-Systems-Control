import type {
  ConversationThread,
  PrincipalId
} from "../domain/index.js";

export interface FounderRelayDeliveryInput {
  readonly relayId: string;
  readonly thread: ConversationThread;
  readonly text: string;
  readonly representedPrincipalId: PrincipalId;
}

export interface FounderRelayDeliveryResult {
  readonly deliveredAt: string;
  readonly deliveryRef?: string;
}

export interface FounderRelayDeliveryPort {
  canDeliver(thread: ConversationThread): boolean;

  /**
   * Implementations must be idempotent by relayId. A retry for the same relayId
   * must not create a duplicate owner-channel message.
   */
  deliver(
    input: FounderRelayDeliveryInput
  ): Promise<FounderRelayDeliveryResult>;
}
