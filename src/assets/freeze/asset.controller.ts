import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../../admin/guards/admin-role.guard';
import { AssetFreezeService } from './asset-freeze.service';
import { FreezeAssetDto, UnfreezeAssetDto } from './dto/freeze-asset.dto';
import { AssetFreezeCheckDto, AssetFreezeStatusDto } from './dto/asset-freeze-status.dto';

@ApiTags('asset-freeze')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRoleGuard)
@Controller('assets/freeze')
export class AssetController {
  constructor(private readonly assetFreezeService: AssetFreezeService) {}

  /**
   * POST /assets/freeze
   * Freeze an asset to prevent transfers and trading.
   * Requires admin privileges.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Freeze an asset (admin only)' })
  @ApiResponse({ status: 201, description: 'Asset frozen successfully', type: AssetFreezeStatusDto })
  @ApiResponse({ status: 400, description: 'Asset is already frozen' })
  @ApiResponse({ status: 403, description: 'Admin privileges required' })
  async freezeAsset(
    @Body() dto: FreezeAssetDto,
    @Request() req: any,
  ): Promise<AssetFreezeStatusDto> {
    return this.assetFreezeService.freezeAsset(dto, req.user.id);
  }

  /**
   * POST /assets/freeze/unfreeze
   * Lift a freeze on an asset, restoring transfer and trading capability.
   * Requires admin privileges.
   */
  @Post('unfreeze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unfreeze an asset (admin only)' })
  @ApiResponse({ status: 200, description: 'Asset unfrozen successfully', type: AssetFreezeStatusDto })
  @ApiResponse({ status: 404, description: 'Asset is not currently frozen' })
  @ApiResponse({ status: 403, description: 'Admin privileges required' })
  async unfreezeAsset(
    @Body() dto: UnfreezeAssetDto,
    @Request() req: any,
  ): Promise<AssetFreezeStatusDto> {
    return this.assetFreezeService.unfreezeAsset(dto, req.user.id);
  }

  /**
   * GET /assets/freeze/:assetId/status
   * Check the current freeze status of an asset.
   * Requires admin privileges.
   */
  @Get(':assetId/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check freeze status of an asset (admin only)' })
  @ApiResponse({ status: 200, description: 'Freeze status', type: AssetFreezeCheckDto })
  async checkFreezeStatus(
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ): Promise<AssetFreezeCheckDto> {
    return this.assetFreezeService.checkFreezeStatus(assetId);
  }

  /**
   * GET /assets/freeze/:assetId/history
   * Retrieve the full audit history of freeze/unfreeze actions for an asset.
   * Requires admin privileges.
   */
  @Get(':assetId/history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get freeze/unfreeze audit history for an asset (admin only)' })
  @ApiResponse({ status: 200, description: 'Freeze history', type: [AssetFreezeStatusDto] })
  async getFreezeHistory(
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ): Promise<AssetFreezeStatusDto[]> {
    return this.assetFreezeService.getFreezeHistory(assetId);
  }
}
