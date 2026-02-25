import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SignalVersionService } from './signal-version.service';
import { UpdateSignalDto, CopierApprovalDto } from './dto/update-signal.dto';

@Controller('signals')
export class SignalVersionController {
  constructor(private readonly versionService: SignalVersionService) {}

  @Patch(':signalId/update')
  @HttpCode(HttpStatus.OK)
  async updateSignal(
    @Param('signalId', ParseUUIDPipe) signalId: string,
    @Body() dto: UpdateSignalDto,
    @Req() req: any,
  ) {
    const providerId = req.user?.id;
    return this.versionService.updateSignal(signalId, providerId, dto);
  }

  @Get(':signalId/versions')
  async getVersionHistory(@Param('signalId', ParseUUIDPipe) signalId: string) {
    return this.versionService.getVersionHistory(signalId);
  }

  @Post('versions/:versionId/respond')
  @HttpCode(HttpStatus.OK)
  async respondToUpdate(
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: CopierApprovalDto,
    @Req() req: any,
  ) {
    const copierId = req.user?.id;
    return this.versionService.respondToUpdate(versionId, copierId, dto);
  }

  @Get('pending-approvals')
  async getPendingApprovals(@Req() req: any) {
    const copierId = req.user?.id;
    return this.versionService.getPendingApprovals(copierId);
  }

  @Get(':signalId/copied-version')
  async getCopiedVersion(
    @Param('signalId', ParseUUIDPipe) signalId: string,
    @Req() req: any,
  ) {
    const copierId = req.user?.id;
    const version = await this.versionService.getCopiedVersion(
      signalId,
      copierId,
    );
    return { signalId, copiedVersion: version };
  }
}
