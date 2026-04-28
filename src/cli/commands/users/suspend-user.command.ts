import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../users/entities/user.entity';
import { CliCommand } from '../../interfaces/cli-command.interface';

@Injectable()
export class SuspendUserCommand implements CliCommand {
  name = 'users:suspend';
  description = 'Suspend or unsuspend a user. Usage: users:suspend <userId> [--unsuspend] [--reason=<text>]';

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async run(args: string[]): Promise<void> {
    const userId = args[0];
    if (!userId) {
      console.error('Usage: users:suspend <userId> [--unsuspend] [--reason=<text>]');
      return;
    }

    const unsuspend = args.includes('--unsuspend');
    const reason = args.find((a) => a.startsWith('--reason='))?.split('=').slice(1).join('=') ?? 'Admin action';

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      console.error(`User ${userId} not found.`);
      return;
    }

    if (!unsuspend && !user.isActive) {
      console.log(`User ${user.username} is already suspended.`);
      return;
    }
    if (unsuspend && user.isActive) {
      console.log(`User ${user.username} is already active.`);
      return;
    }

    user.isActive = unsuspend;
    await this.userRepo.save(user);

    const action = unsuspend ? 'unsuspended' : 'suspended';
    console.log(`✓ User ${user.username} (${userId}) has been ${action}. Reason: ${reason}`);
  }
}
