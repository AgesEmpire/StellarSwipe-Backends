import { SetMetadata } from '@nestjs/common';

export const TRANSACTIONAL_KEY = 'isTransactional';

export const Transactional = (): MethodDecorator => {
  return (target: object, key: string | symbol, descriptor: PropertyDescriptor) => {
    SetMetadata(TRANSACTIONAL_KEY, true)(target, key, descriptor);
  };
};
