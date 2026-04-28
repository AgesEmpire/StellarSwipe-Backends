import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../users/entities/user.entity';
import { CliCommand } from '../../interfaces/cli-command.interface';
import { formatTable } from '../../utils/table-formatter';

@Injectable()
export class ListUsersCommand implements CliCommand {
  name = 'users:list';
  description = 'List users with optional filters (--active, --search=<term>, --limit=<n>)';

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async run(args: string[]): Promise<void> {
    const search = args.find((a) => a.startsWith('--search='))?.split('=')[1];
    const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '20', 10);
    const activeOnly = args.includes('--active');

    const qb = this.userRepo.createQueryBuilder('u');
    if (search) qb.andWhere('(u.username ILIKE :s OR u.email ILIKE :s)', { s: `%${search}%` });
    if (activeOnly) qb.andWhere('u.isActive = true');
    qb.take(limit).orderBy('u.createdAt', 'DESC');

    const users = await qb.getMany();

    if (!users.length) {
      console.log('No users found.');
      return;
    }

    console.log(
      formatTable(
        ['ID', 'Username', 'Email', 'Active', 'Created'],
        users.map((u) => [
          u.id,
          u.username,
          u.email ?? '-',
          u.isActive ? 'Yes' : 'No',
          u.createdAt.toISOString().split('T')[0],
        ]),
      ),
    );
    console.log(`\nTotal: ${users.length}`);
  }
}
