export class LtvSegmentDto {
  segment!: 'high' | 'medium' | 'low';
  minLtv!: number;
  maxLtv!: number;
  userCount!: number;
  avgLtv!: number;
}
