export interface QuantityValidationInput {
  zoneName: string;
  entered: number;
  hasValue: boolean;
  expectedTotal?: number;
  completedOther: number;
  maxReasonable: number;
}

export interface QuantityValidationResult {
  ok: boolean;
  value: number;
  message?: string;
  suggestedValue?: number;
  suggestionReason?: "looks_like_day_total";
  warning?: string;
}

export function validateZoneQuantity(input: QuantityValidationInput): QuantityValidationResult {
  const expectedTotal = normalizePositive(input.expectedTotal);
  const completedOther = Math.max(0, input.completedOther);

  if (!input.hasValue) {
    return {
      ok: false,
      value: 0,
      message: `${input.zoneName} 수량이 비어 있습니다.`,
    };
  }

  if (!Number.isFinite(input.entered) || input.entered <= 0) {
    return {
      ok: false,
      value: input.entered,
      message: `${input.zoneName} 수량은 1개 이상이어야 합니다.`,
    };
  }

  const dayTotalTolerance = expectedTotal !== undefined ? Math.max(10, Math.ceil(expectedTotal * 0.1)) : 0;
  const looksLikeDayTotal =
    expectedTotal !== undefined &&
    completedOther > 0 &&
    input.entered >= expectedTotal - dayTotalTolerance &&
    input.entered <= expectedTotal + dayTotalTolerance &&
    input.entered - completedOther > 0 &&
    input.entered - completedOther <= input.maxReasonable;

  if (looksLikeDayTotal) {
    return {
      ok: true,
      value: input.entered,
      suggestedValue: input.entered - completedOther,
      suggestionReason: "looks_like_day_total",
      message:
        `${input.entered}개는 당일 전체 수량처럼 보입니다. ` +
        `이미 완료한 ${completedOther}개를 빼면 ${input.entered - completedOther}개입니다.`,
    };
  }

  if (expectedTotal !== undefined) {
    const tolerance = Math.max(10, Math.ceil(expectedTotal * 0.1));
    if (input.entered + completedOther > expectedTotal + tolerance) {
      return {
        ok: true,
        value: input.entered,
        warning:
          `${input.zoneName}까지 합계 ${input.entered + completedOther}개입니다. ` +
          `예상 수량 ${expectedTotal}개보다 많이 큽니다.`,
      };
    }
  }

  if (input.entered > input.maxReasonable) {
    return {
      ok: true,
      value: input.entered,
      warning: `${input.zoneName} ${input.entered}개가 입력됐습니다. 너무 큰 값일 수 있습니다.`,
    };
  }

  return {
    ok: true,
    value: input.entered,
  };
}

export function resolveMijuDetailQuantity(input: {
  total: number;
  totalHasValue: boolean;
  one: number;
  two: number;
  three: number;
  rest: number;
  restHasValue: boolean;
}): {
  ok: boolean;
  message?: string;
  one: number;
  two: number;
  three: number;
  rest: number;
  aTotal: number;
  detailTotal: number;
  delivered: number;
  hasDetail: boolean;
  autoCalculatedRest: boolean;
} {
  const aTotal = input.one + input.two + input.three;
  const hasDetail = aTotal > 0 || input.restHasValue;

  if (!hasDetail) {
    return {
      ok: true,
      one: 0,
      two: 0,
      three: 0,
      rest: 0,
      aTotal: 0,
      detailTotal: 0,
      delivered: input.total,
      hasDetail: false,
      autoCalculatedRest: false,
    };
  }

  if (input.totalHasValue) {
    if (input.total < aTotal) {
      return {
        ok: false,
        message: `총합 ${input.total}개가 1/2/3동 합계 ${aTotal}개보다 작습니다.`,
        one: input.one,
        two: input.two,
        three: input.three,
        rest: input.rest,
        aTotal,
        detailTotal: aTotal + input.rest,
        delivered: input.total,
        hasDetail,
        autoCalculatedRest: false,
      };
    }

    if (!input.restHasValue || input.rest === 0) {
      const rest = input.total - aTotal;
      return {
        ok: true,
        one: input.one,
        two: input.two,
        three: input.three,
        rest,
        aTotal,
        detailTotal: input.total,
        delivered: input.total,
        hasDetail: true,
        autoCalculatedRest: rest !== input.rest,
      };
    }
  }

  const detailTotal = aTotal + input.rest;
  return {
    ok: true,
    one: input.one,
    two: input.two,
    three: input.three,
    rest: input.rest,
    aTotal,
    detailTotal,
    delivered: detailTotal,
    hasDetail: true,
    autoCalculatedRest: false,
  };
}

function normalizePositive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
