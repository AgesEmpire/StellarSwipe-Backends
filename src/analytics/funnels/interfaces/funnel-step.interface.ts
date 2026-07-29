export interface IFunnelStep {
  key: string;
  name: string;
  order: number;
  description?: string;
}

export interface IFunnelConfig {
  name: string;
  steps: IFunnelStep[];
}
