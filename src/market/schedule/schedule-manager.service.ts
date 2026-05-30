import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketSchedule, DayOfWeek } from './entities/market-schedule.entity';
import { CreateScheduleConfigDto, UpdateScheduleConfigDto } from './dto/schedule-config.dto';
import { MarketStatusDto } from './dto/market-status.dto';

const DAY_NAMES: DayOfWeek[] = [
  DayOfWeek.SUNDAY,
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

@Injectable()
export class ScheduleManagerService {
  private readonly logger = new Logger(ScheduleManagerService.name);

  constructor(
    @InjectRepository(MarketSchedule)
    private readonly scheduleRepo: Repository<MarketSchedule>,
  ) {}

  async create(dto: CreateScheduleConfigDto): Promise<MarketSchedule> {
    const schedule = this.scheduleRepo.create({ ...dto, timezone: dto.timezone ?? 'UTC' });
    return this.scheduleRepo.save(schedule);
  }

  async update(id: string, dto: UpdateScheduleConfigDto): Promise<MarketSchedule> {
    const schedule = await this.scheduleRepo.findOne({ where: { id } });
    if (!schedule) throw new NotFoundException('Market schedule not found');
    Object.assign(schedule, dto);
    return this.scheduleRepo.save(schedule);
  }

  async getStatus(region: string, assetClass: string): Promise<MarketStatusDto> {
    const now = new Date();
    const currentDay = DAY_NAMES[now.getUTCDay()];
    const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;

    const schedule = await this.scheduleRepo.findOne({
      where: { region, assetClass, dayOfWeek: currentDay, isActive: true },
    });

    if (!schedule) {
      return { isOpen: false, region, assetClass, currentTime, message: 'No schedule configured for this market' };
    }

    const isOpen = currentTime >= schedule.openTime && currentTime < schedule.closeTime;

    return {
      isOpen,
      region,
      assetClass,
      currentTime,
      openTime: schedule.openTime,
      closeTime: schedule.closeTime,
      message: isOpen ? 'Market is open' : 'Market is closed',
    };
  }

  async validateMarketOpen(region: string, assetClass: string): Promise<void> {
    const status = await this.getStatus(region, assetClass);
    if (!status.isOpen) {
      throw new BadRequestException(`Market is closed for ${region}/${assetClass}: ${status.message}`);
    }
  }

  async listSchedules(region?: string): Promise<MarketSchedule[]> {
    const where = region ? { region } : {};
    return this.scheduleRepo.find({ where });
  }
}
