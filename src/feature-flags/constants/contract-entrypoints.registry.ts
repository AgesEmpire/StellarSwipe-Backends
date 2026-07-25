export interface ContractEntrypointRegistry {
  [contractName: string]: string[];
}

export const KNOWN_CONTRACT_ENTRYPOINTS: ContractEntrypointRegistry = {
  TradeExecutorContract: [
    'execute_market_order',
    'place_limit_order',
    'cancel_order',
    'get_order',
  ],
};

export function isValidEntrypoint(
  contractName: string,
  method: string,
): boolean {
  const entrypoints = KNOWN_CONTRACT_ENTRYPOINTS[contractName];
  if (!entrypoints) return false;
  return entrypoints.includes(method);
}
