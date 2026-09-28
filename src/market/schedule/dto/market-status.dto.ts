export class MarketStatusDto {
  isOpen!: boolean;
  region!: string;
  assetClass!: string;
  currentTime!: string;
  openTime?: string;
  closeTime?: string;
  nextOpenAt?: string;
  message!: string;
}
