import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProviderWorkflowService } from './provider-workflow.service';
import { CreateProviderApplicationDto } from './dto/provider-application.dto';
import { ApprovalActionDto } from './dto/approval-action.dto';
import { ApplicationStatus } from './entities/provider-application.entity';

@Controller('providers/onboarding')
@UseGuards(JwtAuthGuard)
export class ProviderController {
  constructor(private readonly workflowService: ProviderWorkflowService) {}

  @Post()
  submitApplication(@Body() dto: CreateProviderApplicationDto) {
    return this.workflowService.submitApplication(dto);
  }

  @Get()
  listApplications(@Query('status') status?: ApplicationStatus) {
    return this.workflowService.listApplications(status);
  }

  @Get(':id')
  getApplication(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflowService.getApplication(id);
  }

  @Post('approve')
  processApproval(@Body() dto: ApprovalActionDto) {
    return this.workflowService.processApproval(dto);
  }
}
