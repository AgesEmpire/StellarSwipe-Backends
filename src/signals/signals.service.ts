import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal, SignalAction, SignalStatus } from './entities/signal.entity';
import { CreateSignalDto } from './dto/signals.dto';

@Injectable()
export class SignalsService {
  constructor(
    @InjectRepository(Signal)
    private readonly signalRepository: Repository<Signal>,
  ) {}

  async create(createSignalDto: CreateSignalDto): Promise<Signal> {
    // Price Validation
    this.validatePrices(createSignalDto);

    // Duplicate Detection (same provider, asset_pair, action and ACTIVE status)
    const existingSignal = await this.signalRepository.findOne({
      where: {
        provider_id: createSignalDto.provider_id,
        asset_pair: createSignalDto.asset_pair,
        action: createSignalDto.action,
        status: SignalStatus.ACTIVE,
      },
    });

    if (existingSignal) {
      throw new BadRequestException('A similar active signal already exists for this provider and asset pair.');
    }

    const signal = this.signalRepository.create({
      ...createSignalDto,
      expires_at: new Date(createSignalDto.expires_at),
    });

    return await this.signalRepository.save(signal);
  }

  private validatePrices(dto: CreateSignalDto) {
    if (dto.action === SignalAction.BUY) {
      if (dto.target_price <= dto.entry_price) {
        throw new BadRequestException('Target price must be greater than entry price for BUY signals.');
      }
      if (dto.stop_loss >= dto.entry_price) {
        throw new BadRequestException('Stop loss must be lower than entry price for BUY signals.');
      }
    } else if (dto.action === SignalAction.SELL) {
      if (dto.target_price >= dto.entry_price) {
        throw new BadRequestException('Target price must be lower than entry price for SELL signals.');
      }
      if (dto.stop_loss <= dto.entry_price) {
        throw new BadRequestException('Stop loss must be greater than entry price for SELL signals.');
      }
    }
  }

  async findAll(status?: SignalStatus): Promise<Signal[]> {
    const query = this.signalRepository.createQueryBuilder('signal')
      .leftJoinAndSelect('signal.provider', 'provider');

    if (status) {
      query.andWhere('signal.status = :status', { status });
    }

    return await query.orderBy('signal.created_at', 'DESC').getMany();
  }

  async findOne(id: string): Promise<Signal> {
    const signal = await this.signalRepository.findOne({
      where: { id },
      relations: ['provider'],
    });

    if (!signal) {
      throw new NotFoundException(`Signal with ID ${id} not found`);
    }

    return signal;
  }

  async updatePerformance(id: string, metrics: { total_profit_loss: number; success_rate: number; executed_count: number }): Promise<Signal> {
    const signal = await this.findOne(id);
    
    signal.total_profit_loss = metrics.total_profit_loss;
    signal.success_rate = metrics.success_rate;
    signal.executed_count = metrics.executed_count;

    return await this.signalRepository.save(signal);
  }

  async remove(id: string): Promise<void> {
    const signal = await this.findOne(id);
    await this.signalRepository.softRemove(signal);
  }
}
