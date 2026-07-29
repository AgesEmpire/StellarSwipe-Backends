import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Trade, TradeStatus } from '../entities/trade.entity';
import { TxMonitorService } from '../services/tx-monitor.service';

@Injectable()
@Processor('transactions')
export class MonitorTransactionsJob implements OnModuleInit {
    private readonly logger = new Logger(MonitorTransactionsJob.name);

    constructor(
        @InjectQueue('transactions') private readonly transactionsQueue: Queue,
        @InjectRepository(Trade)
        private readonly tradeRepository: Repository<Trade>,
        private readonly txMonitorService: TxMonitorService,
    ) { }

    async onModuleInit() {
        // Register the repeatable job if not exists
        // We clean old repeatable jobs to ensure we don't have duplicates with different configs
        const jobs = await this.transactionsQueue.getRepeatableJobs();
        const jobExists = jobs.find(j => j.id === 'monitor-txs');

        if (!jobExists) {
            await this.transactionsQueue.add(
                'check-statuses',
                {},
                {
                    priority: 1, // CRITICAL — market order transaction monitoring
                    jobId: 'monitor-txs',
                    repeat: {
                        every: 5000, // 5 seconds
                    },
                    removeOnComplete: true,
                    removeOnFail: true,
                },
            );
            this.logger.log('Registered repeatable transaction monitoring job');
        }
    }

    @Process('check-statuses')
    async checkStatuses(_job: Job) {
        this.logger.debug('Starting transaction status check cycle');

        try {
            // Find all trades that need monitoring
            const pendingTrades = await this.tradeRepository.find({
                where: {
                    status: In([TradeStatus.PENDING, TradeStatus.CONFIRMED, TradeStatus.EXECUTING]),
                },
            });

            if (pendingTrades.length === 0) {
                this.logger.debug('No pending transactions to monitor');
                return;
            }

            this.logger.log(`Found ${pendingTrades.length} transactions to monitor`);

            // Process in parallel with concurrency limit if needed (simplified here)
            await Promise.all(
                pendingTrades.map(trade => this.txMonitorService.checkTradeStatus(trade))
            );

            this.logger.debug('Completed transaction status check cycle');
        } catch (error: any) {
            this.logger.error(`Error in transaction monitoring job: ${error.message}`, error.stack);
            throw error;
        }
    }
}
