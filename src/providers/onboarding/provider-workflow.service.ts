import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProviderApplication, ApplicationStatus } from './entities/provider-application.entity';
import { ProviderApproval } from './entities/provider-approval.entity';
import { CreateProviderApplicationDto } from './dto/provider-application.dto';
import { ApprovalActionDto } from './dto/approval-action.dto';

@Injectable()
export class ProviderWorkflowService {
  private readonly logger = new Logger(ProviderWorkflowService.name);

  constructor(
    @InjectRepository(ProviderApplication)
    private readonly appRepo: Repository<ProviderApplication>,
    @InjectRepository(ProviderApproval)
    private readonly approvalRepo: Repository<ProviderApproval>,
  ) {}

  async submitApplication(
    dto: CreateProviderApplicationDto,
  ): Promise<ProviderApplication> {
    const application = this.appRepo.create({
      ...dto,
      status: ApplicationStatus.PENDING,
    });
    const saved = await this.appRepo.save(application);
    this.logger.log(`Provider application submitted: ${saved.id} by ${dto.providerId}`);
    return saved;
  }

  async getApplication(id: string): Promise<ProviderApplication> {
    const application = await this.appRepo.findOne({ where: { id } });
    if (!application) {
      throw new NotFoundException(`Provider application ${id} not found`);
    }
    return application;
  }

  async listApplications(status?: ApplicationStatus): Promise<ProviderApplication[]> {
    const where = status ? { status } : {};
    return this.appRepo.find({ where, order: { submittedAt: 'DESC' } });
  }

  async processApproval(
    dto: ApprovalActionDto,
  ): Promise<{ application: ProviderApplication; approval: ProviderApproval }> {
    const application = await this.getApplication(dto.applicationId);

    application.status =
      dto.action === 'approve' ? ApplicationStatus.APPROVED : ApplicationStatus.REJECTED;
    const updatedApplication = await this.appRepo.save(application);

    const approval = await this.approvalRepo.save(
      this.approvalRepo.create({
        applicationId: dto.applicationId,
        action: dto.action,
        adminId: dto.adminId,
        notes: dto.notes,
      }),
    );

    if (dto.action === 'approve') {
      this.logger.log(
        `Provider ${application.providerId} approved — publish permission granted`,
      );
    } else {
      this.logger.log(`Provider application ${dto.applicationId} rejected by admin ${dto.adminId}`);
    }

    return { application: updatedApplication, approval };
  }
}
