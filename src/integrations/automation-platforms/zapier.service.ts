import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AutomationHook } from './interfaces/automation-hook.interface';
import { TriggerConfigDto } from './dto/trigger-config.dto';
import { formatTriggerPayload } from './utils/payload-formatter';

@Injectable()
export class ZapierService {
  private readonly logger = new Logger(ZapierService.name);
  private readonly hooks = new Map<string, AutomationHook[]>();

  constructor(private readonly httpService: HttpService) {}

  subscribe(userId: string, dto: TriggerConfigDto): AutomationHook {
    const hook: AutomationHook = {
      platform: 'zapier',
      hookUrl: dto.hookUrl,
      event: dto.event,
      userId,
      createdAt: new Date(),
    };

    const key = this.hookKey(userId, dto.event);
    const existing = this.hooks.get(key) ?? [];
    this.hooks.set(key, [...existing, hook]);
    this.logger.log(`Zapier hook subscribed: ${dto.event} for user ${userId}`);
    return hook;
  }

  unsubscribe(userId: string, event: string, hookUrl: string): void {
    const key = this.hookKey(userId, event);
    const filtered = (this.hooks.get(key) ?? []).filter((h) => h.hookUrl !== hookUrl);
    this.hooks.set(key, filtered);
  }

  async dispatch(userId: string, event: string, data: Record<string, unknown>): Promise<void> {
    const key = this.hookKey(userId, event);
    const hooks = this.hooks.get(key) ?? [];
    if (hooks.length === 0) return;

    const payload = formatTriggerPayload(event as any, userId, data);

    await Promise.allSettled(
      hooks.map((hook) =>
        firstValueFrom(this.httpService.post(hook.hookUrl, payload)).catch((err) =>
          this.logger.error(`Zapier delivery failed to ${hook.hookUrl}: ${err.message}`),
        ),
      ),
    );
  }

  private hookKey(userId: string, event: string): string {
    return `${userId}:${event}`;
  }
}
