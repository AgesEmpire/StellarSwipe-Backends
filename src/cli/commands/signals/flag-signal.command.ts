import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal, SignalStatus } from '../../../signals/entities/signal.entity';
import { CliCommand } from '../../interfaces/cli-command.interface';

@Injectable()
export class FlagSignalCommand implements CliCommand {
  name = 'signals:flag';
  description = 'Flag or remove a signal. Usage: signals:flag <signalId> [--remove] [--reason=<text>]';

  constructor(
    @InjectRepository(Signal)
    private readonly signalRepo: Repository<Signal>,
  ) {}

  async run(args: string[]): Promise<void> {
    const signalId = args[0];
    if (!signalId) {
      console.error('Usage: signals:flag <signalId> [--remove] [--reason=<text>]');
      return;
    }

    const remove = args.includes('--remove');
    const reason = args.find((a) => a.startsWith('--reason='))?.split('=').slice(1).join('=') ?? 'Admin flag';

    const signal = await this.signalRepo.findOne({ where: { id: signalId } });
    if (!signal) {
      console.error(`Signal ${signalId} not found.`);
      return;
    }

    if (!signal.metadata) signal.metadata = {};
    signal.metadata.flagged = true;
    signal.metadata.flagReason = reason;

    if (remove) {
      signal.status = SignalStatus.CANCELLED;
      signal.metadata.removedByAdmin = true;
      await this.signalRepo.save(signal);
      await this.signalRepo.softDelete(signalId);
      console.log(`✓ Signal ${signalId} flagged and removed. Reason: ${reason}`);
    } else {
      await this.signalRepo.save(signal);
      console.log(`✓ Signal ${signalId} flagged. Reason: ${reason}`);
    }
  }
}
