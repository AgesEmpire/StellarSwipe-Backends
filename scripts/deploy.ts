#!/usr/bin/env ts-node
/**
 * Deterministic Soroban contract deployment script.
 *
 * Usage:
 *   ts-node scripts/deploy.ts --network testnet --deployer <secret_key>
 *   ts-node scripts/deploy.ts --network mainnet --deployer <secret_key>
 *
 * Running twice with the same salt + deployer produces the same contract address.
 *
 * Outputs:
 *   - frontend-config.<network>.json  (auto-generated contract addresses)
 *   - DEPLOYMENTS.md                  (updated with addresses + timestamp)
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getSalt, CONTRACT_NAMES, Network, ContractName } from './deploy_config';

const WASM_DIR = path.join(__dirname, '..', 'contracts', 'target', 'wasm32-unknown-unknown', 'release');
const ROOT = path.join(__dirname, '..');

function parseArgs(): { network: Network; deployer: string } {
  const args = process.argv.slice(2);
  const networkIdx = args.indexOf('--network');
  const deployerIdx = args.indexOf('--deployer');

  if (networkIdx === -1 || deployerIdx === -1) {
    console.error('Usage: ts-node deploy.ts --network <testnet|mainnet> --deployer <secret_key>');
    process.exit(1);
  }

  const network = args[networkIdx + 1] as Network;
  if (!['testnet', 'mainnet'].includes(network)) {
    console.error('--network must be testnet or mainnet');
    process.exit(1);
  }

  return { network, deployer: args[deployerIdx + 1] };
}

function wasmPath(contract: ContractName): string {
  return path.join(WASM_DIR, `${contract}.wasm`);
}

function deployContract(contract: ContractName, network: Network, deployer: string): string {
  const salt = getSalt(contract, network);
  const wasm = wasmPath(contract);

  if (!fs.existsSync(wasm)) {
    throw new Error(`WASM not found: ${wasm}. Run: cargo build --workspace --target wasm32-unknown-unknown --release`);
  }

  const rpcUrl = network === 'testnet'
    ? 'https://soroban-testnet.stellar.org'
    : 'https://soroban.stellar.org';

  const cmd = [
    'stellar contract deploy',
    `--wasm ${wasm}`,
    `--salt ${salt}`,
    `--source ${deployer}`,
    `--network ${network}`,
    `--rpc-url ${rpcUrl}`,
    '--network-passphrase',
    network === 'testnet'
      ? '"Test SDF Network ; September 2015"'
      : '"Public Global Stellar Network ; September 2015"',
  ].join(' ');

  console.log(`Deploying ${contract} to ${network}...`);
  const output = execSync(cmd, { encoding: 'utf8' }).trim();
  // stellar CLI prints the contract address on stdout
  const address = output.split('\n').pop()!.trim();
  console.log(`  ${contract}: ${address}`);
  return address;
}

function writeFrontendConfig(network: Network, addresses: Record<ContractName, string>): void {
  const configPath = path.join(ROOT, `frontend-config.${network}.json`);
  const config = {
    network,
    generatedAt: new Date().toISOString(),
    contracts: addresses,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\nFrontend config written: ${configPath}`);
}

function updateDeploymentsMd(network: Network, addresses: Record<ContractName, string>): void {
  const mdPath = path.join(ROOT, 'DEPLOYMENTS.md');
  const timestamp = new Date().toISOString();

  const section = [
    `## ${network.charAt(0).toUpperCase() + network.slice(1)} — ${timestamp}`,
    '',
    '| Contract | Address |',
    '|---|---|',
    ...Object.entries(addresses).map(([name, addr]) => `| ${name} | \`${addr}\` |`),
    '',
    '### Address Derivation',
    '```',
    'address = sha256( deployer_address || salt || wasm_hash )',
    '```',
    'Salts are defined in `scripts/deploy_config.ts`. The frontend can compute addresses',
    'client-side using `@stellar/stellar-sdk` `Contract.fromStrKey(...)` with the same inputs.',
    '',
  ].join('\n');

  let existing = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '# Deployments\n\n';
  // Replace existing section for this network if present
  const sectionHeader = `## ${network.charAt(0).toUpperCase() + network.slice(1)}`;
  const sectionRegex = new RegExp(`${sectionHeader}[\\s\\S]*?(?=^## |$)`, 'm');
  if (sectionRegex.test(existing)) {
    existing = existing.replace(sectionRegex, section);
  } else {
    existing += section;
  }

  fs.writeFileSync(mdPath, existing);
  console.log(`DEPLOYMENTS.md updated.`);
}

async function main() {
  const { network, deployer } = parseArgs();
  const addresses = {} as Record<ContractName, string>;

  for (const contract of CONTRACT_NAMES) {
    addresses[contract] = deployContract(contract, network, deployer);
  }

  writeFrontendConfig(network, addresses);
  updateDeploymentsMd(network, addresses);

  console.log('\nDeployment complete.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
