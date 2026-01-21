import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE = 'isPublic';
export const IsPublic = () => SetMetadata(PUBLIC_ROUTE, true);
