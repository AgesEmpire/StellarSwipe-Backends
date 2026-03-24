import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface KafkaMessage<T = unknown> {
  key: string;
  value: T;
  timestamp: Date;
  topic?: string;
}

export type MessageHandler<T = unknown> = (
  message: KafkaMessage<T>,
) => void | Promise<void>;

@Injectable()
export class KafkaService {
  private readonly logger = new Logger(KafkaService.name);
  private readonly emitter = new EventEmitter();
  private readonly consumerGroups = new Map<string, Set<string>>();

  emit<T = unknown>(topic: string, message: KafkaMessage<T>): void {
    this.logger.debug(`Producing message to topic: ${topic}`);
    this.emitter.emit(topic, { ...message, topic });
  }

  subscribe<T = unknown>(
    topic: string,
    groupId: string,
    handler: MessageHandler<T>,
  ): void {
    this.logger.debug(`Subscribing to topic: ${topic} (group: ${groupId})`);
    if (!this.consumerGroups.has(groupId)) {
      this.consumerGroups.set(groupId, new Set());
    }
    this.consumerGroups.get(groupId)!.add(topic);
    this.emitter.on(topic, handler as (...args: unknown[]) => void);
  }

  unsubscribe(topic: string, handler: MessageHandler): void {
    this.emitter.off(topic, handler as (...args: unknown[]) => void);
  }

  getConsumerGroups(): Map<string, Set<string>> {
    return this.consumerGroups;
  }

  getTopicSubscriberCount(topic: string): number {
    return this.emitter.listenerCount(topic);
  }
}
