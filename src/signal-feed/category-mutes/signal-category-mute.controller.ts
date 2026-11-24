import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SignalCategory } from '../../signals/entities/signal.entity';
import {
  CategoryMutePreferences,
  SignalCategoryMuteService,
} from './signal-category-mute.service';

export class UpdateMutedCategoriesDto {
  @ApiProperty({ enum: SignalCategory, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(SignalCategory, { each: true })
  mutedCategories!: SignalCategory[];

  @ApiPropertyOptional({ description: 'Version from the last read; 409 if stale' })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}

@ApiTags('signals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('signals/preferences/muted-categories')
export class SignalCategoryMuteController {
  constructor(private readonly service: SignalCategoryMuteService) {}

  @Get()
  @ApiOperation({ summary: 'Get muted signal categories for the current user' })
  get(@Req() req: any): Promise<CategoryMutePreferences> {
    return this.service.get(req.user.id);
  }

  @Put()
  @ApiOperation({ summary: 'Replace muted signal categories' })
  replace(@Req() req: any, @Body() dto: UpdateMutedCategoriesDto): Promise<CategoryMutePreferences> {
    return this.service.replace(req.user.id, dto.mutedCategories, dto.expectedVersion);
  }

  @Put(':category')
  @ApiOperation({ summary: 'Mute a single signal category' })
  mute(@Req() req: any, @Param('category') category: string): Promise<CategoryMutePreferences> {
    return this.service.mute(req.user.id, category);
  }

  @Delete(':category')
  @ApiOperation({ summary: 'Unmute a single signal category' })
  unmute(@Req() req: any, @Param('category') category: string): Promise<CategoryMutePreferences> {
    return this.service.unmute(req.user.id, category);
  }

  @Delete()
  @ApiOperation({ summary: 'Reset muted categories to defaults (none muted)' })
  reset(
    @Req() req: any,
    @Query('expectedVersion') expectedVersion?: string,
  ): Promise<CategoryMutePreferences> {
    return this.service.reset(
      req.user.id,
      expectedVersion !== undefined ? Number(expectedVersion) : undefined,
    );
  }
}
