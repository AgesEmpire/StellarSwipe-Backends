import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { SignalExpirationService } from './services/signal-expiration.service';
import {
  ExpirationHandlerService,
  EXPIRATION_QUEUE,
} from './services/expiration-handler.service';
import { ExpirationNotificationService } from './services/expiration-notification.service';
import {
  UpdateExpirationPreferenceDto,
  QueueExpirationCheckDto,
  SendWarningsDto,
  CancelSignalDto,
  GetNotificationsDto,
} from './dto/expiration.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserExpirationPreference, ExpirationAction } from './entities/user-expiration-preference.entity';

@Controller('signals/expiration')
export class SignalAutoCloseController {
  constructor(
    private signalExpirationService: SignalExpirationService,
    private expirationHandlerService: ExpirationHandlerService,
    private notificationService: ExpirationNotificationService,
    @InjectQueue(EXPIRATION_QUEUE)
    private expirationQueue: Queue,
    @InjectRepository(UserExpirationPreference)
    private preferenceRepository: Repository<UserExpirationPreference>,
  ) {}

  // === Expiration Status ===

  @Get('summary')
  async getExpirationSummary() {
    return this.signalExpirationService.getExpirationSummary();
  }

  @Get('check/:signalId')
  async checkSignalExpiration(@Param('signalId') signalId: string) {
    return this.signalExpirationService.checkSignalExpiration(signalId);
  }

  @Get('expired')
  async getExpiredSignals() {
    const signals = await this.signalExpirationService.findExpiredSignals();
    return {
      count: signals.length,
      signals: signals.map((s) => ({
        id: s.id,
        baseAsset: s.baseAsset,
        counterAsset: s.counterAsset,
        expiresAt: s.expiresAt,
        copiersCount: s.copiersCount,
      })),
    };
  }

  @Get('grace-period')
  async getSignalsInGracePeriod() {
    const signals = await this.signalExpirationService.findSignalsInGracePeriod();
    return {
      count: signals.length,
      signals: signals.map((s) => ({
        id: s.id,
        baseAsset: s.baseAsset,
        counterAsset: s.counterAsset,
        gracePeriodEndsAt: s.gracePeriodEndsAt,
        copiersCount: s.copiersCount,
      })),
    };
  }

  @Get('approaching/:minutes')
  async getSignalsApproachingExpiration(@Param('minutes') minutes: string) {
    const minutesNumber = parseInt(minutes, 10);
    const signals = await this.signalExpirationService.findSignalsApproachingExpiration(minutesNumber);
    return {
      minutesBefore: minutesNumber,
      count: signals.length,
      signals: signals.map((s) => ({
        id: s.id,
        baseAsset: s.baseAsset,
        counterAsset: s.counterAsset,
        expiresAt: s.expiresAt,
        copiersCount: s.copiersCount,
      })),
    };
  }

  // === User Preferences ===

  @Get('preferences/:userId')
  async getUserPreferences(@Param('userId') userId: string) {
    let preference = await this.preferenceRepository.findOne({
      where: { userId },
    });

    if (!preference) {
      preference = this.preferenceRepository.create({
        userId,
        defaultAction: ExpirationAction.NOTIFY_ONLY,
        gracePeriodMinutes: 30,
        notifyBeforeExpirationMinutes: 60,
        notifyOnAutoClose: true,
        notifyOnGracePeriodStart: true,
      });
      await this.preferenceRepository.save(preference);
    }

    return preference;
  }

  @Put('preferences/:userId')
  async updateUserPreferences(
    @Param('userId') userId: string,
    @Body() dto: UpdateExpirationPreferenceDto,
  ) {
    let preference = await this.preferenceRepository.findOne({
      where: { userId },
    });

    if (!preference) {
      const { autoCloseAtLossThreshold, ...rest } = dto;
      preference = this.preferenceRepository.create({
        userId,
        ...rest,
        autoCloseAtLossThreshold: autoCloseAtLossThreshold?.toString() ?? null,
      });
    } else {
      Object.assign(preference, dto);
    }

    return this.preferenceRepository.save(preference);
  }

  // === Manual Actions ===

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancelSignal(@Body() dto: CancelSignalDto) {
    const signal = await this.signalExpirationService.cancelSignal(dto.signalId);
    const result = await this.expirationHandlerService.handleSignalCancellation(signal);

    return {
      message: 'Signal cancelled successfully',
      result,
    };
  }

  // === Background Jobs ===

  @Post('jobs/check-single')
  @HttpCode(HttpStatus.ACCEPTED)
  async queueSingleExpirationCheck(@Body() dto: QueueExpirationCheckDto) {
    const job = await this.expirationQueue.add('check-signal-expiration', {
      signalId: dto.signalId,
    });

    return {
      message: 'Expiration check queued',
      jobId: job.id,
    };
  }

  @Post('jobs/check-all')
  @HttpCode(HttpStatus.ACCEPTED)
  async queueBatchExpirationCheck() {
    const job = await this.expirationQueue.add('check-all-expirations', {});

    return {
      message: 'Batch expiration check queued',
      jobId: job.id,
    };
  }

  @Post('jobs/check-grace-periods')
  @HttpCode(HttpStatus.ACCEPTED)
  async queueGracePeriodCheck() {
    const job = await this.expirationQueue.add('check-grace-periods', {});

    return {
      message: 'Grace period check queued',
      jobId: job.id,
    };
  }

  @Post('jobs/send-warnings')
  @HttpCode(HttpStatus.ACCEPTED)
  async queueExpirationWarnings(@Body() dto: SendWarningsDto) {
    const job = await this.expirationQueue.add('send-expiration-warnings', {
      minutesBefore: dto.minutesBefore,
    });

    return {
      message: 'Expiration warnings job queued',
      jobId: job.id,
      minutesBefore: dto.minutesBefore,
    };
  }

  @Get('jobs/:jobId/status')
  async getJobStatus(@Param('jobId') jobId: string) {
    const job = await this.expirationQueue.getJob(jobId);

    if (!job) {
      return { found: false };
    }

    const state = await job.getState();
    const progress = job.progress();

    return {
      found: true,
      jobId: job.id,
      name: job.name,
      state,
      progress,
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  }

  // === Notifications ===

  @Get('notifications/:userId')
  async getUserNotifications(
    @Param('userId') userId: string,
    @Query() query: GetNotificationsDto,
  ) {
    const notifications = await this.notificationService.getUserNotifications(
      userId,
      query.limit,
      query.offset,
    );

    return {
      count: notifications.length,
      notifications,
    };
  }

  @Get('notifications/:userId/unread')
  async getUnreadNotifications(@Param('userId') userId: string) {
    const notifications = await this.notificationService.getUnreadNotifications(userId);

    return {
      count: notifications.length,
      notifications,
    };
  }

  @Post('notifications/:notificationId/read')
  @HttpCode(HttpStatus.OK)
  async markNotificationAsRead(@Param('notificationId') notificationId: string) {
    const notification = await this.notificationService.markAsRead(notificationId);

    return {
      message: 'Notification marked as read',
      notification,
    };
  }

  @Post('notifications/:userId/read-all')
  @HttpCode(HttpStatus.OK)
  async markAllNotificationsAsRead(@Param('userId') userId: string) {
    const count = await this.notificationService.markAllAsRead(userId);

    return {
      message: 'All notifications marked as read',
      count,
    };
  }
}
