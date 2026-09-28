import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { WithdrawalOtpService } from '../withdrawal-otp.service';

/**
 * Validates a withdrawal OTP before allowing the request to proceed.
 *
 * Expects the request body or headers to contain:
 *   - `withdrawalRequestId`: UUID of the pending withdrawal
 *   - `x-withdrawal-otp` header OR `otp` field in the body
 *
 * Must be composed after JwtAuthGuard so `req.user` is populated.
 */
@Injectable()
export class WithdrawalOtpGuard implements CanActivate {
  constructor(private readonly withdrawalOtpService: WithdrawalOtpService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('Authentication required.');
    }

    const withdrawalRequestId: string =
      request.body?.withdrawalRequestId ?? request.params?.withdrawalRequestId;

    if (!withdrawalRequestId) {
      throw new BadRequestException('withdrawalRequestId is required.');
    }

    const otp: string =
      request.headers?.['x-withdrawal-otp'] ?? request.body?.otp;

    if (!otp) {
      throw new BadRequestException(
        'OTP is required. Provide it via x-withdrawal-otp header or otp body field.',
      );
    }

    await this.withdrawalOtpService.verifyOtp(userId, withdrawalRequestId, otp);

    return true;
  }
}
