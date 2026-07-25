import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  ParseArrayPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { MultisigService } from './multisig.service';
import {
  CreatePendingTransactionDto,
  SubmitSignatureDto,
} from './dto/submit-signature.dto';
import {
  MultisigAccountStatusDto,
  PendingTransactionStatusDto,
  SubmitTransactionResultDto,
} from './dto/multisig-status.dto';
import { PendingTransactionStatus } from './entities/pending-transaction.entity';
import { XdrOperationTypeGuard } from './guards/xdr-operation-type.guard';
import { ValidateXdrOperationType } from './decorators/validate-xdr-operation-type.decorator';

@ApiTags('Stellar Multisig')
@Controller('stellar/multisig')
@UseGuards(XdrOperationTypeGuard)
export class MultisigController {
  constructor(private readonly multisigService: MultisigService) {}

  // ─── Account Status ───────────────────────────────────────────────────────────

  @Get('accounts/:accountId/status')
  @ApiOperation({
    summary: 'Get multisig configuration for a Stellar account',
    description:
      'Returns threshold levels, signer list, and whether the account is a multisig account.',
  })
  @ApiParam({ name: 'accountId', description: 'Stellar account public key (G…)' })
  @ApiResponse({ status: 200, type: MultisigAccountStatusDto })
  @ApiResponse({ status: 404, description: 'Account not found on Stellar network' })
  getAccountStatus(
    @Param('accountId') accountId: string,
  ): Promise<MultisigAccountStatusDto> {
    return this.multisigService.getAccountMultisigStatus(accountId);
  }

  // ─── Pending Transactions ─────────────────────────────────────────────────────

  @Get('accounts/:accountId/pending')
  @ApiOperation({
    summary: 'List pending transactions for a multisig account',
  })
  @ApiParam({ name: 'accountId', description: 'Stellar account public key' })
  @ApiQuery({
    name: 'statuses',
    required: false,
    isArray: true,
    enum: PendingTransactionStatus,
    description: 'Filter by status (defaults to pending + ready)',
  })
  @ApiResponse({ status: 200, type: [PendingTransactionStatusDto] })
  getPendingTransactions(
    @Param('accountId') accountId: string,
    @Query(
      'statuses',
      new ParseArrayPipe({ items: String, separator: ',', optional: true }),
    )
    statuses?: PendingTransactionStatus[],
  ): Promise<PendingTransactionStatusDto[]> {
    return this.multisigService.getPendingTransactions(accountId, statuses);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get a single pending transaction by ID' })
  @ApiParam({ name: 'id', description: 'Pending transaction UUID' })
  @ApiResponse({ status: 200, type: PendingTransactionStatusDto })
  @ApiResponse({ status: 404, description: 'Not found' })
  getTransaction(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PendingTransactionStatusDto> {
    return this.multisigService.getPendingTransactionById(id);
  }

  // ─── Create Pending Transaction ───────────────────────────────────────────────

  @Post('transactions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new pending multisig transaction',
    description:
      'Accepts a base64-encoded XDR transaction envelope and stores it for co-signer approval.',
  })
  @ApiResponse({ status: 201, type: PendingTransactionStatusDto })
  @ApiResponse({ status: 400, description: 'Invalid XDR or account ID' })
  @ApiResponse({ status: 409, description: 'Duplicate transaction hash' })
  createPendingTransaction(
    @Body() dto: CreatePendingTransactionDto,
  ): Promise<PendingTransactionStatusDto> {
    return this.multisigService.createPendingTransaction(dto);
  }

  // ─── Submit Signature ─────────────────────────────────────────────────────────

  @Post('transactions/signatures')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit a co-signer signature for a pending transaction',
    description:
      'Verifies the Ed25519 signature cryptographically, appends it to the XDR envelope, ' +
      'and transitions the transaction to READY if the threshold is met.',
  })
  @ApiResponse({ status: 200, type: PendingTransactionStatusDto })
  @ApiResponse({ status: 400, description: 'Invalid signature or signer not authorized' })
  @ApiResponse({ status: 404, description: 'Pending transaction not found' })
  @ApiResponse({ status: 409, description: 'Signer already signed' })
  submitSignature(@Body() dto: SubmitSignatureDto): Promise<PendingTransactionStatusDto> {
    return this.multisigService.submitSignature(dto);
  }

  // ─── Submit to Network ────────────────────────────────────────────────────────

  @Post('transactions/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit a READY transaction to the Stellar network',
    description:
      'Submits the fully-signed transaction envelope to Horizon. ' +
      'Transaction must have status READY (threshold met).',
  })
  @ApiParam({ name: 'id', description: 'Pending transaction UUID' })
  @ApiResponse({ status: 200, type: SubmitTransactionResultDto })
  @ApiResponse({ status: 400, description: 'Transaction not ready or submission failed' })
  submitToNetwork(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubmitTransactionResultDto> {
    return this.multisigService.submitToNetwork(id);
  }
}
