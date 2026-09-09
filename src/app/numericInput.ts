// Never turn a mistyped sign, decimal or exponent into a different valid number.
export function parseUnsignedInput(raw: string, maxDigits: number): { value: number; hasValue: boolean } {
  if (raw === "") return { value: 0, hasValue: false };
  if (!new RegExp("^\\d{1," + maxDigits + "}$").test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error("입력값을 확인하세요. 기호나 소수 없이 0 이상의 정수로 입력하세요.");
  }
  return { value: Number(raw), hasValue: true };
}
