import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { KafkaService } from '../../streaming/kafka/kafka.service';
import { KafkaTopics } from '../../streaming/kafka/topics/kafka.topics';

/**
 * Health indicator for the message broker (Kafka).
 *
 * The current KafkaService is an in-process event bus (no external broker
 * connection yet), so "healthy" means the service can register and dispatch
 * a probe message end-to-end. Once a real Kafka client replaces the stub,
 * this check should be updated to verify broker connectivity instead.
 */
@Injectable()
export class KafkaHealthIndicator extends HealthIndicator {
  constructor(private readonly kafkaService: KafkaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    const probeTopic = `${Object.values(KafkaTopics)[0] ?? 'health-probe'}.__health__`;

    try {
      let received = false;
      const handler = () => {
        received = true;
      };

      this.kafkaService.subscribe(probeTopic, 'health-check', handler);
      this.kafkaService.emit(probeTopic, {
        key: 'health-check',
        value: { probe: true },
        timestamp: new Date(),
      });
      this.kafkaService.unsubscribe(probeTopic, handler);

      const latency = Date.now() - startTime;

      if (!received) {
        throw new Error('Broker did not deliver the probe message');
      }

      return this.getStatus(key, true, {
        status: 'connected',
        consumerGroups: this.kafkaService.getConsumerGroups().size,
        latency: `${latency}ms`,
      });
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      throw new HealthCheckError(
        'Message broker check failed',
        this.getStatus(key, false, {
          status: 'disconnected',
          error: errorMessage,
          latency: `${latency}ms`,
        }),
      );
    }
  }
}
