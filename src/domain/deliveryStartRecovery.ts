export interface MissingDeliveryStartInput {
  endAt: string;
  sortingEndAt?: string;
  previousEndAt?: string;
  zoneStartAt?: string;
  arriveAt?: string;
}

export interface MissingDeliveryStartResolution {
  at: string;
  correctionReason: string;
}

export function resolveMissingDeliveryStart(input: MissingDeliveryStartInput): MissingDeliveryStartResolution {
  const sortingEndAt = validAt(input.sortingEndAt);
  if (sortingEndAt) {
    return {
      at: clampToRange(sortingEndAt, input.zoneStartAt, input.endAt),
      correctionReason: "정리 완료 시각을 배송 시작으로 사용",
    };
  }

  const previousEndAt = validAt(input.previousEndAt);
  if (previousEndAt) {
    return {
      at: clampToRange(new Date(Date.parse(previousEndAt) + 5 * 60_000).toISOString(), input.zoneStartAt, input.endAt),
      correctionReason: "이전 구역 종료 + 5분을 배송 시작으로 사용",
    };
  }

  const zoneStartAt = validAt(input.zoneStartAt) ?? validAt(input.arriveAt) ?? input.endAt;
  return {
    at: clampToRange(zoneStartAt, input.zoneStartAt, input.endAt),
    correctionReason: "구역 시작 시각을 배송 시작으로 사용",
  };
}

function validAt(value?: string): string | undefined {
  return value && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function clampToRange(candidate: string, startAt: string | undefined, endAt: string): string {
  const startMs = startAt ? Date.parse(startAt) : Number.NaN;
  const endMs = Date.parse(endAt);
  const candidateMs = Date.parse(candidate);
  if (Number.isNaN(candidateMs)) return endAt;
  if (!Number.isNaN(startMs) && candidateMs < startMs) return startAt!;
  if (!Number.isNaN(endMs) && candidateMs > endMs) return endAt;
  return candidate;
}