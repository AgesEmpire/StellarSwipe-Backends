import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  NotificationPreferencesService,
  NotificationType,
  NotificationChannelType,
} from './notification-preferences.service';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { PreferenceDto } from './dto/preference.dto';

@ApiTags('notification-preferences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications/preferences')
export class PreferenceController {
  constructor(
    private readonly notificationPreferencesService: NotificationPreferencesService,
  ) {}

  /**
   * GET /notifications/preferences
   * Returns the current notification preferences for the authenticated user.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get notification preferences for the current user' })
  @ApiResponse({ status: 200, description: 'Current preferences', type: PreferenceDto })
  async getPreferences(@Request() req: any): Promise<PreferenceDto> {
    return this.notificationPreferencesService.getPreferences(req.user.id);
  }

  /**
   * PUT /notifications/preferences
   * Updates notification preferences for the authenticated user.
   * Only provided fields are changed; omitted fields remain unchanged.
   */
  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update notification preferences for the current user' })
  @ApiResponse({ status: 200, description: 'Updated preferences', type: PreferenceDto })
  async updatePreferences(
    @Request() req: any,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<PreferenceDto> {
    return this.notificationPreferencesService.updatePreferences(req.user.id, dto);
  }

  /**
   * GET /notifications/preferences/unsubscribe
   * One-click unsubscribe endpoint for email links.
   * e.g. /notifications/preferences/unsubscribe?type=marketing&channel=email
   */
  @Get('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unsubscribe from a specific notification type and channel' })
  @ApiQuery({ name: 'type', enum: ['tradeUpdates', 'signalPerformance', 'systemAlerts', 'marketing'] })
  @ApiQuery({ name: 'channel', enum: ['email', 'push'] })
  @ApiResponse({ status: 200, description: 'Unsubscribed successfully' })
  async unsubscribe(
    @Request() req: any,
    @Query('type') type: NotificationType,
    @Query('channel') channel: NotificationChannelType,
  ): Promise<{ message: string }> {
    await this.notificationPreferencesService.unsubscribe(req.user.id, type, channel);
    return {
      message: `Successfully unsubscribed from ${type} ${channel} notifications.`,
    };
  }
}
