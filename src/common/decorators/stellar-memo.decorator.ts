import { SetMetadata } from '@nestjs/common';

export const STELLAR_MEMO_FIELD_KEY = 'stellar_memo_field';

export function StellarMemo() {
  return SetMetadata(STELLAR_MEMO_FIELD_KEY, true);
}
