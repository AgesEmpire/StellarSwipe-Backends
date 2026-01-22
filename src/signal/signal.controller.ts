import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { SignalsService } from './signals.service';
import { CreateSignalDto } from './dto/create-signal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // Assume auth is configured

@ApiTags('signals')
@Controller('signals')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SignalsController {
  private readonly logger = new Logger(SignalsController.name);

  constructor(private readonly signalsService: SignalsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a new trading signal',
    description:
      'Creates a new trading signal with stake verification, validation, and quality scoring',
  })
  @ApiBody({ type: CreateSignalDto })
  @ApiResponse({
    status: 201,
    description: 'Signal created successfully',
    schema: {
      example: {
        success: true,
        data: {
          signal: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            providerId: 'provider-123',
            providerAddress: 'GAXXX...XXXX',
            assetPair: 'USDC/XLM',
            action: 'BUY',
            entryPrice: 0.12,
            targetPrice: 0.15,
            stopLoss: 0.11,
            rationale:
              'Strong bullish momentum with RSI oversold. Breaking resistance at 0.12 with high volume.',
            qualityScore: 75,
            confidenceScore: 68.5,
            stakeAmount: '15000000000',
            status: 'ACTIVE',
            expiresAt: '2026-01-23T10:30:00.000Z',
            createdAt: '2026-01-22T10:30:00.000Z',
          },
          qualityScore: 75,
          confidenceScore: 68.5,
          stakeAmount: '15000000000',
        },
        message: 'Signal submitted successfully',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data',
    schema: {
      example: {
        statusCode: 400,
        message:
          'BUY signal: Target price must be greater than entry price',
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Insufficient stake or stake not active',
    schema: {
      example: {
        statusCode: 403,
        message:
          'Insufficient stake. Required: 1000 XLM, Current: 500 XLM',
        error: 'Forbidden',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Duplicate signal within 1 hour',
    schema: {
      example: {
        statusCode: 409,
        message:
          'Duplicate signal detected. You already submitted a signal for USDC/XLM within the last hour',
        error: 'Conflict',
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded',
    schema: {
      example: {
        statusCode: 429,
        message:
          'Rate limit exceeded. You can submit 10 signals per day. Your limit will reset at 2026-01-23T10:30:00.000Z',
        error: 'Too Many Requests',
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Unable to verify stake',
    schema: {
      example: {
        statusCode: 503,
        message:
          'Unable to verify stake at this time. Please try again later.',
        error: 'Service Unavailable',
      },
    },
  })
  async createSignal(
    @Body() createSignalDto: CreateSignalDto,
    @Request() req: any,
  ) {
    this.logger.log(
      `Signal submission request from provider: ${req.user.id}`,
    );

    const result = await this.signalsService.createSignal(
      createSignalDto,
      req.user.id,
      req.user.stellarAddress, // Assumes JWT payload contains Stellar address
    );

    return {
      success: true,
      data: result,
      message: 'Signal submitted successfully',
    };
  }

  @Get()
  @ApiOperation({
    summary: 'Get all active signals',
    description:
      'Retrieves all active signals sorted by confidence score',
  })
  @ApiResponse({
    status: 200,
    description: 'List of active signals',
  })
  async getActiveSignals() {
    const signals = await this.signalsService.getActiveSignals();

    return {
      success: true,
      data: signals,
      count: signals.length,
    };
  }

  @Get('my-signals')
  @ApiOperation({
    summary: 'Get current user signals',
    description: 'Retrieves all signals submitted by the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'List of user signals',
  })
  async getMySignals(@Request() req: any) {
    const signals = await this.signalsService.getProviderSignals(
      req.user.id,
    );

    return {
      success: true,
      data: signals,
      count: signals.length,
    };
  }

  @Get('my-stats')
  @ApiOperation({
    summary: 'Get current user statistics',
    description:
      'Retrieves statistics for the authenticated user including rate limit info',
  })
  @ApiResponse({
    status: 200,
    description: 'User statistics',
    schema: {
      example: {
        success: true,
        data: {
          totalSignals: 45,
          activeSignals: 8,
          todaySignals: 3,
          remainingToday: 7,
          averageConfidence: '72.45',
        },
      },
    },
  })
  async getMyStats(@Request() req: any) {
    const stats = await this.signalsService.getProviderStats(req.user.id);

    return {
      success: true,
      data: stats,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get signal by ID',
    description: 'Retrieves a specific signal by its ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Signal details',
  })
  @ApiResponse({
    status: 404,
    description: 'Signal not found',
  })
  async getSignalById(@Param('id') id: string) {
    const signal = await this.signalsService.getSignalById(id);

    if (!signal) {
      return {
        success: false,
        message: 'Signal not found',
      };
    }

    return {
      success: true,
      data: signal,
    };
  }
}