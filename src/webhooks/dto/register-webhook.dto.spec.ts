import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterWebhookDto, UpdateWebhookDto } from './register-webhook.dto';

describe('webhook event filter validation', () => {
  it('accepts events from the registry', async () => {
    const dto = plainToInstance(RegisterWebhookDto, {
      url: 'https://example.com/hook',
      events: ['trade.executed', 'webhook.secret.rotated'],
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects events outside the registry', async () => {
    const dto = plainToInstance(RegisterWebhookDto, {
      url: 'https://example.com/hook',
      events: ['trade.executed', 'unknown.event'],
    });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['events']);
    expect(errors[0].constraints).toHaveProperty('isIn');
  });

  it('rejects an empty filter on update', async () => {
    const dto = plainToInstance(UpdateWebhookDto, { events: [] });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['events']);
  });
});
