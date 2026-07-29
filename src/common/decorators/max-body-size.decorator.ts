import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { MaxBodySizeGuard, MAX_BODY_SIZE_KEY } from '../guards/max-body-size.guard';

export const MaxBodySize = (bytes: number) =>
  applyDecorators(
    SetMetadata(MAX_BODY_SIZE_KEY, bytes),
    UseGuards(MaxBodySizeGuard),
  );
