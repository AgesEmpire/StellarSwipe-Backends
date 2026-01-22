import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StellarConfigService } from '../../config/stellar.service';
import { Trade, TradeSide } from '../entities/trade.entity';

export interface ExecutionResult {
  success: boolean;
  transactionHash?: string;
  executedPrice?: string;
  executedAmount?: string;
  feeAmount?: string;
  error?: string;
  contractId?: string;
}

export interface SorobanTransactionParams {
  sourceAccount: string;
  contractId: string;
  method: string;
  args: unknown[];
}

@Injectable()
export class TradeExecutorService {
  private readonly logger = new Logger(TradeExecutorService.name);
  private readonly executionTimeout: number;
  private readonly maxRetries: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly stellarConfig: StellarConfigService,
  ) {
    this.executionTimeout = this.configService.get<number>('trade.executionTimeout', 5000);
    this.maxRetries = this.stellarConfig.maxRetries;
  }

  async executeTrade(trade: Trade, walletAddress?: string): Promise<ExecutionResult> {
    this.logger.log(`Executing trade ${trade.id} for user ${trade.userId}`);

    const startTime = Date.now();

    try {
      // Validate execution parameters
      this.validateExecutionParams(trade);

      // Build and submit the Soroban transaction
      const result = await this.executeWithRetry(
        () => this.submitSorobanTransaction(trade, walletAddress),
        this.maxRetries,
      );

      const executionTime = Date.now() - startTime;
      this.logger.log(`Trade ${trade.id} executed in ${executionTime}ms`);

      if (executionTime > this.executionTimeout) {
        this.logger.warn(`Trade ${trade.id} execution exceeded timeout (${executionTime}ms > ${this.executionTimeout}ms)`);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown execution error';
      this.logger.error(`Trade ${trade.id} execution failed: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private validateExecutionParams(trade: Trade): void {
    if (!trade.entryPrice || parseFloat(trade.entryPrice) <= 0) {
      throw new Error('Invalid entry price');
    }

    if (!trade.amount || parseFloat(trade.amount) <= 0) {
      throw new Error('Invalid trade amount');
    }

    if (!trade.baseAsset || !trade.counterAsset) {
      throw new Error('Invalid asset pair');
    }
  }

  private async submitSorobanTransaction(
    trade: Trade,
    _walletAddress?: string,
  ): Promise<ExecutionResult> {
    // In production, this would interact with the Stellar/Soroban network
    // For now, we simulate the transaction execution

    const sorobanRpcUrl = this.stellarConfig.sorobanRpcUrl;
    const networkPassphrase = this.stellarConfig.networkPassphrase;

    this.logger.debug(`Submitting to Soroban RPC: ${sorobanRpcUrl}`);
    this.logger.debug(`Network: ${networkPassphrase}`);

    // Simulate network latency and processing
    await this.simulateNetworkDelay();

    // Generate mock transaction hash (in production, this comes from Stellar)
    const transactionHash = this.generateTransactionHash();

    // Calculate executed price with slippage simulation
    const executedPrice = this.calculateExecutedPrice(trade.entryPrice, trade.side);

    // Calculate fee
    const tradeValue = parseFloat(trade.amount) * parseFloat(executedPrice);
    const feePercentage = this.configService.get<number>('trade.baseFeePercentage', 0.1);
    const feeAmount = (tradeValue * feePercentage / 100).toFixed(8);

    return {
      success: true,
      transactionHash,
      executedPrice,
      executedAmount: trade.amount,
      feeAmount,
      contractId: this.configService.get<string>('stellar.tradeContractId', 'MOCK_CONTRACT_ID'),
    };
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`Execution attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);

        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Execution failed after retries');
  }

  private async simulateNetworkDelay(): Promise<void> {
    // Simulate realistic network latency (100-500ms)
    const delay = Math.random() * 400 + 100;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private generateTransactionHash(): string {
    // Generate a mock transaction hash (64 hex characters like Stellar)
    const chars = '0123456789abcdef';
    let hash = '';
    for (let i = 0; i < 64; i++) {
      hash += chars[Math.floor(Math.random() * chars.length)];
    }
    return hash;
  }

  private calculateExecutedPrice(entryPrice: string, side: TradeSide): string {
    const price = parseFloat(entryPrice);
    // Simulate small slippage (0-0.1%)
    const slippage = (Math.random() * 0.001) * (side === TradeSide.BUY ? 1 : -1);
    const executedPrice = price * (1 + slippage);
    return executedPrice.toFixed(8);
  }

  async closeTrade(trade: Trade, exitPrice: string): Promise<ExecutionResult> {
    this.logger.log(`Closing trade ${trade.id}`);

    try {
      // Submit closing transaction to Soroban
      await this.simulateNetworkDelay();

      const transactionHash = this.generateTransactionHash();
      const tradeValue = parseFloat(trade.amount) * parseFloat(exitPrice);
      const feePercentage = this.configService.get<number>('trade.baseFeePercentage', 0.1);
      const feeAmount = (tradeValue * feePercentage / 100).toFixed(8);

      return {
        success: true,
        transactionHash,
        executedPrice: exitPrice,
        executedAmount: trade.amount,
        feeAmount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown close error';
      this.logger.error(`Trade ${trade.id} close failed: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async getTransactionStatus(transactionHash: string): Promise<{
    status: 'pending' | 'success' | 'failed';
    confirmations?: number;
  }> {
    // In production, query Stellar/Soroban for transaction status
    this.logger.debug(`Checking status for transaction: ${transactionHash}`);

    // Mock: assume transaction is successful
    return {
      status: 'success',
      confirmations: 1,
    };
  }

  async estimateGasFee(_trade: Trade): Promise<string> {
    // In production, estimate actual Soroban transaction fee
    const baseFee = 100; // stroops
    const estimatedFee = baseFee * 1.5; // Add buffer
    return (estimatedFee / 10000000).toFixed(8); // Convert to XLM
  }
}
