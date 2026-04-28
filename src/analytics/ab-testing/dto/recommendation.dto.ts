export class RecommendationDto {
  action!: 'adopt' | 'reject' | 'continue';
  winningVariant!: string | null;
  reason!: string;
  uplift!: number;
  isSignificant!: boolean;
}
