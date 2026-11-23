import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PerformanceWindowsQueryDto,
  ProviderWindowPerformanceDto,
} from './dto/performance-windows.dto';
import { ProviderWindowPerformanceService } from './services/provider-window-performance.service';

@ApiTags('provider-analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('providers')
export class ProviderWindowPerformanceController {
  constructor(private readonly service: ProviderWindowPerformanceService) {}

  @Get(':providerId/performance/windows')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @ApiOkResponse({ type: ProviderWindowPerformanceDto })
  getWindowPerformance(
    @Param('providerId', new ParseUUIDPipe()) providerId: string,
    @Query() query: PerformanceWindowsQueryDto,
  ): Promise<ProviderWindowPerformanceDto> {
    return this.service.getWindowPerformance(
      providerId,
      query.windows,
      query.asOf ? new Date(query.asOf) : new Date(),
    );
  }
}
