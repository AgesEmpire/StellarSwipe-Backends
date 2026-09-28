import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RollbackRequest, RollbackStatus } from './entities/rollback-request.entity';
import { RollbackRequestDto, RollbackStatusDto } from './dto/rollback-request.dto';
import { isProtectedService, buildRollbackAuditEntry } from './utils/rollback-validator';

@Injectable()
export class RollbackProtectionService {
  private readonly logger = new Logger(RollbackProtectionService.name);

  constructor(
    @InjectRepository(RollbackRequest)
    private readonly rollbackRepo: Repository<RollbackRequest>,
  ) {}

  async requestRollback(userId: string, dto: RollbackRequestDto): Promise<RollbackStatusDto> {
    const isProtected = isProtectedService(dto.serviceName);
    const status = isProtected && !dto.forceOverride
      ? RollbackStatus.PENDING_APPROVAL
      : RollbackStatus.APPROVED;

    const entry = buildRollbackAuditEntry(dto.serviceName, userId, dto.reason);
    this.logger.log(`Rollback request: ${JSON.stringify(entry)}`);

    const request = this.rollbackRepo.create({
      serviceName: dto.serviceName,
      targetVersion: dto.targetVersion,
      reason: dto.reason,
      requestedBy: userId,
      status,
      isProtected,
    });

    const saved = await this.rollbackRepo.save(request);

    if (isProtected && !dto.forceOverride) {
      throw new ForbiddenException(
        `Rollback for protected service '${dto.serviceName}' requires explicit approval. Request ID: ${saved.id}`,
      );
    }

    return this.toStatusDto(saved);
  }

  async approveRollback(requestId: string, approverId: string): Promise<RollbackStatusDto> {
    const request = await this.rollbackRepo.findOne({ where: { id: requestId } });
    if (!request) throw new ForbiddenException('Rollback request not found');

    request.status = RollbackStatus.APPROVED;
    request.approvedBy = approverId;
    request.approvedAt = new Date();
    const saved = await this.rollbackRepo.save(request);

    this.logger.log(`Rollback approved by ${approverId} for request ${requestId}`);
    return this.toStatusDto(saved);
  }

  async listRequests(serviceName?: string): Promise<RollbackStatusDto[]> {
    const where = serviceName ? { serviceName } : {};
    const requests = await this.rollbackRepo.find({ where, order: { createdAt: 'DESC' } });
    return requests.map(this.toStatusDto);
  }

  private toStatusDto(r: RollbackRequest): RollbackStatusDto {
    return {
      requestId: r.id,
      serviceName: r.serviceName,
      status: r.status as any,
      reason: r.reason,
      createdAt: r.createdAt,
    };
  }
}
