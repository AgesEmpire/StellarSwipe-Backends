import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { MultisigService } from './multisig.service';
import { MultisigController } from './multisig.controller';
import { PendingTransaction } from './entities/pending-transaction.entity';
import { XdrOperationTypeGuard } from './guards/xdr-operation-type.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([PendingTransaction]),
    ConfigModule,
  ],
  controllers: [MultisigController],
  providers: [
    {
      provide: MultisigService,
      useFactory: (configService: ConfigService) => {
        const horizonUrl =
          configService.get<string>('STELLAR_HORIZON_URL') ??
          'https://horizon.stellar.org';
        const networkPassphrase =
          configService.get<string>('STELLAR_NETWORK_PASSPHRASE') ??
          StellarSdk.Networks.PUBLIC;
        return new MultisigService(
          undefined as any, // TypeORM repo injected separately — see note below
          horizonUrl,
          networkPassphrase,
        );
      },
      inject: [ConfigService],
    },
    XdrOperationTypeGuard,
  ],
  exports: [MultisigService],
})
export class MultisigModule {}

/**
 * NOTE: Because MultisigService uses both @InjectRepository and constructor
 * overrides (for horizon URL / network passphrase), the recommended pattern
 * in production is to inject `ConfigService` inside the service itself rather
 * than through the factory. The factory above is illustrative; the standard
 * NestJS way is shown below and is what the tests use:
 *
 *  providers: [MultisigService],
 *
 * And in MultisigService constructor:
 *  constructor(
 *    @InjectRepository(PendingTransaction)
 *    private readonly pendingTxRepo: Repository<PendingTransaction>,
 *    private readonly configService: ConfigService,
 *  ) { ... }
 */
