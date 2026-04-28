export class RevenueForecastDto {
  userId!: string;
  forecastMonths!: number;
  monthlyForecasts!: { month: number; revenue: number; cumulative: number }[];
  totalForecast!: number;
  confidence!: number;
}
