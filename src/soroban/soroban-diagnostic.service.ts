import { Injectable, Logger } from '@nestjs/common';
import { xdr, scValToNative } from '@stellar/stellar-sdk';

export interface DiagnosticEvent {
  contractId?: string;
  topics: unknown[];
  data: unknown;
  type: string;
  timestamp: Date;
  correlationId?: string;
}

@Injectable()
export class SorobanDiagnosticService {
  private readonly logger = new Logger(SorobanDiagnosticService.name);

  parseDiagnosticEvents(
    events: Array<Record<string, unknown>>,
    correlationId?: string,
  ): DiagnosticEvent[] {
    const parsed: DiagnosticEvent[] = [];
    const now = new Date();

    for (const event of events) {
      try {
        const diagnostic: DiagnosticEvent = {
          type: String(event.type || 'unknown'),
          contractId:
            (event.contractId as string | undefined) ||
            (event.contract_id as string | undefined),
          topics: Array.isArray(event.topic || event.topics)
            ? (event.topic || event.topics).map((topic: unknown) =>
                this.parseScVal(topic),
              )
            : [],
          data: this.parseScVal(event.data || event.value),
          timestamp: now,
          correlationId,
        };
        parsed.push(diagnostic);
      } catch (error) {
        this.logger.warn(
          `Failed to parse diagnostic event: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { correlationId, event },
        );
      }
    }

    return parsed;
  }

  logDiagnosticEvents(
    events: DiagnosticEvent[],
    context: { contractId: string; method: string; txHash?: string },
  ): void {
    for (const event of events) {
      this.logger.log(
        `Soroban diagnostic event [${context.contractId}.${context.method}]` +
          (context.txHash ? ` tx:${context.txHash}` : '') +
          ` - type:${event.type}` +
          (event.contractId ? ` contract:${event.contractId}` : '') +
          ` topics:${JSON.stringify(event.topics)}` +
          ` data:${JSON.stringify(event.data)}`,
        { correlationId: event.correlationId },
      );
    }
  }

  private parseScVal(value: unknown): unknown {
    if (!value) {
      return undefined;
    }

    if (value instanceof xdr.ScVal) {
      return scValToNative(value);
    }

    if (typeof value === 'string') {
      try {
        return scValToNative(xdr.ScVal.fromXDR(value, 'base64'));
      } catch {
        return value;
      }
    }

    return value;
  }
}
