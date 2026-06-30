import { SetMetadata, CustomDecorator } from '@nestjs/common';

export const TRANSACTIONAL_KEY = 'isTransactional';

export const Transactional = (): CustomDecorator => {
  return (target: object, key?: string | symbol, descriptor?: any) => {
    SetMetadata(TRANSACTIONAL_KEY, true)(target, key as string, descriptor);
  };
};
