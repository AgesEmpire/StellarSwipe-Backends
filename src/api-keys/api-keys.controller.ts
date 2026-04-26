import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyResponseDto, ApiKeyUsageDto } from './dto/api-key-usage.dto';
import { Audit } from '../audit-log/interceptors/audit-logging.interceptor';
import { AuditAction } from '../audit-log/entities/audit-log.entity';
import { ExternalIntegrationThrottlerGuard } from '../common/guards/external-integration-throttler.guard';

@Controller('api-keys')
@UseGuards(ExternalIntegrationThrottlerGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @Audit({ action: AuditAction.API_KEY_CREATED, resource: 'api-key' })
  async create(
    @Request() req: any,
    @Body() dto: CreateApiKeyDto,
  ): Promise<ApiKeyResponseDto> {
    return this.apiKeysService.create(req.userId, dto);
  }

  @Get()
  async list(@Request() req: any) {
    return this.apiKeysService.list(req.userId);
  }

  @Get('usage')
  async getUsage(@Request() req: any): Promise<ApiKeyUsageDto[]> {
    return this.apiKeysService.getUsage(req.userId);
  }

  @Post(':id/rotate')
  @Audit({ action: AuditAction.API_KEY_ROTATED, resource: 'api-key', getResourceId: (req) => req.params.id })
  async rotate(
    @Request() req: any,
    @Param('id') id: string,
  ): Promise<ApiKeyResponseDto> {
    return this.apiKeysService.rotate(req.userId, id);
  }

  @Delete(':id')
  @Audit({ action: AuditAction.API_KEY_REVOKED, resource: 'api-key', getResourceId: (req) => req.params.id })
  async revoke(@Request() req: any, @Param('id') id: string): Promise<void> {
    return this.apiKeysService.revoke(req.userId, id);
  }
}
