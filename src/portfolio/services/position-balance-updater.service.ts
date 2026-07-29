import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, OptimisticLockVersionMismatchError } from 'typeorm';
import { Position } from '../entities/position.entity';

export interface PositionBalanceUpdate {
  amount?: string;
  currentPrice?: string;
  unrealizedPnL?: string;
  isActive?: boolean;
}

const MAX_RETRIES = 3;

@Injectable()
export class PositionBalanceUpdaterService {
  private readonly logger = new Logger(PositionBalanceUpdaterService.name);

  constructor(
    @InjectRepository(Position)
    private readonly positionRepository: Repository<Position>,
  ) {}

  async updateBalance(
    positionId: string,
    updates: PositionBalanceUpdate,
  ): Promise<Position> {
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      attempt++;

      const position = await this.positionRepository.findOne({
        where: { id: positionId },
      });

      if (!position) {
        throw new NotFoundException(`Position ${positionId} not found`);
      }

      Object.assign(position, updates);

      try {
        return await this.positionRepository.save(position, {
          // TypeORM uses the entity's @VersionColumn value to build
          // a WHERE ... AND version = :v clause; if another writer
          // already incremented it the UPDATE matches 0 rows and
          // throws OptimisticLockVersionMismatchError.
        });
      } catch (err) {
        if (err instanceof OptimisticLockVersionMismatchError) {
          this.logger.warn(
            `Optimistic lock conflict on position ${positionId} (attempt ${attempt}/${MAX_RETRIES})`,
          );
          if (attempt >= MAX_RETRIES) {
            throw new ConflictException(
              `Could not update position ${positionId} after ${MAX_RETRIES} attempts due to concurrent modifications`,
            );
          }
          // Reload fresh data on next iteration
          continue;
        }
        throw err;
      }
    }

    // Unreachable — loop always returns or throws before exhausting retries
    throw new ConflictException(`Unexpected retry exhaustion for position ${positionId}`);
  }
}
