import { encode as encodeBase64 } from '@stablelib/base64';
import { hash } from '@stablelib/sha512';
import { encode as encodeUTF8 } from '@stablelib/utf8';

export function computeStringHash(str: string) {
  const bytes = encodeUTF8(str);
  const result = hash(bytes);
  const b64 = encodeBase64(result);
  return b64;
}
