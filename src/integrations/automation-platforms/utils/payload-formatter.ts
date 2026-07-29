import { TriggerEvent } from '../dto/trigger-config.dto';

export function formatTriggerPayload(
  event: TriggerEvent,
  userId: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    event,
    userId,
    data,
    timestamp: new Date().toISOString(),
    source: 'stellarswipe',
  };
}

export function formatActionResponse(
  success: boolean,
  data: unknown,
  error?: string,
): Record<string, unknown> {
  return { success, data: success ? data : null, error: error ?? null };
}
