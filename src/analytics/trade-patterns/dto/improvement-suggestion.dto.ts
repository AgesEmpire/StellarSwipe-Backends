export class ImprovementSuggestionDto {
  category!: string;
  suggestion!: string;
  priority!: 'high' | 'medium' | 'low';
  expectedImpact?: string;
}
