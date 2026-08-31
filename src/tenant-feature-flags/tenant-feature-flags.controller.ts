import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TenantFeatureFlagsService } from './tenant-feature-flags.service';

/**
 * Read-only + refresh endpoints so flag state is observable and auditable
 * without redeploying. Guarded by the existing JWT auth strategy.
 */
@UseGuards(AuthGuard('jwt'))
@Controller('feature-flags/tenant')
export class TenantFeatureFlagsController {
  constructor(private readonly flagsService: TenantFeatureFlagsService) {}

  @Get()
  list() {
    return { flags: this.flagsService.listFlags() };
  }

  @Get(':key/evaluate')
  evaluate(@Param('key') key: string, @Query('tenantId') tenantId?: string) {
    return this.flagsService.evaluate(key, tenantId);
  }

  @Post('refresh')
  refresh() {
    this.flagsService.refresh();
    return { refreshed: true, flags: this.flagsService.listFlags().length };
  }
}
