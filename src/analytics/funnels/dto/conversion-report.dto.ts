export class DropOffPointDto {
  stepKey!: string;
  stepName!: string;
  stepOrder!: number;
  usersDropped!: number;
  dropOffRate!: number;
}

export class ConversionReportDto {
  funnelId!: string;
  funnelName!: string;
  period!: { from: Date; to: Date };
  totalEntered!: number;
  totalConverted!: number;
  overallConversionRate!: number;
  biggestDropOff!: DropOffPointDto;
  dropOffPoints!: DropOffPointDto[];
  generatedAt!: Date;
}
