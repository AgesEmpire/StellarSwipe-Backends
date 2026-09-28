import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal, SignalStatus, SignalType } from '../entities/signal.entity';
import { CreateSignalDto } from '../dto';
import { StakeVerificationService } from '../../stake-verification/stake-verification.service';

export interface SignalSubmissionResult {
  success: boolean;
  signal?: Signal;
  errorCode?: 'STAKE_VERIFICATION_FAILED' | 'INVALID_PAYLOAD' | 'SUBMISSION_ERROR';
  errorMessage?: string;
}

// Minimum days until expiry a signal must have to be accepted
const MIN_EXPIRY_HOURS = 1;

@Injectable()
export class SignalSubmissionService {
  private readonly logger = new Logger(SignalSubmissionService.name);

  constructor(
    @InjectRepository(Signal)
    private readonly signalRepository: Repository<Signal>,
    private readonly stakeVerificationService: StakeVerificationService,
  ) {}

  /**
   * Full signal submission pipeline:
   *   1. Validate payload business rules
   *   2. Verify provider's on-chain stake via Soroban
   *   3. Persist and return the new Signal record
   *
   * Throws BadRequestException for invalid payloads and
   * ForbiddenException when stake verification fails.
   */
  async submitSignal(dto: CreateSignalDto): Promise<Signal> {
    this.validatePayload(dto);

    await this.verifyStake(dto.providerId);

    const signal = this.signalRepository.create({
      providerId: dto.providerId,
      baseAsset: dto.baseAsset,
      counterAsset: dto.counterAsset,
      type: dto.type,
      entryPrice: dto.entryPrice,
      targetPrice: dto.targetPrice,
      stopLossPrice: dto.stopLossPrice ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : this.defaultExpiry(),
      status: SignalStatus.ACTIVE,
    });

    const saved = await this.signalRepository.save(signal);
    this.logger.log(`Signal submitted: ${saved.id} by provider ${dto.providerId}`);
    return saved;
  }

  /**
   * Returns a safe result object instead of throwing, for use in queue/batch
   * contexts where exceptions should not propagate.
   */
  async trySubmitSignal(dto: CreateSignalDto): Promise<SignalSubmissionResult> {
    try {
      const signal = await this.submitSignal(dto);
      return { success: true, signal };
    } catch (err: any) {
      if (err instanceof ForbiddenException) {
        return { success: false, errorCode: 'STAKE_VERIFICATION_FAILED', errorMessage: err.message };
      }
      if (err instanceof BadRequestException) {
        return { success: false, errorCode: 'INVALID_PAYLOAD', errorMessage: err.message };
      }
      this.logger.error(`Signal submission error: ${err.message}`);
      return { success: false, errorCode: 'SUBMISSION_ERROR', errorMessage: err.message };
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private validatePayload(dto: CreateSignalDto): void {
    const entry  = parseFloat(dto.entryPrice);
    const target = parseFloat(dto.targetPrice);
    const stop   = dto.stopLossPrice ? parseFloat(dto.stopLossPrice) : null;

    if (entry <= 0)  throw new BadRequestException('entryPrice must be positive');
    if (target <= 0) throw new BadRequestException('targetPrice must be positive');

    if (dto.type === SignalType.BUY) {
      if (target <= entry) {
        throw new BadRequestException('For BUY signals, targetPrice must exceed entryPrice');
      }
      if (stop !== null && stop >= entry) {
        throw new BadRequestException('For BUY signals, stopLossPrice must be below entryPrice');
      }
    } else {
      if (target >= entry) {
        throw new BadRequestException('For SELL signals, targetPrice must be below entryPrice');
      }
      if (stop !== null && stop <= entry) {
        throw new BadRequestException('For SELL signals, stopLossPrice must be above entryPrice');
      }
    }

    if (dto.expiresAt) {
      const expiresAt = new Date(dto.expiresAt);
      const minExpiry = new Date(Date.now() + MIN_EXPIRY_HOURS * 60 * 60 * 1000);
      if (expiresAt <= minExpiry) {
        throw new BadRequestException(`expiresAt must be at least ${MIN_EXPIRY_HOURS}h in the future`);
      }
    }
  }

  private async verifyStake(providerId: string): Promise<void> {
    const result = await this.stakeVerificationService.verifyProviderStake({
      publicKey: providerId,
    });

    if (!result.verified) {
      this.logger.warn(`Stake verification failed for provider ${providerId}: ${result.message}`);
      throw new ForbiddenException(
        `Stake verification failed: ${result.message}. Minimum required: ${result.minimumRequired}`,
      );
    }
  }

  private defaultExpiry(): Date {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  }
}
