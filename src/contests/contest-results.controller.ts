import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import {
  CONTEST_CORRECTION_PERMISSION,
  ContestResultIntegrityService,
} from './contest-result-integrity.service';

export class ApplyContestCorrectionDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  eventIds!: string[];

  @IsString()
  @MinLength(3)
  reason!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedRevision?: number;
}

@ApiTags('contests')
@ApiBearerAuth()
@Controller('contests/:id/results')
export class ContestResultsController {
  constructor(private readonly integrity: ContestResultIntegrityService) {}

  @Get()
  @ApiOperation({ summary: 'Published contest results with revision number' })
  getResults(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.integrity.getPublishedResults(id);
  }

  @Get('pending-corrections')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(CONTEST_CORRECTION_PERMISSION)
  @ApiOperation({ summary: 'Late events quarantined after the finalization cutoff (Admin)' })
  listPending(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.integrity.listPendingCorrections(id);
  }

  @Post('corrections')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(CONTEST_CORRECTION_PERMISSION)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Apply quarantined late events to published results (Admin)' })
  applyCorrection(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApplyContestCorrectionDto,
    @Req() req: { user?: { id?: string; sub?: string; roles?: string[]; permissions?: string[] } },
  ) {
    const user = req.user ?? {};
    return this.integrity.applyCorrection(
      id,
      dto.eventIds,
      {
        id: String(user.id ?? user.sub ?? ''),
        roles: user.roles,
        // PermissionsGuard already enforced the permission for this route.
        permissions: [...(user.permissions ?? []), CONTEST_CORRECTION_PERMISSION],
      },
      dto.reason,
      dto.expectedRevision,
    );
  }
}
