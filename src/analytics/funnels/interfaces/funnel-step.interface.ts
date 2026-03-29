export interface IFunnelStep {
  key: string;
  name: string;
  order: number;
  description?: string;
}

export interface IFunnelDefinition {
  name: string;
  steps: IFunnelStep[];
}

export const USER_ACQUISITION_FUNNEL: IFunnelDefinition = {
  name: 'user_acquisition',
  steps: [
    { key: 'signup', name: 'Sign Up', order: 1 },
    { key: 'wallet_connect', name: 'Wallet Connect', order: 2 },
    { key: 'first_signal_view', name: 'First Signal View', order: 3 },
    { key: 'first_trade', name: 'First Trade', order: 4 },
  ],
};
