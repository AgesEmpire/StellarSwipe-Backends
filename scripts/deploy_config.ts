/**
 * Deterministic deployment salts.
 * Rules:
 *  - Each contract has a unique base salt.
 *  - Each network gets a different salt by XOR-ing the base with a network suffix.
 *  - Salts are 32-byte hex strings (64 hex chars).
 *
 * Address derivation (Soroban):
 *   address = sha256( deployer_address || salt || wasm_hash )
 * The frontend can reproduce this using @stellar/stellar-sdk:
 *   Contract.fromStrKey(xdr.HashIdPreimage.hashIdPreimageContractId(...))
 */

export type Network = 'testnet' | 'mainnet';

export const NETWORK_SUFFIX: Record<Network, string> = {
  testnet: '01',
  mainnet: '02',
};

/** Base salts — unique per contract, network-agnostic. */
const BASE_SALTS = {
  user_portfolio: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  whsper_stellar: 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5',
} as const;

export type ContractName = keyof typeof BASE_SALTS;

/**
 * Returns a 32-byte hex salt unique to (contract, network).
 * The last byte of the base salt is replaced with the network suffix byte.
 */
export function getSalt(contract: ContractName, network: Network): string {
  const base = BASE_SALTS[contract];
  const suffix = NETWORK_SUFFIX[network];
  // Replace last 2 hex chars (1 byte) with network suffix
  return base.slice(0, 62) + suffix;
}

export const CONTRACT_NAMES: ContractName[] = ['user_portfolio', 'whsper_stellar'];
