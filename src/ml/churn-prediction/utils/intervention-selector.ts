import { RetentionActionType } from '../dto/retention-action.dto';

/**
 * Selects the most appropriate retention intervention based on risk level and engagement.
 */
export function selectIntervention(
  riskLevel: 'low' | 'medium' | 'high' | 'critical',
  engagementScore: number,
): RetentionActionType {
  if (riskLevel === 'critical') return RetentionActionType.PERSONAL_OUTREACH;
  if (riskLevel === 'high') return engagementScore < 30 ? RetentionActionType.DISCOUNT : RetentionActionType.EMAIL;
  if (riskLevel === 'medium') return RetentionActionType.PUSH;
  return RetentionActionType.EMAIL;
}
