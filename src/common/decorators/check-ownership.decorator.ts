import { SetMetadata } from '@nestjs/common';
import { EntityTarget } from 'typeorm';

export const OWNERSHIP_KEY = 'ownership_check';

export interface OwnershipMetadata {
  routeParam: string;
  entity: EntityTarget<{ id: string; userId: string }>;
}

export const CheckOwnership = (
  routeParam: string,
  entity: EntityTarget<{ id: string; userId: string }>,
) => SetMetadata(OWNERSHIP_KEY, { routeParam, entity } satisfies OwnershipMetadata);
