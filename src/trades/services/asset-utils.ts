import { BadRequestException } from "@nestjs/common";
import { Asset } from "@stellar/stellar-sdk";

export const buildAsset = (
  code: string,
  issuer: string | undefined,
  label: string,
): Asset => {
  if (code === "XLM") {
    return Asset.native();
  }

  if (!issuer) {
    throw new BadRequestException(
      `${label} issuer is required for non-native assets`,
    );
  }

  return new Asset(code, issuer);
};
