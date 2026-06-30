import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import { ConfigService } from '@nestjs/config';
import {
  SponsoredOnboardingDto,
  RevokeSponsorshipDto,
  SponsoredOnboardingResultDto,
} from './sponsored-reserves.dto';

/** Minimum XLM the sponsor must keep above consumed reserves before accepting new onboardings. */
const MIN_SPONSOR_RESERVE_BUFFER_XLM = 5;
/** Base reserve per account in XLM (Stellar protocol constant). */
const BASE_RESERVE_XLM = 0.5;
/** Reserve increment per subentry (trustline, offer, etc.) */
const SUBENTRY_RESERVE_XLM = 0.5;

@Injectable()
export class SponsoredReservesService {
  private readonly logger = new Logger(SponsoredReservesService.name);
  private readonly server: StellarSdk.Horizon.Server;
  private readonly sponsorKeypair: StellarSdk.Keypair;
  private readonly networkPassphrase: string;

  constructor(private readonly configService: ConfigService) {
    const horizonUrl = this.configService.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );
    this.server = new StellarSdk.Horizon.Server(horizonUrl);

    const secret = this.configService.getOrThrow<string>('STELLAR_SPONSOR_SECRET_KEY');
    this.sponsorKeypair = StellarSdk.Keypair.fromSecret(secret);

    this.networkPassphrase =
      this.configService.get<string>('STELLAR_NETWORK') === 'mainnet'
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET;
  }

  /**
   * Sponsors the creation of a new user account and optional initial trustlines
   * using the beginSponsoringFutureReserves / endSponsoringFutureReserves sandwich.
   *
   * The new account does NOT need to hold any XLM for the base reserve.
   */
  async sponsorNewAccountOnboarding(
    dto: SponsoredOnboardingDto,
    newAccountSecretKey: string,
  ): Promise<SponsoredOnboardingResultDto> {
    await this.assertSponsorHasSufficientReserve(dto.trustlineAssets?.length ?? 0);

    const newAccountKeypair = StellarSdk.Keypair.fromSecret(newAccountSecretKey);
    if (newAccountKeypair.publicKey() !== dto.newAccountPublicKey) {
      throw new BadRequestException('newAccountSecretKey does not match newAccountPublicKey');
    }

    const sponsorAccount = await this.server.loadAccount(this.sponsorKeypair.publicKey());
    const fee = await this.server.fetchBaseFee();

    const txBuilder = new StellarSdk.TransactionBuilder(sponsorAccount, {
      fee: String(fee * 10),
      networkPassphrase: this.networkPassphrase,
    })
      // 1. Begin sponsoring future reserves for the new account
      .addOperation(
        StellarSdk.Operation.beginSponsoringFutureReserves({
          sponsoredId: dto.newAccountPublicKey,
        }),
      )
      // 2. Create the new account (starting balance can be 0 since sponsor covers reserve)
      .addOperation(
        StellarSdk.Operation.createAccount({
          destination: dto.newAccountPublicKey,
          startingBalance: dto.startingBalance ?? '0',
        }),
      );

    // 3. Add any requested trustlines inside the sponsorship sandwich
    const trustlineAssets: StellarSdk.Asset[] = [];
    for (const assetStr of dto.trustlineAssets ?? []) {
      const [code, issuer] = assetStr.split(':');
      const asset = new StellarSdk.Asset(code, issuer);
      trustlineAssets.push(asset);
      txBuilder.addOperation(
        StellarSdk.Operation.changeTrust({
          asset,
          source: dto.newAccountPublicKey,
        }),
      );
    }

    // 4. End sponsoring future reserves (must be signed by the new account)
    txBuilder.addOperation(
      StellarSdk.Operation.endSponsoringFutureReserves({
        source: dto.newAccountPublicKey,
      }),
    );

    const tx = txBuilder.setTimeout(30).build();

    // Both sponsor and new account must sign
    tx.sign(this.sponsorKeypair);
    tx.sign(newAccountKeypair);

    const result = await this.server.submitTransaction(tx);

    this.logger.log(
      `Sponsored onboarding: newAccount=${dto.newAccountPublicKey} trustlines=${trustlineAssets.length} hash=${result.hash}`,
    );

    return {
      hash: result.hash,
      newAccountPublicKey: dto.newAccountPublicKey,
      sponsorAccount: this.sponsorKeypair.publicKey(),
      trustlinesCreated: trustlineAssets.length,
    };
  }

  /**
   * Revokes sponsorship of a sponsored account's base reserve,
   * transferring responsibility back to the account itself.
   */
  async revokeSponsoredAccountReserve(dto: RevokeSponsorshipDto): Promise<{ hash: string }> {
    const sponsorAccount = await this.server.loadAccount(this.sponsorKeypair.publicKey());
    const fee = await this.server.fetchBaseFee();

    const tx = new StellarSdk.TransactionBuilder(sponsorAccount, {
      fee: String(fee),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.revokeSponsorship({
          type: 'account',
          account: dto.sponsoredAccountPublicKey,
        }),
      )
      .setTimeout(30)
      .build();

    tx.sign(this.sponsorKeypair);
    const result = await this.server.submitTransaction(tx);

    this.logger.log(`Sponsorship revoked for account=${dto.sponsoredAccountPublicKey} hash=${result.hash}`);
    return { hash: result.hash };
  }

  /**
   * Checks the sponsor's available XLM balance against the reserved amount.
   * Throws if capacity is insufficient to onboard more accounts.
   */
  async getSponsorReserveCapacity(): Promise<{
    sponsorAccount: string;
    availableXlm: string;
    canOnboard: boolean;
  }> {
    const account = await this.server.loadAccount(this.sponsorKeypair.publicKey());
    const nativeBalance = (account.balances as any[]).find((b: any) => b.asset_type === 'native');
    const totalXlm = parseFloat(nativeBalance?.balance ?? '0');
    const minBalance =
      (2 + (account as any).subentry_count) * BASE_RESERVE_XLM + MIN_SPONSOR_RESERVE_BUFFER_XLM;
    const availableXlm = Math.max(0, totalXlm - minBalance);

    return {
      sponsorAccount: this.sponsorKeypair.publicKey(),
      availableXlm: availableXlm.toFixed(7),
      canOnboard: availableXlm >= BASE_RESERVE_XLM * 2,
    };
  }

  private async assertSponsorHasSufficientReserve(extraSubentries: number): Promise<void> {
    const account = await this.server.loadAccount(this.sponsorKeypair.publicKey());
    const nativeBalance = (account.balances as any[]).find((b: any) => b.asset_type === 'native');
    const totalXlm = parseFloat(nativeBalance?.balance ?? '0');
    // Reserve needed: 2 base + current subentries + new account (2) + trustlines
    const needed =
      (2 + (account as any).subentry_count + 2 + extraSubentries) * SUBENTRY_RESERVE_XLM +
      MIN_SPONSOR_RESERVE_BUFFER_XLM;

    if (totalXlm < needed) {
      throw new BadRequestException(
        `Sponsor has insufficient reserve. Has ${totalXlm} XLM, needs ${needed} XLM`,
      );
    }
  }
}
