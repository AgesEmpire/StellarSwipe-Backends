import { Injectable, Logger } from '@nestjs/common';

export type TxWork = () => Promise<string>; // returns tx id on success

@Injectable()
export class TransactionRetryService {
  private readonly logger = new Logger(TransactionRetryService.name);

  async runWithRetry(work: TxWork, attempts = 3, baseBackoff = 500): Promise<{ success: boolean; txId?: string; error?: string; attempts: number }> {
    let attempt = 0;
    while (attempt < attempts) {
      attempt += 1;
      try {
        const txId = await work();
        this.logger.log(`Transaction succeeded on attempt ${attempt}: ${txId}`);
        return { success: true, txId, attempts: attempt };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Transaction attempt ${attempt} failed: ${msg}`);
        // Simple heuristic: treat network/timeouts as transient if message contains certain words
        const transient = /timeout|timed out|ECONNRESET|ETIMEDOUT|temporar/i.test(msg);
        if (attempt >= attempts || !transient) {
          this.logger.error(`Giving up after ${attempt} attempts: ${msg}`);
          return { success: false, error: msg, attempts: attempt };
        }
        const delay = baseBackoff * Math.pow(2, attempt - 1);
        this.logger.log(`Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    return { success: false, error: 'unknown', attempts };
  }
}
