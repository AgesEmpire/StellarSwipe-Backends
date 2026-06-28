import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { Trade } from '../../trades/entities/trade.entity';
import { ArchivedPosition } from '../entities/archived-position.entity';
import { ExportFormat, ExportQueryDto } from '../dto/export-query.dto';
import * as fastcsv from 'fast-csv';
import * as fs from 'fs';
import * as path from 'path';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { RateLimitService } from '../../common/services/rate-limit.service';
import { NotificationService } from '../../common/services/notification.service';
import { User } from '../../users/entities/user.entity';
import { PositionArchiveService } from './position-archive.service';

interface PositionExportData {
  date: Date;
  asset: string;
  action: string;
  entryPrice: string;
  exitPrice: string | null;
  quantity: string;
  fees: string;
  profitLoss: string | null;
  status: string;
}

@Injectable()
@Processor('export-history')
export class ExportService {
    private readonly logger = new Logger(ExportService.name);
    private readonly EXPORT_DIR = path.join(process.cwd(), 'exports');
    private readonly SYNC_THRESHOLD = 1000;

    constructor(
        @InjectRepository(Trade)
        private tradeRepository: Repository<Trade>,
        @InjectRepository(ArchivedPosition)
        private archivedPositionRepository: Repository<ArchivedPosition>,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectQueue('export-history')
        private exportQueue: Queue,
        private rateLimitService: RateLimitService,
        private notificationService: NotificationService,
        private positionArchiveService: PositionArchiveService,
    ) {
        if (!fs.existsSync(this.EXPORT_DIR)) {
            fs.mkdirSync(this.EXPORT_DIR, { recursive: true });
        }
    }

    async exportTrades(userId: string, query: ExportQueryDto): Promise<{ status: string; url?: string; message?: string }> {
        await this.rateLimitService.checkRateLimit(userId);

        const where: any = { userId };
        const closedAtWhere: any = { userId };

        if (query.startDate && query.endDate) {
            where.createdAt = Between(new Date(query.startDate), new Date(query.endDate));
            closedAtWhere.closedAt = Between(new Date(query.startDate), new Date(query.endDate));
        } else if (query.startDate) {
            where.createdAt = MoreThanOrEqual(new Date(query.startDate));
            closedAtWhere.closedAt = MoreThanOrEqual(new Date(query.startDate));
        } else if (query.endDate) {
            where.createdAt = LessThanOrEqual(new Date(query.endDate));
            closedAtWhere.closedAt = LessThanOrEqual(new Date(query.endDate));
        }

        const [tradeCount, archivedCount] = await Promise.all([
            this.tradeRepository.count({ where }),
            this.archivedPositionRepository.count({ where: closedAtWhere }),
        ]);

        const total = tradeCount + archivedCount;

        if (total === 0) {
            return { status: 'empty', message: 'No trades found for the given criteria.' };
        }

        if (total > this.SYNC_THRESHOLD) {
            await this.exportQueue.add('generate-export', { userId, query, where });
            return { status: 'processing', message: 'Large export started. You will receive an email with the download link shortly.' };
        }

        const { fileName } = await this.generateFile(userId, query, where);
        await this.rateLimitService.incrementCount(userId);

        return { status: 'completed', url: `/exports/${fileName}` };
    }

    private async generateFile(userId: string, query: ExportQueryDto, where: any): Promise<{ filePath: string; fileName: string }> {
        const trades = await this.tradeRepository.find({
            where,
            order: { createdAt: 'DESC' },
        });

        const archivedPositions = await this.archivedPositionRepository.find({
            where: { userId },
            order: { closedAt: 'DESC' },
        });

        const allPositions = this.mergePositionData(trades, archivedPositions);

        const fileName = `position_history_${userId}_${Date.now()}.${query.format}`;
        const filePath = path.join(this.EXPORT_DIR, fileName);

        if (query.format === ExportFormat.CSV) {
            await this.generatePositionCsv(allPositions, filePath);
        } else {
            await this.generatePositionJson(allPositions, filePath);
        }

        return { filePath, fileName };
    }

    private mergePositionData(
        trades: Trade[],
        archivedPositions: ArchivedPosition[],
    ): PositionExportData[] {
        const tradeData: PositionExportData[] = trades.map((trade) => ({
            date: trade.createdAt,
            asset: `${trade.baseAsset}/${trade.counterAsset}`,
            action: trade.side,
            entryPrice: trade.entryPrice,
            exitPrice: trade.exitPrice,
            quantity: trade.amount,
            fees: trade.feeAmount,
            profitLoss: trade.profitLoss,
            status: trade.status,
        }));

        const archivedData: PositionExportData[] = archivedPositions.map((pos) => ({
            date: pos.archivedAt,
            asset: pos.baseAsset && pos.counterAsset ? `${pos.baseAsset}/${pos.counterAsset}` : 'N/A',
            action: pos.side || 'N/A',
            entryPrice: pos.entryPrice || '0',
            exitPrice: pos.exitPrice,
            quantity: pos.amount || '0',
            fees: '0',
            profitLoss: pos.realizedPnL,
            status: 'closed',
        }));

        return [...tradeData, ...archivedData].sort(
            (a, b) => b.date.getTime() - a.date.getTime(),
        );
    }

    private async generatePositionCsv(positions: PositionExportData[], filePath: string): Promise<void> {
        const csvStream = fastcsv.format({ headers: true });
        const writableStream = fs.createWriteStream(filePath);

        return new Promise((resolve, reject) => {
            csvStream.pipe(writableStream)
                .on('finish', resolve)
                .on('error', reject);

            positions.forEach((pos) => {
                csvStream.write({
                    Date: pos.date.toISOString(),
                    Asset: pos.asset,
                    Action: pos.action.toUpperCase(),
                    'Entry Price': pos.entryPrice,
                    'Exit Price': pos.exitPrice || 'N/A',
                    Quantity: pos.quantity,
                    Fees: pos.fees,
                    'P&L': pos.profitLoss || '0.00',
                    Status: pos.status,
                });
            });
            csvStream.end();
        });
    }

    private async generatePositionJson(positions: PositionExportData[], filePath: string): Promise<void> {
        fs.writeFileSync(filePath, JSON.stringify(positions, null, 2));
    }

    @Process('generate-export')
    async handleExportJob(job: Job<{ userId: string; query: ExportQueryDto; where: any }>) {
        const { userId, query, where } = job.data;
        this.logger.log(`Starting background export for user ${userId}`);

        try {
            const { fileName } = await this.generateFile(userId, query, where);
            await this.rateLimitService.incrementCount(userId);

            const user = await this.userRepository.findOne({ where: { id: userId } });
            if (user && user.email) {
                const downloadLink = `https://api.stellarswipe.com/exports/${fileName}`;
                await this.notificationService.sendEmail(
                    user.email,
                    'Your Position History Export is Ready',
                    `Hello ${user.username},\n\nYour position history export has been generated. You can download it using the link below:\n\n${downloadLink}\n\nThis link will expire in 24 hours.`,
                );
            }
        } catch (error: any) {
            this.logger.error(`Failed to generate export for user ${userId}`, error.stack);
            throw error;
        }
    }
}

