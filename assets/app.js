// src/domain/eventTimeline.ts
function createEvent(dayRecord, input) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const event = {
    id: input.id ?? createEventId(input.type, input.at, dayRecord.timeline),
    type: input.type,
    at: input.at,
    zoneId: input.zoneId,
    payload: input.payload,
    note: input.note,
    source: input.source ?? "manual",
    createdAt: now,
    updatedAt: now
  };
  return withTimeline(dayRecord, [...dayRecord.timeline, event]);
}
function updateEvent(dayRecord, eventId2, patch) {
  let found = false;
  const updatedTimeline = dayRecord.timeline.map((event) => {
    if (event.id !== eventId2) {
      return event;
    }
    found = true;
    return {
      ...event,
      ...patch,
      id: event.id,
      createdAt: event.createdAt,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  });
  if (!found) {
    return dayRecord;
  }
  return withTimeline(dayRecord, updatedTimeline);
}
function sortTimeline(timeline) {
  return [...timeline].sort((a, b) => {
    const byTime = Date.parse(a.at) - Date.parse(b.at);
    if (byTime !== 0) {
      return byTime;
    }
    return a.id.localeCompare(b.id);
  });
}
function deriveLog(dayRecord) {
  return sortTimeline(dayRecord.timeline).map((event) => ({
    id: `log-${event.id}`,
    eventId: event.id,
    at: event.at,
    label: getEventLabel(event),
    zoneId: event.zoneId,
    detail: getEventDetail(event)
  }));
}
function withTimeline(dayRecord, timeline) {
  return {
    ...dayRecord,
    timeline: sortTimeline(timeline),
    meta: {
      ...dayRecord.meta,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  };
}
function createEventId(type, at, existing) {
  const datePart = at.replace(/[^0-9]/g, "").slice(0, 14) || "event";
  const base = `${type}-${datePart}`;
  if (!existing.some((event) => event.id === base)) {
    return base;
  }
  let index = 2;
  while (existing.some((event) => event.id === `${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}
function getEventLabel(event) {
  switch (event.type) {
    case "depart_jinjeop":
      return "\uC9C4\uC811 \uCD9C\uBC1C";
    case "arrive_cheongnyangni":
      return "\uCCAD\uB7C9\uB9AC \uB3C4\uCC29";
    case "zone_start":
      return "\uAD6C\uC5ED \uC2DC\uC791";
    case "sorting_start":
      return "\uC815\uB9AC \uC2DC\uC791";
    case "sorting_end":
      return "\uC815\uB9AC \uC644\uB8CC";
    case "delivery_start":
      return "\uBC30\uC1A1 \uC2DC\uC791";
    case "zone_end":
      return "\uAD6C\uC5ED \uC644\uB8CC";
    case "helper_add":
      return "\uB3C4\uC6B0\uBBF8 \uAE30\uB85D";
    case "incident":
      return "\uD2B9\uC774\uC0AC\uD56D";
    case "day_close":
      return "\uC5C5\uBB34 \uC885\uB8CC";
    case "manual_adjust":
      return "\uC218\uB3D9 \uBCF4\uC815";
    default:
      return event.type;
  }
}
function getEventDetail(event) {
  const parts = [];
  if (event.zoneId) {
    parts.push(`zone=${event.zoneId}`);
  }
  if (event.payload) {
    const payloadSummary = summarizePayload(event.payload);
    if (payloadSummary) {
      parts.push(payloadSummary);
    }
  }
  if (event.note) {
    parts.push(event.note);
  }
  return parts.length > 0 ? parts.join(" / ") : void 0;
}
function summarizePayload(payload) {
  const entries = Object.entries(payload).filter(([, value]) => value !== void 0 && value !== "").map(([key, value]) => `${key}=${String(value)}`);
  return entries.length > 0 ? entries.join(", ") : void 0;
}

// src/domain/cleanupCorrection.ts
function hasMissingCleanupFinish(dayRecord, zoneId) {
  const zoneEvents = dayRecord.timeline.filter((event) => event.zoneId === zoneId);
  const hasSortingStart = zoneEvents.some((event) => event.type === "sorting_start");
  const hasSortingEnd = zoneEvents.some((event) => event.type === "sorting_end");
  return hasSortingStart && !hasSortingEnd;
}
function applyMissingCleanupCorrection(dayRecord, request) {
  if (!Number.isFinite(request.minutes) || request.minutes <= 0) {
    throw new Error("cleanup correction minutes must be greater than 0");
  }
  const closeTime = Date.parse(request.closeAt);
  if (Number.isNaN(closeTime)) {
    throw new Error("cleanup correction closeAt must be a valid ISO date");
  }
  const sortingStartAt = new Date(closeTime - request.minutes * 6e4).toISOString();
  const sortingEndAt = new Date(closeTime).toISOString();
  const source = request.source ?? "zone_close_prompt";
  const note = request.note ?? "Missing cleanup finish corrected from field prompt.";
  const existingStart = findLatestZoneEvent(dayRecord, request.zoneId, "sorting_start");
  const existingEnd = findLatestZoneEvent(dayRecord, request.zoneId, "sorting_end");
  let next = dayRecord;
  let sortingStartId;
  let sortingEndId;
  if (existingStart) {
    sortingStartId = existingStart.id;
    next = updateEvent(next, existingStart.id, {
      at: sortingStartAt,
      note
    });
  } else {
    next = createEvent(next, {
      type: "sorting_start",
      at: sortingStartAt,
      zoneId: request.zoneId,
      note
    });
    sortingStartId = next.timeline.find(
      (event) => event.type === "sorting_start" && event.zoneId === request.zoneId && event.at === sortingStartAt
    )?.id ?? "";
  }
  if (existingEnd) {
    sortingEndId = existingEnd.id;
    next = updateEvent(next, existingEnd.id, {
      at: sortingEndAt,
      note: `cleanup ${request.minutes} minutes corrected by ${source}`
    });
  } else {
    next = createEvent(next, {
      type: "sorting_end",
      at: sortingEndAt,
      zoneId: request.zoneId,
      note: `cleanup ${request.minutes} minutes corrected by ${source}`
    });
    sortingEndId = next.timeline.find(
      (event) => event.type === "sorting_end" && event.zoneId === request.zoneId && event.at === sortingEndAt
    )?.id ?? "";
  }
  next = {
    ...next,
    zones: next.zones.map(
      (zone) => zone.id === request.zoneId ? {
        ...zone,
        sortingStartEventId: sortingStartId || zone.sortingStartEventId,
        sortingEndEventId: sortingEndId || zone.sortingEndEventId
      } : zone
    ),
    adjustments: [
      ...next.adjustments,
      {
        id: `cleanup-correction-${Date.now()}`,
        eventId: sortingEndId || void 0,
        reason: "missing_cleanup_finish",
        note: `cleanup=${request.minutes} min, anchor=${request.closeAt}, source=${source}`,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    ]
  };
  return {
    dayRecord: next,
    sortingStartAt,
    sortingEndAt,
    minutes: request.minutes,
    sourceEventIds: [sortingStartId, sortingEndId].filter(Boolean)
  };
}
function findLatestZoneEvent(dayRecord, zoneId, type) {
  return [...dayRecord.timeline].filter((event) => event.zoneId === zoneId && event.type === type).sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0];
}

// src/domain/zoneEdit.ts
function applyCompletedZoneEdit(dayRecord, input) {
  const zone = dayRecord.zones.find((candidate) => candidate.id === input.zoneId);
  if (!zone) return dayRecord;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updates = buildEventUpdates(dayRecord, input);
  if (updates.size === 0) return dayRecord;
  const timeline = sortTimeline(dayRecord.timeline.map((event) => {
    const patch = updates.get(event.id);
    return patch ? { ...event, ...patch, updatedAt: now } : event;
  }));
  const adjustment = {
    id: createAdjustmentId(dayRecord, now),
    eventId: zone.endEventId,
    reason: input.reason ?? "completed_zone_edit",
    note: `Edited completed zone ${zone.id}`,
    createdAt: now
  };
  return {
    ...dayRecord,
    timeline,
    zones: dayRecord.zones.map(
      (candidate) => candidate.id === zone.id ? {
        ...candidate,
        counts: void 0,
        countsSourceEventIds: void 0,
        countsCalculatedAt: void 0
      } : candidate
    ),
    adjustments: [...dayRecord.adjustments, adjustment],
    meta: {
      ...dayRecord.meta,
      updatedAt: now,
      recoveryStatus: dayRecord.meta.recoveryStatus === "none" ? "needsReview" : dayRecord.meta.recoveryStatus
    }
  };
}
function buildEventUpdates(dayRecord, input) {
  const updates = /* @__PURE__ */ new Map();
  const start = findZoneEvent(dayRecord, input.zoneId, "zone_start");
  const sortingStart = findZoneEvent(dayRecord, input.zoneId, "sorting_start");
  const sortingEnd = findZoneEvent(dayRecord, input.zoneId, "sorting_end");
  const end = findZoneEvent(dayRecord, input.zoneId, "zone_end");
  if (start && input.startAt) updates.set(start.id, { at: input.startAt });
  if (sortingStart && input.sortingStartAt) updates.set(sortingStart.id, { at: input.sortingStartAt });
  if (sortingEnd && input.sortingEndAt) updates.set(sortingEnd.id, { at: input.sortingEndAt });
  if (end) {
    const nextPayload = buildZoneEndPayload(end.payload, input);
    const patch = {};
    if (input.endAt) patch.at = input.endAt;
    if (nextPayload) patch.payload = nextPayload;
    if (Object.keys(patch).length > 0) updates.set(end.id, patch);
  }
  return updates;
}
function buildZoneEndPayload(payload, input) {
  const previous = payload && typeof payload === "object" ? payload : {};
  const failed = input.failed ?? numberOr(previous.failed, 0);
  const extra = input.extra ?? numberOr(previous.extra, 0);
  const hasMijuBuildings = input.miju1 !== void 0 || input.miju2 !== void 0 || input.miju3 !== void 0 || input.mijuRest !== void 0;
  const delivered = hasMijuBuildings ? (input.miju1 ?? 0) + (input.miju2 ?? 0) + (input.miju3 ?? 0) + (input.mijuRest ?? 0) : input.mijuA !== void 0 || input.mijuB !== void 0 ? (input.mijuA ?? 0) + (input.mijuB ?? 0) : input.delivered;
  if (delivered === void 0 && input.failed === void 0 && input.extra === void 0) {
    return void 0;
  }
  return {
    ...previous,
    total: delivered ?? numberOr(previous.total, 0),
    delivered: delivered ?? numberOr(previous.delivered, 0),
    failed,
    extra,
    ...hasMijuBuildings ? {
      building1Total: input.miju1 ?? 0,
      building2Total: input.miju2 ?? 0,
      building3Total: input.miju3 ?? 0,
      restTotal: input.mijuRest ?? 0,
      aTotal: (input.miju1 ?? 0) + (input.miju2 ?? 0) + (input.miju3 ?? 0),
      bTotal: input.mijuRest ?? 0
    } : {},
    ...input.mijuA !== void 0 || input.mijuB !== void 0 ? { aTotal: input.mijuA ?? 0, bTotal: input.mijuB ?? 0 } : {}
  };
}
function findZoneEvent(dayRecord, zoneId, type) {
  return sortTimeline(dayRecord.timeline).find((event) => event.zoneId === zoneId && event.type === type);
}
function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function createAdjustmentId(dayRecord, now) {
  const base = `adjust-${now.replace(/[^0-9]/g, "").slice(0, 14)}`;
  if (!dayRecord.adjustments.some((adjustment) => adjustment.id === base)) return base;
  let index = 2;
  while (dayRecord.adjustments.some((adjustment) => adjustment.id === `${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

// src/domain/deliveryCalc.ts
function calculateDay(dayRecord) {
  const warnings = [];
  const zones = dayRecord.zones.map(
    (zone) => calculateZone(dayRecord, zone.id, warnings)
  );
  const totals = calculateTotals(dayRecord, zones);
  return {
    date: dayRecord.date,
    zones,
    totals,
    warnings
  };
}
function calculateZone(dayRecord, zoneId, warnings = []) {
  const zone = dayRecord.zones.find((candidate) => candidate.id === zoneId);
  const zoneEvents = sortTimeline(
    dayRecord.timeline.filter((event) => event.zoneId === zoneId)
  );
  const sourceEventIds = /* @__PURE__ */ new Set();
  if (!zone) {
    warnings.push({
      code: "missing_zone",
      message: `Missing zone: ${zoneId}`,
      zoneId
    });
  }
  const start = findEventTime(dayRecord, zone?.startEventId, "zone_start", zoneId);
  const sortingStart = findEventTime(
    dayRecord,
    zone?.sortingStartEventId,
    "sorting_start",
    zoneId
  );
  const sortingEnd = findEventTime(
    dayRecord,
    zone?.sortingEndEventId,
    "sorting_end",
    zoneId
  );
  const deliveryStart = findEventTime(
    dayRecord,
    zone?.deliveryStartEventId,
    "delivery_start",
    zoneId
  );
  const end = findEventTime(dayRecord, zone?.endEventId, "zone_end", zoneId);
  const counts = calculateZoneCounts(zoneEvents, sourceEventIds);
  warnIfMissing(warnings, zoneId, "zone_start", start, zone?.startEventId);
  warnIfMissing(warnings, zoneId, "zone_end", end, zone?.endEventId);
  const elapsedMinutes = diffMinutes(start, end);
  const movementMinutes = calculateMovementMinutes(dayRecord, zoneId, sortingStart);
  const sortingMinutes = diffMinutes(sortingStart, sortingEnd);
  const baseDeliveryMinutes = calculateDeliveryMinutes({
    start,
    movementMinutes,
    sortingStart,
    sortingEnd,
    deliveryStart,
    end
  });
  const eventMinutes = calculateIncidentMinutes(zoneEvents, sourceEventIds);
  const deliveryMinutes = baseDeliveryMinutes === void 0 ? void 0 : Math.max(0, baseDeliveryMinutes - eventMinutes);
  const efficiencyPerHour = calculateEfficiencyPerHour(counts.delivered, deliveryMinutes);
  return {
    zoneId,
    elapsedMinutes,
    movementMinutes,
    sortingMinutes,
    deliveryMinutes,
    eventMinutes,
    counts,
    efficiencyPerHour,
    sourceEventIds: [...sourceEventIds]
  };
}
function calculateTotals(dayRecord, zones) {
  const firstEvent2 = sortTimeline(dayRecord.timeline)[0];
  const closeEvent = [...sortTimeline(dayRecord.timeline)].reverse().find((event) => event.type === "day_close");
  const deliveryMinutes = sumDefined(zones.map((zone) => zone.deliveryMinutes));
  const deliveredCount = sumDefined(zones.map((zone) => zone.counts.delivered));
  return {
    totalCount: sumDefined(zones.map((zone) => zone.counts.total)),
    deliveredCount,
    failedCount: sumDefined(zones.map((zone) => zone.counts.failed)),
    extraCount: sumDefined(zones.map((zone) => zone.counts.extra)),
    totalElapsedMinutes: diffMinutes(firstEvent2?.at, closeEvent?.at),
    deliveryMinutes,
    efficiencyPerHour: calculateEfficiencyPerHour(deliveredCount, deliveryMinutes)
  };
}
function calculateEfficiencyPerHour(deliveredCount, deliveryMinutes) {
  if (deliveryMinutes === void 0 || deliveryMinutes < 1) return void 0;
  return deliveredCount / (deliveryMinutes / 60);
}
function calculateZoneCounts(zoneEvents, sourceEventIds) {
  const counts = {
    total: 0,
    delivered: 0,
    failed: 0,
    extra: 0
  };
  for (const event of zoneEvents) {
    if (!event.payload) {
      continue;
    }
    if (event.type === "manual_adjust") {
      applyManualAdjust(counts, event, sourceEventIds);
      continue;
    }
    const payload = event.payload;
    let used = false;
    if (typeof payload.total === "number") {
      counts.total = payload.total;
      used = true;
    }
    if (typeof payload.delivered === "number") {
      counts.delivered = payload.delivered;
      used = true;
    }
    if (typeof payload.failed === "number") {
      counts.failed = payload.failed;
      used = true;
    }
    if (typeof payload.extra === "number") {
      counts.extra = payload.extra;
      used = true;
    }
    if (used) {
      sourceEventIds.add(event.id);
    }
  }
  return counts;
}
function applyManualAdjust(counts, event, sourceEventIds) {
  const payload = event.payload;
  if (typeof payload.after !== "number") {
    return;
  }
  switch (payload.field) {
    case "payload.total":
    case "total":
      counts.total = payload.after;
      sourceEventIds.add(event.id);
      break;
    case "payload.delivered":
    case "delivered":
      counts.delivered = payload.after;
      sourceEventIds.add(event.id);
      break;
    case "payload.failed":
    case "failed":
      counts.failed = payload.after;
      sourceEventIds.add(event.id);
      break;
    case "payload.extra":
    case "extra":
      counts.extra = payload.after;
      sourceEventIds.add(event.id);
      break;
    default:
      break;
  }
}
function calculateIncidentMinutes(zoneEvents, sourceEventIds) {
  let total = 0;
  for (const event of zoneEvents) {
    if (event.type !== "incident" || !event.payload) continue;
    const payload = event.payload;
    if (payload.affectsEfficiency === false || typeof payload.minutes !== "number") continue;
    if (payload.minutes <= 0) continue;
    total += payload.minutes;
    sourceEventIds.add(event.id);
  }
  return total;
}
function findEventTime(dayRecord, eventId2, type, zoneId) {
  if (eventId2) {
    return dayRecord.timeline.find((event) => event.id === eventId2)?.at;
  }
  return sortTimeline(dayRecord.timeline).find(
    (event) => event.zoneId === zoneId && event.type === type
  )?.at;
}
function warnIfMissing(warnings, zoneId, eventType, value, eventId2) {
  if (value) {
    return;
  }
  warnings.push({
    code: "missing_calculation_event",
    message: `Missing ${eventType} for zone ${zoneId}`,
    eventIds: eventId2 ? [eventId2] : void 0,
    zoneId
  });
}
function diffMinutes(start, end) {
  if (!start || !end) {
    return void 0;
  }
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return void 0;
  }
  return (endMs - startMs) / 6e4;
}
function calculateMovementMinutes(dayRecord, zoneId, sortingStart) {
  const zone = dayRecord.zones.find((candidate) => candidate.id === zoneId);
  if (!zone || zone.order <= 1 || !sortingStart) {
    return void 0;
  }
  const previousZone = [...dayRecord.zones].filter((candidate) => candidate.order < zone.order).sort((a, b) => b.order - a.order)[0];
  if (!previousZone) {
    return void 0;
  }
  const previousEnd = findEventTime(
    dayRecord,
    previousZone.endEventId,
    "zone_end",
    previousZone.id
  );
  const minutes = diffMinutes(previousEnd, sortingStart);
  if (minutes === void 0) {
    return void 0;
  }
  return minutes < 1 ? 5 : minutes;
}
function calculateDeliveryMinutes(input) {
  const { start, movementMinutes, sortingStart, sortingEnd, deliveryStart, end } = input;
  if (!start || !end) {
    return void 0;
  }
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const sortingStartMs = sortingStart ? Date.parse(sortingStart) : void 0;
  const sortingEndMs = sortingEnd ? Date.parse(sortingEnd) : void 0;
  const deliveryStartMs = deliveryStart ? Date.parse(deliveryStart) : void 0;
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return void 0;
  }
  if (deliveryStartMs !== void 0 && !Number.isNaN(deliveryStartMs)) {
    if (sortingStartMs !== void 0 && !Number.isNaN(sortingStartMs) && sortingStartMs > deliveryStartMs && sortingStartMs <= endMs) {
      return (sortingStartMs - deliveryStartMs) / 6e4;
    }
    return endMs >= deliveryStartMs ? (endMs - deliveryStartMs) / 6e4 : void 0;
  }
  if (sortingStartMs !== void 0 && sortingEndMs !== void 0 && !Number.isNaN(sortingStartMs) && !Number.isNaN(sortingEndMs) && sortingStartMs >= startMs && sortingEndMs <= endMs) {
    const elapsed = endMs - startMs;
    const sorting = sortingEndMs - sortingStartMs;
    const movement = (movementMinutes ?? 0) * 6e4;
    if (sorting < 0 || elapsed < sorting) {
      return void 0;
    }
    return Math.max(0, (elapsed - sorting - movement) / 6e4);
  }
  return (endMs - startMs) / 6e4;
}
function sumDefined(values) {
  return values.reduce((sum, value) => sum + (value ?? 0), 0);
}

// src/domain/reportBuilder.ts
function buildDailyReport(dayRecord, calculation, options = {}) {
  const sourceEventIds = dayRecord.timeline.map((event) => event.id);
  const expected = getExpectedTotal(dayRecord);
  const scanMiss = expected === void 0 ? void 0 : calculation.totals.totalCount - expected;
  const depart = firstEvent(dayRecord, "depart_jinjeop");
  const arrive = firstEvent(dayRecord, "arrive_cheongnyangni");
  const close = lastEvent(dayRecord, "day_close");
  const driveMinutes = diffMinutes2(depart?.at, arrive?.at);
  const regularEfficiency = calculation.totals.efficiencyPerHour;
  const title = options.title ?? "\uC77C\uC77C \uD0DD\uBC30 \uB9C8\uC2A4\uD130 Report";
  const lines = [
    "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
    `\u{1F4E6} ${title}`,
    "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
    `\uB0A0\uC9DC: ${formatKoreanDate(dayRecord.date)}`,
    `\uAE30\uB85D \uD0A4: ${dayRecord.date}`,
    "",
    "[\uD1B5\uD569 \uBD84\uC11D]",
    `\uCD1D \uBC30\uC1A1 \uC218\uB7C9: ${calculation.totals.totalCount}\uAC1C`,
    `\uC608\uC0C1 \uC218\uB7C9:   ${expectedText(expected, scanMiss)}`,
    `\uC804\uCCB4 \uC5C5\uBB34:   \uC9C4\uC811 ${formatClock(depart?.at)} \uCD9C\uBC1C`,
    `             \uCD5C\uC885 \uC885\uB8CC ${formatClock(close?.at)}`,
    `\uC21C\uC218 \uC6B4\uC804:   \uC9C4\uC811\u2192\uCCAD\uB7C9\uB9AC ${formatMinutes(driveMinutes)}`,
    `\uC804\uCCB4 \uD3C9\uADE0:   \uC2DC\uAC04\uB2F9 ${formatWholeEfficiency(regularEfficiency)}`,
    "",
    "[\uAD6C\uC5ED\uBCC4 \uC0C1\uC138]",
    ...calculation.zones.flatMap((zone, index) => buildZoneDetailLines(dayRecord, zone, index)),
    "",
    "[\uC0C1\uC138 \uD6A8\uC728]",
    ...calculation.zones.flatMap((zone, index) => buildZoneEfficiencyLines(dayRecord, zone, index)),
    "",
    "[\uC815\uADDC \uD6A8\uC728 (\uB300\uCCB4\uBC30\uC1A1 \uC81C\uC678)]",
    `  \uC2DC\uAC04\uB2F9 ${formatWholeEfficiency(regularEfficiency)}`
  ];
  const incidents = dayRecord.timeline.filter((event) => event.type === "incident");
  if (incidents.length > 0) {
    lines.push("", "[\uC774\uBCA4\uD2B8]");
    for (const event of incidents) {
      const payload = event.payload;
      const titleText = typeof payload?.title === "string" ? payload.title : "\uC774\uBCA4\uD2B8";
      const minutesText = typeof payload?.minutes === "number" ? `${payload.minutes}\uBD84` : "\uC2DC\uAC04 \uBBF8\uC785\uB825";
      const zoneName = event.zoneId ? getZoneName(dayRecord, event.zoneId) : "\uC804\uCCB4";
      lines.push(`  ${formatClock(event.at)} ${titleText} ${minutesText} \xB7 ${zoneName}`);
    }
  }
  if (options.includeWarnings !== false && calculation.warnings.length > 0) {
    lines.push("", "[\uD655\uC778 \uD544\uC694]");
    for (const warning of calculation.warnings) {
      lines.push(`- ${warning.code}: ${warning.message}`);
    }
  }
  lines.push("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501");
  return {
    date: dayRecord.date,
    text: lines.join("\n"),
    sourceEventIds,
    warnings: calculation.warnings
  };
}
function buildPreviewModel(dayRecord, calculation) {
  return {
    date: dayRecord.date,
    status: dayRecord.status,
    zoneCount: calculation.zones.length,
    totalCount: calculation.totals.totalCount,
    deliveredCount: calculation.totals.deliveredCount,
    failedCount: calculation.totals.failedCount,
    deliveryMinutes: calculation.totals.deliveryMinutes,
    efficiencyPerHour: calculation.totals.efficiencyPerHour,
    sourceEventIds: dayRecord.timeline.map((event) => event.id)
  };
}
function buildZoneDetailLines(dayRecord, zone, index) {
  const zoneName = getZoneName(dayRecord, zone.zoneId);
  const start = firstZoneEvent(dayRecord, zone.zoneId, "zone_start");
  const end = firstZoneEvent(dayRecord, zone.zoneId, "zone_end");
  const sortingStart = firstZoneEvent(dayRecord, zone.zoneId, "sorting_start");
  const sortingEnd = firstZoneEvent(dayRecord, zone.zoneId, "sorting_end");
  const payload = end?.payload;
  const lines = [
    `${index + 1}\uAD6C\uC5ED (${zoneName})`,
    `  \uC2DC\uC791 ${formatClock(start?.at)} ~ \uC885\uB8CC ${formatClock(end?.at)}`,
    `  \uC2E4\uC81C \uBC30\uC1A1 \uC18C\uC694: ${formatMinutes(zone.deliveryMinutes)}`,
    `  \uBC30\uC1A1 \uC218\uB7C9: ${zone.counts.delivered}\uAC1C`
  ];
  if (zone.zoneId === "miju") {
    const aTotal = numberOr2(payload?.aTotal, sumNumbers(payload?.building1Total, payload?.building2Total, payload?.building3Total));
    const bTotal = numberOr2(payload?.restTotal, numberOr2(payload?.bTotal, Math.max(0, zone.counts.delivered - aTotal)));
    lines.push(`  A\uAD6C\uAC04(1,2,3\uB3D9): ${aTotal}\uAC1C`);
    lines.push(`  B\uAD6C\uAC04(5,6,7,8\uB3D9): ${bTotal}\uAC1C`);
  }
  if (sortingStart || sortingEnd) {
    lines.push(`  \uC815\uB9AC: ${formatClock(sortingStart?.at)} ~ ${formatClock(sortingEnd?.at)} (${formatMinutes(zone.sortingMinutes)})`);
  }
  lines.push(`  \uC2E4\uC81C \uD6A8\uC728: \uC2DC\uAC04\uB2F9 ${formatWholeEfficiency(zone.efficiencyPerHour)}`);
  lines.push(`  \uC804\uCCB4 \uD6A8\uC728: \uC2DC\uAC04\uB2F9 ${formatWholeEfficiency(calculateEfficiency(zone.counts.delivered, zone.elapsedMinutes))}`);
  if (zone.eventMinutes && zone.eventMinutes > 0) {
    lines.push(`  \uC774\uBCA4\uD2B8: ${formatMinutes(zone.eventMinutes)}`);
  }
  return lines;
}
function buildZoneEfficiencyLines(dayRecord, zone, index) {
  const zoneName = getZoneName(dayRecord, zone.zoneId);
  return [
    `${index + 1}\uAD6C\uC5ED ${zoneName}:`,
    `  \uC2E4\uC81C \uBC30\uC1A1 \uD6A8\uC728:  \uC2DC\uAC04\uB2F9 ${formatWholeEfficiency(zone.efficiencyPerHour)}`,
    `  \uC804\uCCB4 \uC5C5\uBB34 \uD6A8\uC728:  \uC2DC\uAC04\uB2F9 ${formatWholeEfficiency(calculateEfficiency(zone.counts.delivered, zone.elapsedMinutes))}`,
    `  \uC774\uBCA4\uD2B8 \uBCF4\uC815 \uD6A8\uC728: \uC2DC\uAC04\uB2F9 ${formatWholeEfficiency(zone.efficiencyPerHour)}`
  ];
}
function getExpectedTotal(dayRecord) {
  const depart = firstEvent(dayRecord, "depart_jinjeop");
  const payload = depart?.payload;
  return typeof payload?.total === "number" ? payload.total : void 0;
}
function expectedText(expected, scanMiss) {
  if (expected === void 0) return "\uBBF8\uC785\uB825";
  if (scanMiss === void 0 || scanMiss === 0) return `${expected}\uAC1C`;
  return `${expected}\uAC1C (\uC2A4\uCE94\uBBF8\uC2A4 ${scanMiss > 0 ? "+" : ""}${scanMiss}\uAC1C)`;
}
function getZoneName(dayRecord, zoneId) {
  return dayRecord.zones.find((zone) => zone.id === zoneId)?.name ?? zoneId;
}
function firstEvent(dayRecord, type) {
  return [...dayRecord.timeline].sort(compareEvents).find((event) => event.type === type);
}
function lastEvent(dayRecord, type) {
  return [...dayRecord.timeline].sort(compareEvents).reverse().find((event) => event.type === type);
}
function firstZoneEvent(dayRecord, zoneId, type) {
  return [...dayRecord.timeline].sort(compareEvents).find((event) => event.zoneId === zoneId && event.type === type);
}
function compareEvents(a, b) {
  return Date.parse(a.at) - Date.parse(b.at);
}
function diffMinutes2(start, end) {
  if (!start || !end) return void 0;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return void 0;
  return (endMs - startMs) / 6e4;
}
function calculateEfficiency(count, minutes) {
  if (minutes === void 0 || minutes < 1) return void 0;
  return count / (minutes / 60);
}
function formatMinutes(minutes) {
  if (minutes === void 0) return "-";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded}\uBD84`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours}\uC2DC\uAC04` : `${hours}\uC2DC\uAC04 ${rest}\uBD84`;
}
function formatClock(iso) {
  if (!iso) return "-";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function formatKoreanDate(date) {
  const parsed = /* @__PURE__ */ new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  });
}
function formatWholeEfficiency(efficiency) {
  if (efficiency === void 0) return "-";
  return `${Math.round(efficiency)}\uAC1C`;
}
function numberOr2(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function sumNumbers(...values) {
  return values.reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
}

// src/domain/zoneValidation.ts
function validateZoneQuantity(input) {
  const expectedTotal = normalizePositive(input.expectedTotal);
  const completedOther = Math.max(0, input.completedOther);
  if (!input.hasValue) {
    return {
      ok: false,
      value: 0,
      message: `${input.zoneName} \uC218\uB7C9\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.`
    };
  }
  if (!Number.isFinite(input.entered) || input.entered <= 0) {
    return {
      ok: false,
      value: input.entered,
      message: `${input.zoneName} \uC218\uB7C9\uC740 1\uAC1C \uC774\uC0C1\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4.`
    };
  }
  const dayTotalTolerance = expectedTotal !== void 0 ? Math.max(10, Math.ceil(expectedTotal * 0.1)) : 0;
  const looksLikeDayTotal = expectedTotal !== void 0 && completedOther > 0 && input.entered >= expectedTotal - dayTotalTolerance && input.entered <= expectedTotal + dayTotalTolerance && input.entered - completedOther > 0 && input.entered - completedOther <= input.maxReasonable;
  if (looksLikeDayTotal) {
    return {
      ok: true,
      value: input.entered,
      suggestedValue: input.entered - completedOther,
      suggestionReason: "looks_like_day_total",
      message: `${input.entered}\uAC1C\uB294 \uB2F9\uC77C \uC804\uCCB4 \uC218\uB7C9\uCC98\uB7FC \uBCF4\uC785\uB2C8\uB2E4. \uC774\uBBF8 \uC644\uB8CC\uD55C ${completedOther}\uAC1C\uB97C \uBE7C\uBA74 ${input.entered - completedOther}\uAC1C\uC785\uB2C8\uB2E4.`
    };
  }
  if (expectedTotal !== void 0) {
    const tolerance = Math.max(10, Math.ceil(expectedTotal * 0.1));
    if (input.entered + completedOther > expectedTotal + tolerance) {
      return {
        ok: true,
        value: input.entered,
        warning: `${input.zoneName}\uAE4C\uC9C0 \uD569\uACC4 ${input.entered + completedOther}\uAC1C\uC785\uB2C8\uB2E4. \uC608\uC0C1 \uC218\uB7C9 ${expectedTotal}\uAC1C\uBCF4\uB2E4 \uB9CE\uC774 \uD07D\uB2C8\uB2E4.`
      };
    }
  }
  if (input.entered > input.maxReasonable) {
    return {
      ok: true,
      value: input.entered,
      warning: `${input.zoneName} ${input.entered}\uAC1C\uAC00 \uC785\uB825\uB410\uC2B5\uB2C8\uB2E4. \uB108\uBB34 \uD070 \uAC12\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4.`
    };
  }
  return {
    ok: true,
    value: input.entered
  };
}
function resolveMijuDetailQuantity(input) {
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
      autoCalculatedRest: false
    };
  }
  if (input.totalHasValue) {
    if (input.total < aTotal) {
      return {
        ok: false,
        message: `\uCD1D\uD569 ${input.total}\uAC1C\uAC00 1/2/3\uB3D9 \uD569\uACC4 ${aTotal}\uAC1C\uBCF4\uB2E4 \uC791\uC2B5\uB2C8\uB2E4.`,
        one: input.one,
        two: input.two,
        three: input.three,
        rest: input.rest,
        aTotal,
        detailTotal: aTotal + input.rest,
        delivered: input.total,
        hasDetail,
        autoCalculatedRest: false
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
        autoCalculatedRest: rest !== input.rest
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
    autoCalculatedRest: false
  };
}
function normalizePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}

// src/storage/dayStore.ts
function createDateSummary(dayRecord) {
  return {
    date: dayRecord.date,
    status: dayRecord.status,
    eventCount: dayRecord.timeline.length,
    updatedAt: dayRecord.meta.updatedAt,
    recoveryStatus: dayRecord.meta.recoveryStatus
  };
}
function cloneDayRecord(dayRecord) {
  return structuredCloneFallback(dayRecord);
}
function cloneBackupFile(backupFile) {
  return structuredCloneFallback(backupFile);
}
function structuredCloneFallback(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

// src/ui/uiScreens.ts
function buildUiScreens(input) {
  const history = input.history ?? [input.dayRecord];
  const calculation = calculateDay(input.dayRecord);
  const report = buildDailyReport(input.dayRecord, calculation);
  const preview = buildPreviewModel(input.dayRecord, calculation);
  const logEntries = deriveLog(input.dayRecord);
  const dateSummaries = input.dateSummaries ?? history.map((dayRecord) => createDateSummary(dayRecord));
  const monthKey = input.monthKey ?? input.dayRecord.date.slice(0, 7);
  const monthRecords = history.filter((dayRecord) => dayRecord.date.startsWith(monthKey));
  return {
    navigation: buildNavigation(calculation, report, dateSummaries, monthRecords.length),
    work: buildWorkScreen(input.dayRecord, calculation),
    logs: buildLogScreen(logEntries),
    report: buildReportScreen(report, preview, calculation),
    dates: buildDateIndexScreen(dateSummaries, input.selectedDate),
    stats: buildMonthlyStatsScreen(monthRecords, monthKey),
    settings: buildSettingsScreen(input.dayRecord),
    backup: buildBackupRecoveryScreen(input.dayRecord, dateSummaries.length)
  };
}
function buildWorkScreen(dayRecord, calculation) {
  const derived = calculation ?? calculateDay(dayRecord);
  return {
    title: "Work",
    day: {
      date: dayRecord.date,
      status: dayRecord.status,
      recoveryStatus: dayRecord.meta.recoveryStatus,
      eventCount: dayRecord.timeline.length,
      zoneCount: derived.zones.length,
      helperCount: dayRecord.helpers.length
    },
    stage: inferWorkStage(dayRecord),
    summary: summarizeWork(dayRecord, derived),
    quickActions: ["add_event", "open_logs", "open_report", "open_backup"]
  };
}
function buildLogScreen(entries) {
  return {
    title: "Logs",
    entries,
    sourceEventIds: entries.map((entry) => entry.eventId),
    emptyState: entries.length > 0 ? "" : "No timeline events yet."
  };
}
function buildReportScreen(report, preview, calculation) {
  return {
    title: "Report",
    preview,
    report,
    warnings: calculation?.warnings ?? report.warnings,
    actions: ["copy_report", "open_logs", "review_warnings"]
  };
}
function buildDateIndexScreen(items, selectedDate) {
  const sorted = [...items].sort((left, right) => right.date.localeCompare(left.date));
  return {
    title: "Date Index",
    selectedDate,
    items: sorted,
    statusCounts: countStatuses(sorted)
  };
}
function buildMonthlyStatsScreen(history, monthKey) {
  const monthDays = history.filter((dayRecord) => dayRecord.date.startsWith(monthKey));
  const calculations = monthDays.map((dayRecord) => calculateDay(dayRecord));
  const totalCount = calculations.reduce((sum, calculation) => sum + calculation.totals.totalCount, 0);
  const deliveredCount = calculations.reduce((sum, calculation) => sum + calculation.totals.deliveredCount, 0);
  const failedCount = calculations.reduce((sum, calculation) => sum + calculation.totals.failedCount, 0);
  const extraCount = calculations.reduce((sum, calculation) => sum + calculation.totals.extraCount, 0);
  const totalElapsedMinutes = sumOptional(
    calculations.map((calculation) => calculation.totals.totalElapsedMinutes)
  );
  const deliveryMinutes = sumOptional(calculations.map((calculation) => calculation.totals.deliveryMinutes));
  const efficiencyPerHour = calculateAverageEfficiency(calculations);
  return {
    title: "Monthly Stats",
    monthKey,
    dayCount: monthDays.length,
    statusCounts: countStatuses(monthDays.map((dayRecord) => createDateSummary(dayRecord))),
    recoveryStatusCounts: countRecoveryStatuses(monthDays.map((dayRecord) => createDateSummary(dayRecord))),
    totals: {
      totalCount,
      deliveredCount,
      failedCount,
      extraCount,
      totalElapsedMinutes,
      deliveryMinutes,
      efficiencyPerHour
    },
    averageEfficiencyPerHour: efficiencyPerHour,
    quantityComparison: buildZoneQuantityComparison(monthDays)
  };
}
function buildSettingsScreen(dayRecord) {
  return {
    title: "Settings",
    installMode: "phoneInstall",
    appVersion: dayRecord.meta.appVersion,
    recoveryStatus: dayRecord.meta.recoveryStatus,
    storageMode: "offline-first",
    safetyRules: [
      "Automatic snapshots before destructive operations.",
      "Explicit reset only. No silent wipe on cancel, back, app switch, or restart.",
      "Recovery UI must stay available for interrupted work."
    ]
  };
}
function buildBackupRecoveryScreen(dayRecord, snapshotCount) {
  return {
    title: "Backup & Recovery",
    recoveryStatus: dayRecord.meta.recoveryStatus,
    backupHint: snapshotCount > 1 ? snapshotCount + " date snapshots available for recovery." : "Automatic snapshot required before any destructive change.",
    safetyRules: [
      "Automatic snapshots are required.",
      "Explicit reset only. No silent data loss on cancel, back, app switch, or restart.",
      "Recovery UI must be visible before any destructive reset path."
    ],
    actions: ["export_backup", "import_backup", "open_recovery", "explicit_reset"]
  };
}
function buildNavigation(calculation, report, items, monthDayCount) {
  return [
    { key: "work", label: "Work", detail: calculation.zones.length + " zones" },
    { key: "logs", label: "Logs", detail: calculation.totals.totalCount + " items" },
    { key: "report", label: "Report", detail: report.text.length > 0 ? "ready" : "empty" },
    { key: "dates", label: "Dates", detail: items.length + " days" },
    { key: "stats", label: "Stats", detail: monthDayCount + " days this month" },
    { key: "settings", label: "Settings", detail: "phoneInstall" },
    { key: "backup", label: "Backup", detail: "snapshots on" }
  ];
}
function inferWorkStage(dayRecord) {
  const eventTypes = new Set(dayRecord.timeline.map((event) => event.type));
  if (eventTypes.has("day_close")) {
    return "closed";
  }
  if (eventTypes.has("zone_end")) {
    return "closing";
  }
  if (eventTypes.has("delivery_start")) {
    return "delivering";
  }
  if (eventTypes.has("sorting_start") || eventTypes.has("sorting_end")) {
    return "sorting";
  }
  if (eventTypes.has("zone_start")) {
    return "working";
  }
  return "ready";
}
function summarizeWork(dayRecord, calculation) {
  return [
    "date=" + dayRecord.date,
    "status=" + dayRecord.status,
    "zones=" + calculation.zones.length,
    "events=" + dayRecord.timeline.length,
    "recovery=" + dayRecord.meta.recoveryStatus
  ].join(" / ");
}
function countStatuses(items) {
  return items.reduce(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    {
      draft: 0,
      active: 0,
      closed: 0,
      reviewNeeded: 0
    }
  );
}
function countRecoveryStatuses(items) {
  return items.reduce(
    (counts, item) => {
      counts[item.recoveryStatus] += 1;
      return counts;
    },
    {
      none: 0,
      complete: 0,
      partial: 0,
      textOnly: 0,
      needsReview: 0,
      failed: 0
    }
  );
}
function sumOptional(values) {
  const defined = values.filter((value) => typeof value === "number");
  if (defined.length === 0) {
    return void 0;
  }
  return defined.reduce((sum, value) => sum + value, 0);
}
function calculateAverageEfficiency(calculations) {
  const values = calculations.map((calculation) => calculation.totals.efficiencyPerHour).filter((value) => typeof value === "number");
  if (values.length === 0) {
    return void 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function buildZoneQuantityComparison(days) {
  const quantities = {
    miju: 0,
    hils: 0,
    alternate: 0
  };
  for (const day of days) {
    const calculation = calculateDay(day);
    for (const zone of calculation.zones) {
      quantities[classifyZone(day, zone.zoneId)] += zone.counts.delivered;
    }
  }
  const ordered = [
    { key: "miju", label: "\uBBF8\uC8FC" },
    { key: "hils", label: "\uD790\uC2A4" },
    { key: "alternate", label: "\uB300\uCCB4\uBC30\uC1A1\uC9C0" }
  ];
  const divisor = gcdMany(ordered.map((item) => quantities[item.key]));
  const totalQuantity = ordered.reduce((sum, item) => sum + quantities[item.key], 0);
  const buckets = ordered.map((item) => {
    const quantity = quantities[item.key];
    return {
      key: item.key,
      label: item.label,
      quantity,
      ratioPart: divisor > 0 ? quantity / divisor : 0,
      percent: totalQuantity > 0 ? roundTo(quantity / totalQuantity * 100, 1) : 0
    };
  });
  return {
    basis: "deliveredCount",
    totalQuantity,
    ratioLabel: buckets.map((bucket) => String(bucket.ratioPart)).join(":"),
    buckets
  };
}
function classifyZone(dayRecord, zoneId) {
  const zone = dayRecord.zones.find((item) => item.id === zoneId);
  const id = zoneId.toLowerCase();
  const name = (zone?.name || "").toLowerCase();
  if (id === "miju" || id.includes("miju") || name.includes("\uBBF8\uC8FC")) {
    return "miju";
  }
  if (id === "hils" || id.includes("hils") || name.includes("\uD790\uC2A4")) {
    return "hils";
  }
  return "alternate";
}
function gcdMany(values) {
  const positives = values.filter((value) => value > 0).map((value) => Math.round(value));
  if (positives.length === 0) {
    return 0;
  }
  return positives.reduce((current, value) => gcd(current, value));
}
function gcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}
function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// src/domain/fieldAppMigration.ts
var FIELD_APP_BACKUP_APP_ID = "delivery-master-season2-pwa";
var FIELD_APP_BACKUP_TYPE = "full-localStorage";
var PRESERVED_FIELD_APP_APP_ID = "delivery-master-season2";
var FIELD_MIGRATION_APP_VERSION = "0.0.0-field-app-migration";
function isFieldAppBackup(source) {
  if (Array.isArray(source)) {
    return source.some((item) => Boolean(normalizeFieldDayItem(item)));
  }
  const obj = toObject(source);
  if (!obj) {
    return false;
  }
  return obj.app === FIELD_APP_BACKUP_APP_ID || obj.app === PRESERVED_FIELD_APP_APP_ID || obj.backupType === FIELD_APP_BACKUP_TYPE || Array.isArray(obj.details) || Boolean(toObject(obj.days)) || Boolean(toObject(obj.summaries)) || Boolean(normalizeFieldDayItem(obj));
}
function migrateFieldAppBackup(source, options = {}) {
  const warnings = [];
  const statusCounts = createStatusCounts();
  const inspection = inspectFieldAppBackup(source);
  if (!isFieldAppBackup(source)) {
    statusCounts.failed = 1;
    warnings.push({
      code: "not_field_app_backup",
      message: "Source is not a Season2 PWA field app backup."
    });
    return {
      days: [],
      inspection,
      warnings,
      statusCounts
    };
  }
  const days = [];
  for (const item of collectFieldDayItems(source)) {
    const result = migrateFieldDayItem(item, options);
    statusCounts[result.status] += 1;
    warnings.push(...result.warnings);
    days.push(result.day);
  }
  if (days.length === 0) {
    statusCounts.failed = 1;
    warnings.push({
      code: "no_field_days",
      message: "Field app backup did not contain recognizable day records."
    });
  }
  return {
    days,
    inspection,
    warnings,
    statusCounts
  };
}
function inspectFieldAppBackup(source) {
  const items = collectFieldDayItems(source);
  const detectedKinds = /* @__PURE__ */ new Set();
  const dates = /* @__PURE__ */ new Set();
  const issues = [];
  if (isFieldAppBackup(source)) {
    detectedKinds.add("fieldAppBackup");
  }
  if (Array.isArray(source)) {
    detectedKinds.add("fieldArrayBackup");
  }
  const sourceObj = toObject(source);
  if (sourceObj?.app === PRESERVED_FIELD_APP_APP_ID) {
    detectedKinds.add("preservedFieldAppBackup");
  }
  for (const item of items) {
    dates.add(item.date);
    if (item.state) {
      detectedKinds.add("fieldState");
    }
    if (Array.isArray(item.logs)) {
      detectedKinds.add("fieldLogs");
    }
    if (item.reportText) {
      detectedKinds.add("fieldReportText");
    }
  }
  if (items.length === 0) {
    issues.push("no_field_days");
  }
  return {
    candidateCount: items.length,
    detectedKinds: Array.from(detectedKinds),
    dates: Array.from(dates).sort(),
    confidence: items.length > 0 ? 0.88 : 0,
    issues
  };
}
function migrateFieldDayItem(item, options) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const warnings = [];
  const state = item.state || {};
  const events = [];
  const zones = [];
  const adjustments = [];
  const helpers = [];
  pushEvent(events, {
    id: eventId(item.date, "depart", 1),
    type: "depart_jinjeop",
    at: normalizeAt(state.departTime, item.date, "08:00"),
    note: "Migrated from field app depart time"
  });
  pushEvent(events, {
    id: eventId(item.date, "arrive", 1),
    type: "arrive_cheongnyangni",
    at: normalizeAt(state.arriveTime, item.date, "09:00"),
    note: "Migrated from field app arrive time"
  });
  const results = Array.isArray(state.results) ? state.results.map((value) => toFieldZoneResult(value)).filter((result) => Boolean(result)) : [];
  if (results.length === 0) {
    warnings.push({
      code: "field_day_missing_results",
      message: "Field app day has no structured zone results.",
      date: item.date,
      kind: "fieldAppBackup"
    });
  }
  results.forEach((result, index) => {
    const order = Number.isFinite(result.zIdx) ? Number(result.zIdx) + 1 : index + 1;
    const name = result.name || "zone-" + order;
    const zoneId = "zone-" + order + "-" + safeId(name);
    const startId = eventId(item.date, "zone-start", order);
    const sortingStartId = result.cuStart ? eventId(item.date, "sorting-start", order) : void 0;
    const sortingEndId = result.cuEnd ? eventId(item.date, "sorting-end", order) : void 0;
    const endId = eventId(item.date, "zone-end", order);
    const qty = numberOrZero(result.qty);
    const mijuA = result.mijuData?.aTotal ?? sumMijuA(result.mijuData);
    const mijuB = result.mijuData?.bTotal;
    const mijuPayload = mijuA !== void 0 || mijuB !== void 0 ? {
      aTotal: numberOrZero(mijuA),
      bTotal: numberOrZero(mijuB),
      restTotal: numberOrZero(mijuB),
      detailMode: true
    } : {};
    pushEvent(events, {
      id: startId,
      type: "zone_start",
      at: normalizeAt(result.startTime, item.date, "09:00"),
      zoneId,
      payload: {
        zoneName: name,
        order,
        sourceType: result.type,
        mijuA,
        mijuB
      },
      note: "Migrated from field app zone start"
    });
    if (sortingStartId) {
      pushEvent(events, {
        id: sortingStartId,
        type: "sorting_start",
        at: normalizeAt(result.cuStart, item.date, "09:00"),
        zoneId,
        note: "Migrated from field app sorting start"
      });
    }
    if (sortingEndId) {
      pushEvent(events, {
        id: sortingEndId,
        type: "sorting_end",
        at: normalizeAt(result.cuEnd, item.date, "09:00"),
        zoneId,
        note: "Migrated from field app sorting end"
      });
    }
    pushEvent(events, {
      id: endId,
      type: "zone_end",
      at: normalizeAt(result.endTime, item.date, "18:00"),
      zoneId,
      payload: {
        total: qty,
        delivered: qty,
        failed: 0,
        extra: 0,
        sourceType: result.type,
        ...mijuPayload
      },
      note: "Migrated from field app zone close"
    });
    zones.push({
      id: zoneId,
      name,
      order,
      startEventId: startId,
      sortingStartEventId: sortingStartId,
      sortingEndEventId: sortingEndId,
      endEventId: endId,
      counts: {
        total: qty,
        delivered: qty,
        failed: 0,
        extra: 0
      },
      countsSourceEventIds: [endId],
      countsCalculatedAt: normalizeAt(result.endTime, item.date, "18:00")
    });
  });
  const fieldEvents = Array.isArray(state.events) ? state.events : [];
  fieldEvents.forEach((value, index) => {
    const obj = toObject(value);
    if (!obj) {
      return;
    }
    pushEvent(events, {
      id: eventId(item.date, "field-event", index + 1),
      type: "incident",
      at: normalizeAt(obj.at || obj.time || obj.timestamp, item.date, "12:00"),
      zoneId: zoneIdFromIndex(zones, obj.zIdx),
      payload: {
        title: stringOr(obj.title, "Field app event"),
        detail: stringOr(obj.detail, void 0)
      },
      note: stringOr(obj.title, "Migrated field app event")
    });
  });
  const closeAt = normalizeAt(state.finishTime || item.savedAt, item.date, "18:00");
  pushEvent(events, {
    id: eventId(item.date, "day-close", 1),
    type: "day_close",
    at: closeAt,
    note: "Migrated from field app finish time"
  });
  const status = warnings.length > 0 ? "needsReview" : "complete";
  const day = {
    schemaVersion: 1,
    id: "day-" + safeId(item.date),
    date: item.date,
    status: status === "complete" ? "closed" : "reviewNeeded",
    timeline: events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id)),
    zones: zones.sort((a, b) => a.order - b.order),
    helpers,
    adjustments,
    meta: {
      createdAt: now,
      updatedAt: now,
      deviceId: options.deviceId,
      appVersion: options.appVersion || FIELD_MIGRATION_APP_VERSION,
      migrationSource: "fieldAppBackup",
      recoveryStatus: status === "complete" ? "complete" : "needsReview"
    }
  };
  return { day, status, warnings };
}
function collectFieldDayItems(source) {
  if (Array.isArray(source)) {
    return mergeFieldDayItems(source);
  }
  const obj = toObject(source);
  if (!obj) {
    return [];
  }
  const byDate = /* @__PURE__ */ new Map();
  const add = (candidate) => {
    const item = normalizeFieldDayItem(candidate);
    if (!item) {
      return;
    }
    const existing = byDate.get(item.date);
    if (!existing || fieldDayScore(item) >= fieldDayScore(existing)) {
      byDate.set(item.date, item);
    }
  };
  if (Array.isArray(obj.details)) {
    obj.details.forEach(add);
  }
  if (Array.isArray(obj.days)) {
    obj.days.forEach(add);
  } else {
    const days2 = toObject(obj.days);
    if (days2) {
      Object.values(days2).forEach(add);
    }
  }
  const summaries = toObject(obj.summaries);
  if (summaries) {
    Object.values(summaries).forEach(add);
  }
  if (toObject(obj.state) || toObject(obj.zones)) {
    add(obj);
  }
  const days = toObject(obj.days);
  if (days && !Array.isArray(obj.days)) {
    Object.values(days).forEach(add);
  }
  add(obj.currentState);
  const storageItems = toObject(obj.storageItems) || toObject(obj.storage);
  if (storageItems) {
    for (const [key, value] of Object.entries(storageItems)) {
      const cleanKey = key.startsWith("dm2_") ? key.slice(4) : key;
      if (!cleanKey.startsWith("report_")) {
        continue;
      }
      add(parseMaybeJson(value));
    }
  }
  const logsByDate = toObject(obj.logsByDate);
  if (logsByDate) {
    for (const [date, logs] of Object.entries(logsByDate)) {
      const existing = byDate.get(date);
      if (existing && !existing.logs && Array.isArray(logs)) {
        byDate.set(date, { ...existing, logs });
      }
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
function mergeFieldDayItems(candidates) {
  const byDate = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    const item = normalizeFieldDayItem(candidate);
    if (!item) {
      continue;
    }
    const existing = byDate.get(item.date);
    if (!existing || fieldDayScore(item) >= fieldDayScore(existing)) {
      byDate.set(item.date, item);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
function normalizeFieldDayItem(value) {
  const parsed = parseMaybeJson(value);
  const obj = toObject(parsed);
  if (!obj) {
    return null;
  }
  const date = stringOr(obj.date, void 0);
  if (!date) {
    return null;
  }
  const summary = toObject(obj.summary) || (toObject(obj.zones) ? obj : void 0);
  const state = toObject(obj.state) || buildStateFromSummary(date, summary);
  return {
    date,
    state,
    logs: Array.isArray(obj.logs) ? obj.logs : void 0,
    summary,
    reportText: stringOr(obj.reportText, void 0),
    savedAt: stringOr(obj.savedAt, void 0)
  };
}
function buildStateFromSummary(date, summary) {
  const zones = toObject(summary?.zones);
  if (!zones) {
    return void 0;
  }
  const results = Object.entries(zones).map(([name, value], index) => {
    const zone = toObject(value) || {};
    return {
      zIdx: index,
      name,
      type: stringOr(zone.type, index === 0 ? "miju" : "hils"),
      startTime: `${date}T00:00:00`,
      endTime: `${date}T00:00:00`,
      qty: numberOr3(zone.qty, 0),
      mijuData: toObject(zone.mijuData)
    };
  });
  return {
    phase: "finished",
    departTime: `${date}T00:00:00`,
    arriveTime: `${date}T00:00:00`,
    results,
    events: [],
    helpers: [],
    logs: [],
    finishTime: `${date}T00:00:00`
  };
}
function toFieldZoneResult(value) {
  const obj = toObject(value);
  if (!obj) {
    return null;
  }
  return {
    zIdx: numberOr3(obj.zIdx, void 0),
    name: stringOr(obj.name, void 0),
    type: stringOr(obj.type, void 0),
    startTime: stringOr(obj.startTime, void 0),
    endTime: stringOr(obj.endTime, void 0),
    cuStart: stringOr(obj.cuStart, void 0),
    cuEnd: stringOr(obj.cuEnd, void 0),
    qty: numberOr3(obj.qty, void 0),
    mijuData: toObject(obj.mijuData)
  };
}
function pushEvent(events, input) {
  events.push({
    ...input,
    source: "migration",
    createdAt: input.at,
    updatedAt: input.at
  });
}
function fieldDayScore(item) {
  let score = 0;
  if (item.state) score += 10;
  if (Array.isArray(item.state?.results)) score += 20;
  if (Array.isArray(item.logs)) score += 5;
  if (item.reportText) score += 1;
  return score;
}
function createStatusCounts() {
  return {
    complete: 0,
    partial: 0,
    textOnly: 0,
    needsReview: 0,
    failed: 0
  };
}
function normalizeAt(value, date, fallbackTime) {
  const raw = stringOr(value, void 0);
  if (!raw) {
    return `${date}T${fallbackTime}:00+09:00`;
  }
  if (/^\d{2}:\d{2}$/.test(raw)) {
    return `${date}T${raw}:00+09:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    return raw;
  }
  return `${date}T${fallbackTime}:00+09:00`;
}
function eventId(date, kind, index) {
  return `field-${safeId(date)}-${kind}-${index}`;
}
function zoneIdFromIndex(zones, zIdx) {
  const index = numberOr3(zIdx, void 0);
  if (index === void 0) {
    return void 0;
  }
  return zones.find((zone) => zone.order === index + 1)?.id;
}
function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function toObject(value) {
  return value && typeof value === "object" ? value : null;
}
function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}
function numberOr3(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function numberOrZero(value) {
  return numberOr3(value, 0) || 0;
}
function sumMijuA(value) {
  if (!value) {
    return void 0;
  }
  const sum = (value.a1 || 0) + (value.a2 || 0) + (value.a3 || 0);
  return sum > 0 ? sum : void 0;
}
function safeId(value) {
  return value.replace(/[^a-zA-Z0-9가-힣]+/g, "-").replace(/^-+|-+$/g, "") || "field";
}

// src/domain/legacyMigration.ts
function buildMigrationReport(result) {
  const lines = [
    "Legacy migration report",
    "Candidates: " + result.inspection.candidateCount,
    "Dates: " + (result.inspection.dates.join(", ") || "none"),
    "Confidence: " + Math.round(result.inspection.confidence * 100) + "%",
    "Complete: " + result.statusCounts.complete,
    "Partial: " + result.statusCounts.partial,
    "Text only: " + result.statusCounts.textOnly,
    "Needs review: " + result.statusCounts.needsReview,
    "Failed: " + result.statusCounts.failed,
    "",
    "Warnings:"
  ];
  if (result.warnings.length === 0) {
    lines.push("- none");
  } else {
    for (const warning of result.warnings) {
      lines.push("- " + warning.code + ": " + warning.message);
    }
  }
  return {
    text: lines.join("\n"),
    warnings: result.warnings,
    sourceDateCount: result.inspection.dates.length,
    migratedCount: result.days.length,
    statusCounts: result.statusCounts
  };
}

// src/storage/backupImportExport.ts
var PHONE_INSTALL_BACKUP_APP = "delivery-master-phone-install";
var PHONE_INSTALL_BACKUP_TYPE = "day-record-store";
var PHONE_INSTALL_BACKUP_FILENAME = "\uBC30\uC1A1\uB9C8\uC2A4\uD130_\uAC1C\uBC1C\uC571_\uBC31\uC5C5_\uC808\uB300\uC0AD\uC81C\uAE08\uC9C0.json";
var FIELD_APP_BACKUP_APP = FIELD_APP_BACKUP_APP_ID;
async function previewBackupImport(dayStore, file) {
  assertPhoneInstallBackup(file);
  return dayStore.importBackup(file, { mode: "preview" });
}
function buildFieldAppMigrationBackup(source, options = {}) {
  const migration = migrateFieldAppBackup(source, options);
  const backup = {
    schemaVersion: 1,
    app: PHONE_INSTALL_BACKUP_APP,
    backupType: PHONE_INSTALL_BACKUP_TYPE,
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    appVersion: options.appVersion,
    scope: { kind: "all" },
    days: migration.days
  };
  return {
    backup,
    report: buildMigrationReport(migration)
  };
}
function assertPhoneInstallBackup(file) {
  const candidate = file;
  if (candidate.app === FIELD_APP_BACKUP_APP) {
    throw new Error("Field app backups must be imported through migration, not direct restore.");
  }
  if (candidate.app && candidate.app !== PHONE_INSTALL_BACKUP_APP) {
    throw new Error(`Unsupported backup app: ${candidate.app}`);
  }
  if (candidate.backupType && candidate.backupType !== PHONE_INSTALL_BACKUP_TYPE) {
    throw new Error(`Unsupported backup type: ${candidate.backupType}`);
  }
}
function createBackupCopyDay(day) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const copyDate = `${day.date}__copy_${timestamp}`;
  return {
    ...structuredCloneDay(day),
    id: `${day.id}__copy_${timestamp}`,
    date: copyDate,
    meta: {
      ...day.meta,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      recoveryStatus: "needsReview"
    }
  };
}
function structuredCloneDay(day) {
  if (typeof structuredClone === "function") {
    return structuredClone(day);
  }
  return JSON.parse(JSON.stringify(day));
}

// src/install/phoneInstall.ts
async function buildPhoneInstallDashboard(dayStore, scope = { kind: "all" }) {
  const { latestSummary, latestDay, history, summaries } = await loadLatestPhoneInstallData(dayStore);
  return {
    installMode: "phoneInstall",
    appVersion: latestDay?.meta.appVersion,
    latestSummary,
    screens: latestDay ? buildUiScreens({
      dayRecord: latestDay,
      history,
      dateSummaries: summaries,
      selectedDate: latestDay.date,
      monthKey: latestDay.date.slice(0, 7)
    }) : null,
    safetyRules: buildSafetyRules(),
    recovery: buildRecoveryPanel(),
    update: buildUpdatePanel(scope),
    reset: buildResetPanel()
  };
}
async function preparePhoneInstallUpdate(dayStore, scope = { kind: "all" }) {
  const snapshot = await dayStore.createBackup(scope);
  const recoveryPreview = await previewBackupImport(dayStore, snapshot);
  return {
    scope,
    snapshot,
    recoveryPreview,
    safetyRules: [
      "Automatic snapshot captured before update preparation.",
      "Recovery preview must be shown before update proceeds.",
      "No data should be dropped by update preparation."
    ]
  };
}
function buildSafetyRules() {
  return [
    "Automatic snapshots are mandatory before destructive operations.",
    "Explicit reset only. No silent wipe on cancel, back, app switch, or restart.",
    "Recovery UI must remain visible before any destructive path proceeds."
  ];
}
function buildRecoveryPanel() {
  return {
    title: "Recovery",
    allowedModes: ["preview", "copy", "overwrite"],
    safetyRules: [
      "Preview first when the target state is unclear.",
      "Copy mode must never overwrite existing dates.",
      "Overwrite mode should only be used after confirmation."
    ],
    note: "Recovery uses backup files only. Live data is never treated as its own source of truth."
  };
}
function buildUpdatePanel(scope) {
  return {
    title: "Update",
    requiresAutomaticSnapshot: true,
    safetyRules: [
      "Capture a backup before touching app state.",
      "Offer recovery preview before applying the update."
    ],
    defaultScope: scope
  };
}
function buildResetPanel() {
  return {
    title: "Reset",
    requiresExplicitConfirmation: true,
    safetyRules: [
      "Reset must be confirmed explicitly by the user.",
      "Reset must be preceded by an automatic snapshot."
    ],
    destructiveAction: "resetAll"
  };
}
async function loadLatestPhoneInstallData(dayStore) {
  const summaries = await dayStore.listDates();
  const history = await loadHistory(dayStore, summaries);
  const latestSummary = summaries[0] ?? null;
  const latestDay = latestSummary ? await dayStore.getDay(latestSummary.date) : null;
  return {
    latestSummary,
    latestDay,
    history,
    summaries
  };
}
async function loadHistory(dayStore, summaries) {
  const days = [];
  for (const summary of summaries) {
    const day = await dayStore.getDay(summary.date);
    if (day) {
      days.push(day);
    }
  }
  return days;
}

// src/storage/indexedDbAdapter.ts
var DEFAULT_DB_NAME = "delivery-master";
var DEFAULT_STORE_NAME = "dayRecords";
var DEFAULT_VERSION = 1;
var IndexedDbDayStore = class {
  dbName;
  storeName;
  version;
  appVersion;
  indexedDb;
  dbPromise = null;
  constructor(options = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.storeName = options.storeName ?? DEFAULT_STORE_NAME;
    this.version = options.version ?? DEFAULT_VERSION;
    this.appVersion = options.appVersion ?? "0.0.0-prototype";
    this.indexedDb = options.indexedDb ?? getBrowserIndexedDb();
  }
  async listDates() {
    const days = await this.getAllDays();
    return days.map(createDateSummary).sort((a, b) => b.date.localeCompare(a.date));
  }
  async getDay(date) {
    const db = await this.openDb();
    const day = await requestToPromise(
      db.transaction(this.storeName, "readonly").objectStore(this.storeName).get(date)
    );
    return day ? cloneDayRecord(day) : null;
  }
  async saveDay(dayRecord) {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, "readwrite");
    const store2 = tx.objectStore(this.storeName);
    const existing = await requestToPromise(
      store2.get(dayRecord.date)
    );
    await requestToPromise(store2.put(cloneDayRecord(dayRecord)));
    await transactionToPromise(tx);
    return {
      date: dayRecord.date,
      savedAt: (/* @__PURE__ */ new Date()).toISOString(),
      created: !existing
    };
  }
  async resetAll() {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, "readwrite");
    const store2 = tx.objectStore(this.storeName);
    const existing = await requestToPromise(store2.getAll());
    await requestToPromise(store2.clear());
    await transactionToPromise(tx);
    return {
      clearedCount: existing.length,
      resetAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  async createBackup(scope = { kind: "all" }) {
    const allDays = await this.getAllDays();
    const days = scope.kind === "all" ? allDays : allDays.filter((day) => day.date === scope.date);
    return {
      schemaVersion: 1,
      app: PHONE_INSTALL_BACKUP_APP,
      backupType: PHONE_INSTALL_BACKUP_TYPE,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      appVersion: this.appVersion,
      scope,
      days: days.map(cloneDayRecord)
    };
  }
  async importBackup(file, options = { mode: "preview" }) {
    assertPhoneInstallBackup(file);
    const backup = cloneBackupFile(file);
    const imported = [];
    const skipped = [];
    for (const day of backup.days) {
      const existing = await this.getDay(day.date);
      if (options.mode === "preview") {
        if (existing) {
          skipped.push({
            date: day.date,
            reason: "existing_day_preview",
            existingUpdatedAt: existing.meta.updatedAt,
            incomingUpdatedAt: day.meta.updatedAt
          });
        } else {
          imported.push(createDateSummary(day));
        }
        continue;
      }
      if (existing && options.mode === "copy") {
        const copy = createBackupCopyDay(day);
        await this.saveDay(copy);
        imported.push(createDateSummary(copy));
        continue;
      }
      if (existing && options.mode !== "overwrite") {
        skipped.push({
          date: day.date,
          reason: "existing_day_requires_copy_or_overwrite",
          existingUpdatedAt: existing.meta.updatedAt,
          incomingUpdatedAt: day.meta.updatedAt
        });
        continue;
      }
      await this.saveDay(day);
      imported.push(createDateSummary(day));
    }
    return {
      mode: options.mode,
      imported,
      skipped,
      preview: options.mode === "preview"
    };
  }
  async getAllDays() {
    const db = await this.openDb();
    const days = await requestToPromise(
      db.transaction(this.storeName, "readonly").objectStore(this.storeName).getAll()
    );
    return days.map(cloneDayRecord);
  }
  openDb() {
    if (!this.dbPromise) {
      this.dbPromise = openDatabase(
        this.indexedDb,
        this.dbName,
        this.storeName,
        this.version
      );
    }
    return this.dbPromise;
  }
};
function openDatabase(indexedDb, dbName, storeName, version) {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(dbName, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "date" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      reject(new Error(`IndexedDB open blocked for ${dbName}`));
    };
  });
}
function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
function getBrowserIndexedDb() {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this runtime.");
  }
  return indexedDB;
}

// src/app/version.ts
var APP_VERSION = "0.2.11-field-final-polish";
var APP_UPDATED_LABEL = "2026-06-06 \uC218\uC815\uBCF8";
var CACHE_VERSION = "v12";
var CACHE_NAME = `delivery-master-install-${CACHE_VERSION}`;
var TOPBAR_VERSION_LABEL = CACHE_VERSION;
var SETTINGS_VERSION_LABEL = `${APP_VERSION} \xB7 ${APP_UPDATED_LABEL} \xB7 cache ${CACHE_VERSION}`;

// src/app/main.ts
var BASE_ZONE_IDS = ["miju", "hils"];
var MAX_REASONABLE_EXPECTED = 1200;
var MAX_REASONABLE_ZONE = 800;
var EVENT_TYPES = [
  "\uC2DD\uC0AC/\uD734\uC2DD",
  "\uC5C5\uCCB4 \uBC29\uBB38",
  "\uBC18\uD488 \uC120\uC218\uAC70",
  "\uC804\uCCB4 \uBC18\uD488 \uC0C1\uCC28",
  "\uACE0\uAC1D/\uAD00\uB9AC\uC2E4 \uB300\uC751",
  "\uC5D8\uB9AC\uBCA0\uC774\uD130/\uC2DC\uC124 \uBB38\uC81C",
  "\uCC28\uB7C9 \uC774\uB3D9/\uC801\uC7AC \uC815\uB9AC",
  "\uB300\uAE30",
  "\uAE30\uD0C0"
];
var store = new IndexedDbDayStore({
  dbName: "delivery-master-install",
  storeName: "dayRecords",
  appVersion: APP_VERSION
});
var currentDay = null;
var historyDays = [];
var lastImportFeedback = null;
var activeTab = "work";
var activeStatsTab = "week";
var statsWeekOffset = 0;
var statsMonthOffset = 0;
var statsSelectedDate = todayKey();
var appRoot = document.querySelector("#app");
if (!appRoot) throw new Error("Missing #app root");
var root = appRoot;
void boot();
async function boot() {
  await registerServiceWorker();
  await loadToday();
  render();
}
async function loadToday() {
  const date = todayKey();
  currentDay = await store.getDay(date);
  if (!currentDay) {
    currentDay = createEmptyDay(date);
    await store.saveDay(currentDay);
  }
  await refreshHistory();
}
function render() {
  if (!currentDay) return;
  const calculation = calculateDay(currentDay);
  const report = buildDailyReport(currentDay, calculation, { title: "Delivery Master Install Report" });
  const pendingZone = currentDay.zones.find((zone) => hasMissingCleanupFinish(currentDay, zone.id));
  const history = historyDays.length > 0 ? historyDays : [currentDay];
  root.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">phoneInstall alpha \xB7 ${TOPBAR_VERSION_LABEL}</p>
          <h1>\uBC30\uC1A1\uB9C8\uC2A4\uD130</h1>
        </div>
        <button class="icon-btn" data-action="refresh" title="\uC0C8\uB85C\uACE0\uCE68">\uC0C8\uB85C\uACE0\uCE68</button>
      </header>

      <section class="status-band">
        <div><span class="label">\uB0A0\uC9DC</span><strong>${currentDay.date}</strong></div>
        <div><span class="label">\uC0C1\uD0DC</span><strong>${statusLabel(currentDay.status)}</strong></div>
        <div><span class="label">\uAE30\uB85D</span><strong>${currentDay.timeline.length}</strong></div>
      </section>

      ${renderTabs()}
      ${renderActiveTabContent(calculation, report, history, pendingZone)}
    </main>
  `;
  root.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => void handleAction(button));
  });
  bindNumericLimits();
  bindStatsDateInput();
}
function renderTabs() {
  const tabs = [
    { key: "work", label: "\uC5C5\uBB34" },
    { key: "log", label: "\uB85C\uADF8" },
    { key: "report", label: "\uB9AC\uD3EC\uD2B8" },
    { key: "stats", label: "\uD1B5\uACC4" },
    { key: "backup", label: "\uBC31\uC5C5\uC124\uC815" }
  ];
  return `
    <nav class="tabbar" aria-label="\uD654\uBA74 \uC774\uB3D9">
      ${tabs.map((tab) => `
        <button class="${activeTab === tab.key ? "active" : ""}" data-action="set-tab" data-tab="${tab.key}">${tab.label}</button>
      `).join("")}
    </nav>
  `;
}
function renderActiveTabContent(calculation, report, history, pendingZone) {
  switch (activeTab) {
    case "log":
      return renderLogTab(calculation);
    case "report":
      return renderReportTab(report);
    case "stats":
      return renderStatsTab(history);
    case "backup":
      return renderBackupSettingsTab();
    case "work":
    default:
      return renderWorkTab(calculation, pendingZone);
  }
}
function renderWorkTab(calculation, pendingZone) {
  return `
    ${renderCurrentStep()}
    ${pendingZone ? renderCleanupCorrectionPanel(pendingZone.id) : ""}
    ${renderEventPanel()}
    <section class="panel">
      <h2>\uC624\uB298 \uC694\uC57D</h2>
      <div class="summary">
        <span>\uCD1D ${calculation.totals.totalCount}\uAC1C</span>
        <span>\uC644\uB8CC ${calculation.totals.deliveredCount}\uAC1C</span>
        <span>\uBC30\uC1A1 ${formatMin(calculation.totals.deliveryMinutes)}</span>
        <span>\uD6A8\uC728 ${formatEff(calculation.totals.efficiencyPerHour)}</span>
      </div>
    </section>
    <section class="panel">
      <h2>\uAD6C\uC5ED \uD604\uD669</h2>
      ${renderZoneCards()}
    </section>
  `;
}
function renderLogTab(calculation) {
  return `
    <section class="panel">
      <h2>\uB85C\uADF8</h2>
      <p class="hint">\uD604\uC7A5\uC5D0\uC11C \uD3C9\uC18C \uD655\uC778\uD558\uB294 \uC2DC\uAC04\uC21C \uAE30\uB85D\uC785\uB2C8\uB2E4. \uC774 \uD654\uBA74\uB9CC \uBCF4\uACE0 \uD558\uB8E8 \uD750\uB984\uC744 \uBCF5\uAD6C\uD560 \uC218 \uC788\uC5B4\uC57C \uD569\uB2C8\uB2E4.</p>
      <div class="timeline-log">
        ${buildLogEntries(calculation).map((entry) => `
          <article class="timeline-entry ${entry.kind}">
            <div>
              <strong>${entry.title}</strong>
              <time>${entry.time}</time>
              ${entry.detail ? `<p>${entry.detail}</p>` : ""}
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}
function renderReportTab(report) {
  return `
    <section class="panel">
      <h2>\uB9AC\uD3EC\uD2B8</h2>
      <pre class="report">${escapeHtml(report.text)}</pre>
      <div class="row-actions">
        <button data-action="copy-report">\uB9AC\uD3EC\uD2B8 \uBCF5\uC0AC</button>
      </div>
    </section>
  `;
}
function renderStatsTab(history) {
  return `
    <section class="panel">
      <h2>\uD1B5\uACC4</h2>
      <p class="hint">\uBE44\uC728\uCE74\uB4DC\uB97C \uBA3C\uC800 \uBCF4\uACE0, \uD544\uC694\uD558\uBA74 \uC8FC\uAC04\xB7\uC6D4\uAC04\xB7\uB0A0\uC9DC\uBCC4 \uD750\uB984\uC744 \uC544\uB798\uC5D0\uC11C \uD655\uC778\uD569\uB2C8\uB2E4.</p>
      ${renderStatsSubtabs()}
      ${activeStatsTab === "week" ? renderWeeklyStats(history) : ""}
      ${activeStatsTab === "month" ? renderMonthlyStats(history) : ""}
      ${activeStatsTab === "date" ? renderDateStats(history) : ""}
    </section>
  `;
}
function renderStatsSubtabs() {
  const tabs = [
    { key: "week", label: "\uC8FC\uAC04" },
    { key: "month", label: "\uC6D4\uAC04" },
    { key: "date", label: "\uB0A0\uC9DC\uC870\uD68C" }
  ];
  return `
    <div class="stats-subtabs">
      ${tabs.map((tab) => `
        <button class="${activeStatsTab === tab.key ? "active" : ""}" data-action="set-stats-tab" data-stats-tab="${tab.key}">${tab.label}</button>
      `).join("")}
    </div>
  `;
}
function renderWeeklyStats(history) {
  const range = getWeekRange(statsWeekOffset);
  const days = getHistoryInRange(history, range.start, range.end);
  const stats = buildPeriodStats(days);
  const title = statsWeekOffset === 0 ? "\uC774\uBC88 \uC8FC \uBE44\uC728" : `${formatDateRange(range.start, range.end)} \uBE44\uC728`;
  return `
    <div class="period-nav">
      <button class="secondary" data-action="stats-week-prev">\uC774\uC804 \uC8FC</button>
      <strong>${formatDateRange(range.start, range.end)}</strong>
      <button class="secondary" data-action="stats-week-next" ${statsWeekOffset >= 0 ? "disabled" : ""}>\uB2E4\uC74C \uC8FC</button>
    </div>
    ${renderQuantityComparison(title, stats.quantityComparison)}
    ${renderPeriodSummary(stats)}
    ${renderZonePeriodCards(stats)}
    ${renderWeekDayCards(history, range.start, range.end)}
  `;
}
function renderMonthlyStats(history) {
  const range = getMonthRange(statsMonthOffset);
  const days = getHistoryInRange(history, range.start, range.end);
  const stats = buildPeriodStats(days);
  const title = statsMonthOffset === 0 ? "\uC774\uBC88 \uB2EC \uBE44\uC728" : `${formatMonthTitle(range.start)} \uBE44\uC728`;
  return `
    <div class="period-nav">
      <button class="secondary" data-action="stats-month-prev">\uC774\uC804 \uB2EC</button>
      <strong>${formatMonthTitle(range.start)}</strong>
      <button class="secondary" data-action="stats-month-next" ${statsMonthOffset >= 0 ? "disabled" : ""}>\uB2E4\uC74C \uB2EC</button>
    </div>
    ${renderQuantityComparison(title, stats.quantityComparison)}
    ${renderPeriodSummary(stats)}
    ${renderMonthlyVariation(stats)}
    ${renderZonePeriodCards(stats)}
    ${renderWeekdayAverage(days)}
    ${renderMonthDayCards(history, range.start, range.end)}
  `;
}
function renderDateStats(history) {
  const selected = history.find((dayRecord) => dayRecord.date === statsSelectedDate);
  const calculation = selected ? calculateDay(selected) : void 0;
  const report = selected && calculation ? buildDailyReport(selected, calculation, { title: "Delivery Master Install Report" }) : void 0;
  return `
    <div class="date-search-row">
      <label>\uB0A0\uC9DC \uC120\uD0DD<input id="stats-date-input" type="date" value="${statsSelectedDate}"></label>
      <button class="secondary" data-action="stats-date-today">\uC624\uB298</button>
    </div>
    ${selected && calculation && report ? `
        <div class="date-result">
          <h3>${formatKoreanDateLabel(selected.date)}</h3>
          <div class="summary">
            <span>\uCD1D ${calculation.totals.totalCount}\uAC1C</span>
            <span>\uBC30\uC1A1 ${formatMin(calculation.totals.deliveryMinutes)}</span>
            <span>\uD6A8\uC728 ${formatEff(calculation.totals.efficiencyPerHour)}</span>
          </div>
          <h3>\uB85C\uADF8</h3>
          <div class="timeline-log compact">
            ${buildLogEntriesForDay(selected, calculation).map((entry) => `
              <article class="timeline-entry ${entry.kind}">
                <div>
                  <strong>${entry.title}</strong>
                  <time>${entry.time}</time>
                  ${entry.detail ? `<p>${entry.detail}</p>` : ""}
                </div>
              </article>
            `).join("")}
          </div>
          <h3>\uB9AC\uD3EC\uD2B8</h3>
          <pre class="report">${escapeHtml(report.text)}</pre>
        </div>
      ` : renderMissingDateState(statsSelectedDate)}
  `;
}
function buildPeriodStats(days) {
  const pairs = days.map((dayRecord) => ({ dayRecord, calculation: calculateDay(dayRecord) }));
  const deliveryPairs = pairs.filter((pair) => pair.calculation.totals.totalCount > 0);
  const totalQuantity = deliveryPairs.reduce((sum, pair) => sum + pair.calculation.totals.deliveredCount, 0);
  const expectedValues = deliveryPairs.map((pair) => getExpectedTotalForDay(pair.dayRecord)).filter((value) => typeof value === "number");
  const expectedQuantity = expectedValues.length > 0 ? expectedValues.reduce((sum, value) => sum + value, 0) : void 0;
  const efficiencies = deliveryPairs.map((pair) => pair.calculation.totals.efficiencyPerHour).filter((value) => typeof value === "number" && value > 0 && value < 300);
  const daySummaries = deliveryPairs.map((pair) => ({
    date: pair.dayRecord.date,
    totalQuantity: pair.calculation.totals.deliveredCount,
    efficiencyPerHour: pair.calculation.totals.efficiencyPerHour
  }));
  return {
    totalQuantity,
    expectedQuantity,
    scanMiss: expectedQuantity === void 0 ? void 0 : totalQuantity - expectedQuantity,
    workDays: deliveryPairs.length,
    totalElapsedMinutes: sumDefined2(deliveryPairs.map((pair) => pair.calculation.totals.totalElapsedMinutes)),
    deliveryMinutes: sumDefined2(deliveryPairs.map((pair) => pair.calculation.totals.deliveryMinutes)),
    averageEfficiencyPerHour: efficiencies.length > 0 ? efficiencies.reduce((sum, value) => sum + value, 0) / efficiencies.length : void 0,
    dailyAverage: deliveryPairs.length > 0 ? totalQuantity / deliveryPairs.length : void 0,
    maxDay: daySummaries.length > 0 ? [...daySummaries].sort((left, right) => right.totalQuantity - left.totalQuantity)[0] : void 0,
    minDay: daySummaries.length > 0 ? [...daySummaries].sort((left, right) => left.totalQuantity - right.totalQuantity)[0] : void 0,
    quantityComparison: buildQuantityComparisonFromPairs(pairs),
    zoneSummaries: buildZonePeriodSummaries(pairs)
  };
}
function buildQuantityComparisonFromPairs(pairs) {
  const quantities = {
    miju: 0,
    hils: 0,
    alternate: 0
  };
  for (const pair of pairs) {
    for (const zone of pair.calculation.zones) {
      quantities[getZoneBucket(pair.dayRecord, zone.zoneId)] += zone.counts.delivered;
    }
  }
  const totalQuantity = quantities.miju + quantities.hils + quantities.alternate;
  const buckets = ["miju", "hils", "alternate"].map((key) => ({
    key,
    label: formatBucketLabel(key),
    quantity: quantities[key],
    ratioPart: quantities[key],
    percent: totalQuantity > 0 ? Math.round(quantities[key] / totalQuantity * 1e3) / 10 : 0
  }));
  return {
    basis: "deliveredCount",
    totalQuantity,
    ratioLabel: totalQuantity > 0 ? buckets.map((bucket) => `${formatBucketShortLabel(bucket.key)}${Math.round(bucket.percent)}`).join(":") : "\uB370\uC774\uD130 \uC5C6\uC74C",
    buckets
  };
}
function buildZonePeriodSummaries(pairs) {
  const zones = /* @__PURE__ */ new Map();
  for (const pair of pairs) {
    for (const zone of pair.calculation.zones) {
      const label = getZoneNameFromDay(pair.dayRecord, zone.zoneId);
      const current = zones.get(label) ?? { label, quantity: 0, deliveryMinutes: 0, efficiencies: [] };
      current.quantity += zone.counts.delivered;
      current.deliveryMinutes += zone.deliveryMinutes ?? 0;
      if (zone.efficiencyPerHour !== void 0 && zone.efficiencyPerHour > 0 && zone.efficiencyPerHour < 300) {
        current.efficiencies.push(zone.efficiencyPerHour);
      }
      zones.set(label, current);
    }
  }
  return [...zones.values()].filter((zone) => zone.quantity > 0 || zone.deliveryMinutes > 0).map((zone) => ({
    label: zone.label,
    quantity: zone.quantity,
    deliveryMinutes: zone.deliveryMinutes > 0 ? zone.deliveryMinutes : void 0,
    efficiencyPerHour: zone.efficiencies.length > 0 ? zone.efficiencies.reduce((sum, value) => sum + value, 0) / zone.efficiencies.length : void 0
  })).sort((left, right) => right.quantity - left.quantity);
}
function renderPeriodSummary(stats) {
  return `
    <div class="stats-grid">
      <article><span>\uCD1D \uBC30\uC1A1</span><strong>${stats.totalQuantity}\uAC1C</strong></article>
      <article><span>\uADFC\uBB34\uC77C</span><strong>${stats.workDays}\uC77C</strong></article>
      <article><span>\uD3C9\uADE0 \uD6A8\uC728</span><strong>${formatEff(stats.averageEfficiencyPerHour)}</strong></article>
      <article><span>\uC2A4\uCE94\uCC28</span><strong>${formatScanMiss(stats.scanMiss)}</strong></article>
      <article><span>\uBC30\uC1A1 \uC2DC\uAC04</span><strong>${formatMin(stats.deliveryMinutes)}</strong></article>
      <article><span>\uC77C \uD3C9\uADE0</span><strong>${stats.dailyAverage === void 0 ? "-" : `${Math.round(stats.dailyAverage)}\uAC1C`}</strong></article>
    </div>
  `;
}
function renderMonthlyVariation(stats) {
  return `
    <div class="stats-grid compact-stats">
      <article><span>\uCD5C\uACE0 \uBB3C\uB7C9</span><strong>${stats.maxDay ? `${formatShortDate(stats.maxDay.date)} \xB7 ${stats.maxDay.totalQuantity}\uAC1C` : "-"}</strong></article>
      <article><span>\uCD5C\uC800 \uBB3C\uB7C9</span><strong>${stats.minDay ? `${formatShortDate(stats.minDay.date)} \xB7 ${stats.minDay.totalQuantity}\uAC1C` : "-"}</strong></article>
    </div>
  `;
}
function renderZonePeriodCards(stats) {
  if (stats.zoneSummaries.length === 0) return `<p class="empty-state">\uAD6C\uC5ED\uBCC4 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</p>`;
  return `
    <div class="period-zone-list">
      ${stats.zoneSummaries.map((zone) => `
        <article>
          <strong>${zone.label}</strong>
          <p>${zone.quantity}\uAC1C \xB7 \uBC30\uC1A1 ${formatMin(zone.deliveryMinutes)} \xB7 \uD6A8\uC728 ${formatEff(zone.efficiencyPerHour)}</p>
        </article>
      `).join("")}
    </div>
  `;
}
function renderWeekdayAverage(days) {
  const buckets = ["\uC77C", "\uC6D4", "\uD654", "\uC218", "\uBAA9", "\uAE08", "\uD1A0"].map((label) => ({ label, total: 0, count: 0 }));
  for (const dayRecord of days) {
    const calculation = calculateDay(dayRecord);
    if (calculation.totals.deliveredCount <= 0) continue;
    const day = parseDateKey(dayRecord.date).getDay();
    buckets[day].total += calculation.totals.deliveredCount;
    buckets[day].count += 1;
  }
  return `
    <div class="stats-grid weekday-grid">
      ${buckets.map((bucket) => `
        <article>
          <span>${bucket.label}</span>
          <strong>${bucket.count > 0 ? `${Math.round(bucket.total / bucket.count)}\uAC1C` : "-"}</strong>
        </article>
      `).join("")}
    </div>
  `;
}
function renderWeekDayCards(history, start, end) {
  const dates = getDateKeysInRange(start, end);
  return `
    <div class="period-day-list">
      ${dates.map((date) => renderDayStatsCard(date, history.find((dayRecord) => dayRecord.date === date))).join("")}
    </div>
  `;
}
function renderMonthDayCards(history, start, end) {
  const today = todayKey();
  const dates = getDateKeysInRange(start, end).filter(
    (date) => date <= today || history.some((dayRecord) => dayRecord.date === date)
  );
  if (dates.length === 0) return `<p class="empty-state">\uC774 \uB2EC\uC5D0 \uD45C\uC2DC\uD560 \uB0A0\uC9DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</p>`;
  return `
    <div class="period-day-list">
      ${dates.map((date) => renderDayStatsCard(date, history.find((dayRecord) => dayRecord.date === date))).join("")}
    </div>
  `;
}
function renderDayStatsCard(date, dayRecord) {
  if (!dayRecord) {
    const detail2 = isVirtualRegularHoliday(date) ? "\uC815\uAE30\uD734\uBB34" : "\uB370\uC774\uD130 \uC5C6\uC74C";
    return `
      <article>
        <strong>${formatShortDate(date)}</strong>
        <span>${detail2}</span>
      </article>
    `;
  }
  const calculation = calculateDay(dayRecord);
  const total = calculation.totals.deliveredCount;
  const detail = total > 0 ? `${total}\uAC1C \xB7 ${formatEff(calculation.totals.efficiencyPerHour)}` : statusLabel(dayRecord.status);
  return `
    <article>
      <strong>${formatShortDate(date)}</strong>
      <span>${detail}</span>
    </article>
  `;
}
function renderMissingDateState(date) {
  if (!isVirtualRegularHoliday(date)) return `<p class="empty-state">${date} \uAE30\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.</p>`;
  return `
    <div class="holiday-state">
      <h3>${formatKoreanDateLabel(date)}</h3>
      <strong>\uC815\uAE30\uD734\uBB34</strong>
      <p>\uC800\uC7A5\uB41C \uAE30\uB85D\uC740 \uC5C6\uACE0, \uACFC\uAC70 \uC77C\uC694\uC77C/\uC6D4\uC694\uC77C \uBE48 \uB0A0\uC9DC\uB77C \uD654\uBA74\uC5D0\uC11C\uB9CC \uD734\uBB34\uB85C \uD45C\uC2DC\uD569\uB2C8\uB2E4. \uBC31\uC5C5 JSON\uC5D0\uB294 \uD734\uBB34 \uAE30\uB85D\uC744 \uC0C8\uB85C \uB9CC\uB4E4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.</p>
    </div>
  `;
}
function renderBackupSettingsTab() {
  return `
    <section class="panel">
      <h2>\uBC31\uC5C5\uC124\uC815</h2>
      <p class="hint">\uB370\uC774\uD130 \uBCF4\uD638, \uBCF5\uAD6C, \uCD08\uAE30\uD654, \uBC84\uC804 \uD655\uC778\uC744 \uD55C\uACF3\uC5D0 \uBAA8\uC558\uC2B5\uB2C8\uB2E4.</p>
      ${renderImportFeedback()}
      <div class="backup-list">
        <article>
          <strong>\uC571 \uBC84\uC804</strong>
          <p>${SETTINGS_VERSION_LABEL}</p>
        </article>
        <article>
          <strong>\uD654\uBA74 \uC815\uBCF4</strong>
          <p>${getViewportInfoLabel()}</p>
        </article>
        <article>
          <strong>\uC790\uB3D9\uC800\uC7A5</strong>
          <p>\uC785\uB825 \uD6C4 IndexedDB\uC5D0 \uC800\uC7A5\uB429\uB2C8\uB2E4. \uC704\uD5D8 \uC791\uC5C5 \uC804\uC5D0\uB294 \uBCC4\uB3C4 \uBC31\uC5C5\uC744 \uB9CC\uB4ED\uB2C8\uB2E4.</p>
        </article>
      </div>
      <div class="row-actions">
        <button data-action="snapshot">\uBC31\uC5C5 \uB0B4\uBCF4\uB0B4\uAE30</button>
        <button data-action="import-field-backup">\uD604\uC7A5\uC571 \uBC31\uC5C5 \uAC00\uC838\uC624\uAE30</button>
        <button class="danger" data-action="reset-confirm">\uC624\uB298 \uCD08\uAE30\uD654</button>
      </div>
    </section>
  `;
}
function getViewportInfoLabel() {
  if (typeof window === "undefined") return "\uD655\uC778 \uBD88\uAC00";
  const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
  return `${window.innerWidth}x${window.innerHeight} / DPR ${dpr}`;
}
function buildLogEntries(calculation) {
  if (!currentDay) return [];
  return buildLogEntriesForDay(currentDay, calculation);
}
function buildLogEntriesForDay(dayRecord, calculation) {
  const entries = [];
  const zoneCalcs = new Map(calculation.zones.map((zone) => [zone.zoneId, zone]));
  const orderedEvents = [...dayRecord.timeline].sort(compareLogEventOrder);
  for (const event of orderedEvents) {
    const zoneName = event.zoneId ? getZoneNameFromDay(dayRecord, event.zoneId) : void 0;
    const zoneCalc = event.zoneId ? zoneCalcs.get(event.zoneId) : void 0;
    const payload = event.payload;
    const time = formatTime(event.at);
    if (event.type === "depart_jinjeop") {
      const total = typeof payload?.total === "number" ? `\uC608\uC0C1 \uC218\uB7C9: ${payload.total}\uAC1C` : "\uC608\uC0C1 \uC218\uB7C9 \uC5C6\uC74C";
      entries.push({ title: "\uC9C4\uC811 \uCD9C\uBC1C", time, detail: total, kind: "depart" });
    } else if (event.type === "arrive_cheongnyangni") {
      entries.push({ title: "\uCCAD\uB7C9\uB9AC \uB3C4\uCC29", time, detail: `\uC6B4\uC804: ${formatMin(getDriveMinutesForDay(dayRecord))}`, kind: "arrive" });
    } else if (event.type === "zone_start") {
      const detail = event.zoneId === "miju" ? buildMijuStartDetailForDay(dayRecord) : buildMovementDetail(zoneCalc);
      entries.push({ title: `${getZoneOrderLabelForDay(dayRecord, event.zoneId)} \uC2DC\uC791 \xB7 ${zoneName}`, time, detail, kind: "zone" });
    } else if (event.type === "delivery_start") {
      entries.push({ title: "\uBC14\uB85C \uBC30\uC1A1 \uC2DC\uC791", time, detail: zoneName ? `${zoneName} \uC9C4\uD589 \uC911` : void 0, kind: "zone" });
    } else if (event.type === "sorting_start") {
      entries.push({ title: "\uC815\uB9AC \uC2DC\uC791", time, detail: buildMovementDetail(zoneCalc), kind: "sorting" });
    } else if (event.type === "sorting_end") {
      entries.push({ title: "\uC815\uB9AC \uC644\uB8CC", time, detail: `\uC815\uB9AC: ${formatMin(zoneCalc?.sortingMinutes)}`, kind: "sorting" });
    } else if (event.type === "zone_end") {
      const delivered = typeof payload?.delivered === "number" ? `${payload.delivered}\uAC1C` : "\uC218\uB7C9 \uC5C6\uC74C";
      const delivery = zoneCalc?.deliveryMinutes !== void 0 ? ` \xB7 ${formatMin(zoneCalc.deliveryMinutes)}` : "";
      const efficiency = zoneCalc?.efficiencyPerHour !== void 0 ? ` \xB7 ${Math.round(zoneCalc.efficiencyPerHour)}\uAC1C/\uC2DC\uAC04` : "";
      entries.push({ title: `${zoneName} \uC644\uB8CC`, time, detail: `${delivered}${delivery}${efficiency}`, kind: "done" });
    } else if (event.type === "incident") {
      const title = typeof payload?.title === "string" ? payload.title : "\uC774\uBCA4\uD2B8";
      const minutes = typeof payload?.minutes === "number" ? `${payload.minutes}\uBD84` : "\uC2DC\uAC04 \uBBF8\uC785\uB825";
      entries.push({ title, time, detail: `${minutes}${zoneName ? ` / ${zoneName}` : ""}`, kind: "event" });
    } else if (event.type === "helper_add") {
      entries.push({ title: "\uB3C4\uC6B0\uBBF8 \uCD94\uAC00", time, detail: zoneName, kind: "event" });
    } else if (event.type === "day_close") {
      entries.push({ title: "\uC5C5\uBB34 \uC885\uB8CC", time, detail: "\uC624\uB298 \uC5C5\uBB34\uAC00 \uC885\uB8CC\uB410\uC2B5\uB2C8\uB2E4.", kind: "done" });
    }
  }
  if (entries.length === 0) {
    entries.push({ title: "\uC5C5\uBB34 \uC2DC\uC791 \uC804", time: "-", detail: "\uC9C4\uC811 \uCD9C\uBC1C \uBC84\uD2BC\uC744 \uB20C\uB7EC \uC2DC\uC791\uD558\uC138\uC694.", kind: "event" });
  }
  return entries;
}
function getDriveMinutesForDay(dayRecord) {
  const depart = dayRecord.timeline.find((event) => event.type === "depart_jinjeop");
  const arrive = dayRecord.timeline.find((event) => event.type === "arrive_cheongnyangni");
  return depart?.at && arrive?.at ? diffMinutesFromIso(depart.at, arrive.at) : void 0;
}
function compareLogEventOrder(a, b) {
  const byMinute = minuteTimestamp(a.at) - minuteTimestamp(b.at);
  if (byMinute !== 0) return byMinute;
  const byAdjacentZoneFlow = adjacentZoneFlowPriority(a) - adjacentZoneFlowPriority(b);
  if (byAdjacentZoneFlow !== 0) return byAdjacentZoneFlow;
  const byPriority = logEventPriority(a) - logEventPriority(b);
  if (byPriority !== 0) return byPriority;
  const byTime = Date.parse(a.at) - Date.parse(b.at);
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}
function adjacentZoneFlowPriority(event) {
  if (event.type === "zone_end") return 0;
  if (event.type === "zone_start") return 1;
  return 0;
}
function minuteTimestamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  date.setSeconds(0, 0);
  return date.getTime();
}
function logEventPriority(event) {
  switch (event.type) {
    case "depart_jinjeop":
      return 10;
    case "arrive_cheongnyangni":
      return 20;
    case "zone_start":
      return 30;
    case "sorting_start":
      return 40;
    case "sorting_end":
      return 50;
    case "delivery_start":
      return 60;
    case "incident":
    case "helper_add":
      return 70;
    case "zone_end":
      return 80;
    case "day_close":
      return 90;
    default:
      return 100;
  }
}
function buildMijuStartDetailForDay(dayRecord) {
  const checkpoint = getMijuCheckpointForDay(dayRecord);
  if (!checkpoint || checkpoint.aTotal <= 0) return void 0;
  return `1\uB3D9 ${checkpoint.one} \xB7 2\uB3D9 ${checkpoint.two} \xB7 3\uB3D9 ${checkpoint.three} (A\uD569\uACC4:${checkpoint.aTotal}\uAC1C)`;
}
function buildMovementDetail(zoneCalc) {
  if (zoneCalc?.movementMinutes === void 0) return void 0;
  return `\uC774\uB3D9: ${formatMin(zoneCalc.movementMinutes)}`;
}
function getZoneOrderLabelForDay(dayRecord, zoneId) {
  if (!zoneId) return "\uAD6C\uC5ED";
  const zone = dayRecord.zones.find((item) => item.id === zoneId);
  return zone ? `${zone.order}\uAD6C\uC5ED` : "\uAD6C\uC5ED";
}
function renderCurrentStep() {
  if (!currentDay) return "";
  if (hasEvent("day_close")) return renderFinishedStep();
  if (!hasEvent("depart_jinjeop")) return renderDepartStep();
  if (!hasEvent("arrive_cheongnyangni")) return renderArriveStep();
  if (isUnpaidHelperDay(currentDay) && !hasEvent("day_close")) return renderUnpaidHelperCloseStep();
  if (currentDay.zones.length === 0) return renderWorkOrderStep();
  const activeZone = getCurrentWorkZone();
  if (activeZone) {
    if (!hasZoneStarted(activeZone.id)) return renderZoneStartStep(activeZone);
    if (!hasZoneEnded(activeZone.id)) return renderZoneWorkStep(activeZone);
  }
  if (!hasEvent("day_close")) return renderExtraZoneChoiceStep();
  return renderFinishedStep();
}
function renderDepartStep() {
  return `
    <section class="panel focus">
      <p class="step">1 / \uCD9C\uBC1C</p>
      <h2>\uC9C4\uC811 \uCD9C\uBC1C</h2>
      <label>\uC608\uC0C1 \uC218\uB7C9<input id="expected-count" type="number" inputmode="numeric" min="0" max="${MAX_REASONABLE_EXPECTED}" placeholder="\uC608: 285"></label>
      <button data-action="depart">\uCD9C\uBC1C \uAE30\uB85D</button>
    </section>
  `;
}
function renderArriveStep() {
  return `
    <section class="panel focus">
      <p class="step">2 / \uB3C4\uCC29</p>
      <h2>\uCCAD\uB7C9\uB9AC \uB3C4\uCC29</h2>
      <p class="hint">\uB3C4\uCC29\uC744 \uB204\uB974\uBA74 \uC6B4\uC804 \uC2DC\uAC04\uC774 \uBCF4\uC874\uB418\uACE0 \uB2E4\uC74C \uB2E8\uACC4\uB85C \uB118\uC5B4\uAC11\uB2C8\uB2E4.</p>
      <button data-action="arrive">\uB3C4\uCC29 \uAE30\uB85D</button>
    </section>
  `;
}
function renderUnpaidHelperCloseStep() {
  return `
    <section class="panel focus">
      <p class="step">\uBB34\uBCF4\uC218 \uB3C4\uC6B0\uBBF8</p>
      <h2>\uBB34\uBCF4\uC218 \uB3C4\uC6B0\uBBF8\uB0A0 \uC9C4\uD589 \uC911</h2>
      <p class="hint">\uCCAD\uB7C9\uB9AC \uB3C4\uCC29\uACFC \uC6B4\uC804 \uC2DC\uAC04\uC740 \uAE30\uB85D\uB410\uC2B5\uB2C8\uB2E4. \uC2E4\uC81C \uB3C4\uC6B0\uBBF8 \uC5C5\uBB34\uAC00 \uB05D\uB09C \uC2DC\uAC01\uC73C\uB85C \uC885\uB8CC\uD558\uC138\uC694.</p>
      <label>\uC885\uB8CC \uC2DC\uAC01<input id="helper-close-at" type="datetime-local" value="${formatTimeInputValue(/* @__PURE__ */ new Date())}"></label>
      <div class="segmented">
        <button data-action="close-day">\uC785\uB825 \uC2DC\uAC01\uC73C\uB85C \uC885\uB8CC</button>
        <button data-action="close-day-now">\uC9C0\uAE08 \uC885\uB8CC</button>
      </div>
    </section>
  `;
}
function renderWorkOrderStep() {
  return `
    <section class="panel focus">
      <p class="step">3 / \uC624\uB298 \uC21C\uC11C</p>
      <h2>\uC791\uC5C5 \uC21C\uC11C</h2>
      <p class="hint">\uAE30\uBCF8 \uC21C\uC11C\uB294 \uBBF8\uC8FC, \uD790\uC2A4\uD14C\uC774\uD2B8, \uB300\uCCB4\uBC30\uC1A1\uC785\uB2C8\uB2E4. \uB2E4\uC74C \uD654\uBA74\uC5D0\uC11C \uD654\uC0B4\uD45C\uB85C \uBC14\uB85C \uBC14\uAFC0 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</p>
      <button data-action="prepare-default-order">\uC624\uB298 \uC21C\uC11C \uC5F4\uAE30</button>
    </section>
  `;
}
function renderZoneStartStep(zone) {
  const orderEditor = hasAnyZoneStarted() ? "" : renderZoneOrderEditor();
  return `
    <section class="panel focus">
      <p class="step">${zone.order} / ${escapeHtml(zone.name)}</p>
      <h2>${escapeHtml(zone.name)} \uC2DC\uC791</h2>
      <p class="hint">${zone.id === "miju" ? "\uBBF8\uC8FC\uB294 1,2,3\uB3D9\uACFC \uB098\uBA38\uC9C0 \uC218\uB7C9\uC744 \uB098\uB220 \uC785\uB825\uD569\uB2C8\uB2E4." : "\uBC30\uC1A1 \uC218\uB7C9\uACFC \uC815\uB9AC \uC2DC\uC791/\uC644\uB8CC\uB97C \uBD84\uB9AC\uD574\uC11C \uAE30\uB85D\uD569\uB2C8\uB2E4."}</p>
      <div class="segmented">
        <button data-action="zone-start" data-zone="${zone.id}">${escapeHtml(zone.name)} \uC2DC\uC791</button>
        ${isExtraZone(zone.id) ? `<button class="secondary" data-action="skip-zone" data-zone="${zone.id}">${escapeHtml(zone.name)} \uC5C6\uC74C</button>` : ""}
      </div>
      ${orderEditor}
    </section>
  `;
}
function renderZoneOrderEditor() {
  const zones = getOrderedZones();
  return `
    <div class="order-editor">
      <strong>\uC624\uB298 \uC791\uC5C5 \uC21C\uC11C</strong>
      <p class="hint">\uC791\uC5C5 \uC2DC\uC791 \uC804\uC5D0\uB294 \uD654\uC0B4\uD45C\uB85C \uC21C\uC11C\uB97C \uBC14\uAFC0 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</p>
      ${zones.map((zone, index) => `
        <div class="order-row">
          <span>${index + 1}. ${escapeHtml(zone.name)}</span>
          <div>
            <button data-action="move-zone-up" data-zone="${zone.id}" ${index === 0 ? "disabled" : ""} title="\uC704\uB85C">\u25B2</button>
            <button data-action="move-zone-down" data-zone="${zone.id}" ${index === zones.length - 1 ? "disabled" : ""} title="\uC544\uB798\uB85C">\u25BC</button>
          </div>
        </div>
      `).join("")}
      <div class="segmented">
        <button data-action="add-alt-zone-to-order">\uB300\uCCB4\uBC30\uC1A1 \uCD94\uAC00</button>
        <button data-action="add-custom-zone-to-order">\uCD94\uAC00\uAD6C\uC5ED \uCD94\uAC00</button>
      </div>
      <label>\uCD94\uAC00\uAD6C\uC5ED \uC774\uB984<input id="custom-zone-name" type="text" maxlength="24" placeholder="\uC608: \uC0C1\uAC00 \uCD94\uAC00"></label>
    </div>
  `;
}
function renderZoneWorkStep(zone) {
  if (zone.id === "miju") return renderMijuWorkStep();
  if (zone.id === "hils") return renderHilsWorkStep();
  return renderExtraZoneWorkStep(zone);
}
function renderMijuWorkStep() {
  const checkpoint = getMijuCheckpoint();
  const savedText = checkpoint ? `A\uAD6C\uAC04 \uC800\uC7A5\uB428: 1\uB3D9 ${checkpoint.one} / 2\uB3D9 ${checkpoint.two} / 3\uB3D9 ${checkpoint.three} / \uD569\uACC4 ${checkpoint.aTotal}` : "1/2/3\uB3D9\uC744 \uBA3C\uC800 \uAE30\uB85D\uD55C \uB4A4 \uBBF8\uC8FC \uC804\uCCB4 \uC218\uB7C9\uC744 \uB123\uC73C\uBA74 \uB098\uBA38\uC9C0\uB294 \uC790\uB3D9 \uACC4\uC0B0\uB429\uB2C8\uB2E4.";
  return `
    <section class="panel focus">
      <p class="step">3 / \uBBF8\uC8FC</p>
      <h2>\uBBF8\uC8FC \uC218\uB7C9 \uC785\uB825</h2>
      <p class="hint">${savedText}</p>
      <div class="form-grid compact-grid">
        <label>1\uB3D9<input id="miju-1-count" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${checkpoint?.one ?? ""}" placeholder="\uC608: 44"></label>
        <label>2\uB3D9<input id="miju-2-count" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${checkpoint?.two ?? ""}" placeholder="\uC608: 55"></label>
        <label>3\uB3D9<input id="miju-3-count" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${checkpoint?.three ?? ""}" placeholder="\uC608: 54"></label>
      </div>
      <button data-action="save-miju-detail" data-zone="miju">1/2/3\uB3D9 \uAE30\uB85D</button>
      ${checkpoint ? '<button class="secondary" data-action="clear-miju-detail" data-zone="miju">1/2/3\uB3D9 \uAE30\uB85D \uCD08\uAE30\uD654</button>' : ""}
      <label>\uBBF8\uC8FC \uC804\uCCB4 \uC218\uB7C9<input id="miju-total-count" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" placeholder="\uC608: 321"></label>
      <div class="miju-preview">
        <strong>\uC800\uC7A5 \uAE30\uC900</strong>
        <span>\uB098\uBA38\uC9C0\uB294 \uBBF8\uC8FC \uC804\uCCB4 \uC218\uB7C9\uC5D0\uC11C 1/2/3\uB3D9 \uD569\uACC4\uB97C \uBE7C\uC11C \uC790\uB3D9 \uACC4\uC0B0\uB429\uB2C8\uB2E4.</span>
      </div>
      <button data-action="zone-end" data-zone="miju">\uBBF8\uC8FC \uC644\uB8CC</button>
    </section>
  `;
}
function renderHilsWorkStep() {
  return renderGenericZoneWorkStep("hils", {
    step: "4 / \uD790\uC2A4\uD14C\uC774\uD2B8",
    title: "\uD790\uC2A4\uD14C\uC774\uD2B8 \uC785\uB825",
    countInputId: "hils-count",
    endLabel: "\uD790\uC2A4\uD14C\uC774\uD2B8 \uC644\uB8CC"
  });
}
function renderExtraZoneChoiceStep() {
  const extraCount = getExtraZones().length;
  return `
    <section class="panel focus">
      <p class="step">5 / \uCD94\uAC00 \uAD6C\uC5ED</p>
      <h2>\uB300\uCCB4\uBC30\uC1A1 \uB610\uB294 \uAD6C\uC5ED \uCD94\uAC00</h2>
      <p class="hint">\uD790\uC2A4 \uC774\uD6C4\uC5D0 \uC0DD\uAE34 \uB300\uCCB4\uBC30\uC1A1, \uC784\uC2DC \uAD6C\uC5ED, \uCD94\uAC00 \uBB3C\uB7C9\uC744 \uC5EC\uAE30\uC5D0 \uBD99\uC785\uB2C8\uB2E4. \uC5C6\uC73C\uBA74 \uBC14\uB85C \uC5C5\uBB34 \uC885\uB8CC\uB85C \uB118\uC5B4\uAC00\uBA74 \uB429\uB2C8\uB2E4.</p>
      <div class="segmented">
        <button data-action="add-alt-zone">\uB300\uCCB4\uBC30\uC1A1 \uCD94\uAC00</button>
        <button data-action="close-day">\uCD94\uAC00 \uC5C6\uC774 \uC885\uB8CC</button>
      </div>
      <div class="form-grid extra-zone-form">
        <label>\uAD6C\uC5ED \uC774\uB984<input id="custom-zone-name" type="text" maxlength="24" placeholder="\uC608: \uC0C1\uAC00 \uCD94\uAC00"></label>
        <button data-action="add-custom-zone">\uAD6C\uC5ED \uCD94\uAC00</button>
      </div>
      ${extraCount > 0 ? `<p class="hint">\uC624\uB298 \uCD94\uAC00 \uAD6C\uC5ED ${extraCount}\uAC1C\uAC00 \uAE30\uB85D\uB410\uC2B5\uB2C8\uB2E4.</p>` : ""}
    </section>
  `;
}
function renderExtraZoneWorkStep(zone) {
  return renderGenericZoneWorkStep(zone.id, {
    step: `\uCD94\uAC00 / ${zone.name}`,
    title: `${zone.name} \uC785\uB825`,
    countInputId: "extra-count",
    endLabel: `${zone.name} \uC644\uB8CC`
  });
}
function renderGenericZoneWorkStep(zoneId, options) {
  const sortingStarted = hasZoneEvent(zoneId, "sorting_start");
  const sortingEnded = hasZoneEvent(zoneId, "sorting_end");
  const deliveryStarted = hasZoneEvent(zoneId, "delivery_start");
  const isReadyForCount = deliveryStarted || sortingEnded;
  return `
    <section class="panel focus">
      <p class="step">${options.step}</p>
      <h2>${options.title}</h2>
      ${!sortingStarted && !deliveryStarted ? `
        <div class="field-actions">
          <button data-action="sorting-start" data-zone="${zoneId}">\uC815\uB9AC \uC2DC\uC791</button>
          <button class="secondary" data-action="delivery-start" data-zone="${zoneId}">\uBC14\uB85C \uBC30\uC1A1 \uC2DC\uC791</button>
        </div>
        <p class="hint">\uAE30\uBCF8 \uD750\uB984\uC740 \uC815\uB9AC \uC2DC\uC791\uC785\uB2C8\uB2E4. \uC815\uB9AC \uC5C6\uC774 \uBC14\uB85C \uBC30\uC1A1\uD560 \uB54C\uB9CC \uBCF4\uC870 \uBC84\uD2BC\uC744 \uB204\uB985\uB2C8\uB2E4.</p>
      ` : ""}
      ${sortingStarted && !sortingEnded ? `
        <button data-action="sorting-end" data-zone="${zoneId}">\uC815\uB9AC \uC644\uB8CC</button>
        <p class="hint">\uC815\uB9AC\uAC00 \uB05D\uB098\uBA74 \uBC14\uB85C \uC815\uB9AC \uC644\uB8CC\uB97C \uB204\uB974\uACE0 \uC218\uB7C9 \uC785\uB825\uC73C\uB85C \uB118\uC5B4\uAC11\uB2C8\uB2E4.</p>
      ` : ""}
      ${isReadyForCount ? `
        <label>\uC804\uCCB4 \uC218\uB7C9<input id="${options.countInputId}" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" placeholder="\uC608: 560"></label>
        <button data-action="zone-end" data-zone="${zoneId}">${options.endLabel}</button>
        <p class="hint">\uB4A4 \uAD6C\uC5ED\uC5D0\uC11C\uB294 \uB2F9\uC77C \uC804\uCCB4 \uC218\uB7C9\uC744 \uB123\uC5B4\uB3C4 \uB429\uB2C8\uB2E4. \uC774\uC804 \uC644\uB8CC \uC218\uB7C9\uC740 \uC571\uC774 \uC790\uB3D9\uC73C\uB85C \uBE8D\uB2C8\uB2E4.</p>
      ` : ""}
    </section>
  `;
}
function renderEventPanel() {
  if (!currentDay || !hasEvent("depart_jinjeop") || hasEvent("day_close")) return "";
  const defaultScope = getDefaultEventScope();
  return `
    <section class="panel event-panel">
      <h2>\uC774\uBCA4\uD2B8 \uAE30\uB85D</h2>
      <p class="hint">\uC2DD\uC0AC, \uC5C5\uCCB4 \uBC29\uBB38, \uBC18\uD488, \uC0C1\uCC28, \uB300\uAE30\uCC98\uB7FC \uBC30\uC1A1 \uC678 \uC2DC\uAC04\uC744 \uB530\uB85C \uB0A8\uAE41\uB2C8\uB2E4.</p>
      <div class="form-grid event-grid">
        <label>\uC720\uD615
          <select id="event-title">
            ${EVENT_TYPES.map((type) => `<option value="${type}">${type}</option>`).join("")}
          </select>
        </label>
        <label>\uC704\uCE58
          <select id="event-scope">
            ${getEventScopeOptions().map((option) => `<option value="${option.value}" ${option.value === defaultScope ? "selected" : ""}>${option.label}</option>`).join("")}
          </select>
        </label>
        <label>\uC2DC\uAC01<input id="event-at" type="datetime-local" value="${formatTimeInputValue(/* @__PURE__ */ new Date())}"></label>
        <label>\uC18C\uC694\uBD84<input id="event-minutes" type="number" inputmode="numeric" min="0" max="240" placeholder="\uC608: 10"></label>
        <label class="wide">\uBA54\uBAA8<input id="event-note" type="text" maxlength="80" placeholder="\uC608: \uD790\uC2A4 \uC804 \uC5C5\uCCB4 \uBC29\uBB38"></label>
      </div>
      <button data-action="add-event">\uC774\uBCA4\uD2B8 \uCD94\uAC00</button>
    </section>
  `;
}
function renderFinishedStep() {
  return `
    <section class="panel focus">
      <p class="step">\uC644\uB8CC</p>
      <h2>\uC624\uB298 \uC5C5\uBB34\uAC00 \uC885\uB8CC\uB410\uC2B5\uB2C8\uB2E4</h2>
      <p class="hint">\uB9AC\uD3EC\uD2B8\uB97C \uBCF5\uC0AC\uD558\uAC70\uB098, \uC544\uB798 \uC644\uB8CC \uAD6C\uC5ED \uC218\uC815\uC5D0\uC11C \uC798\uBABB \uCC0D\uC740 \uAC12\uC744 \uACE0\uCE60 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</p>
    </section>
  `;
}
function renderCleanupCorrectionPanel(zoneId) {
  return `
    <section class="warning">
      <strong>\uC815\uB9AC \uC644\uB8CC\uAC00 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.</strong>
      <p>${getZoneName2(zoneId)} \uC815\uB9AC \uC2DC\uAC04\uC744 \uC785\uB825\uD558\uBA74 \uC885\uB8CC \uC2DC\uAC01 \uAE30\uC900\uC73C\uB85C \uBCF4\uC815\uD569\uB2C8\uB2E4.</p>
      <div class="form-grid">
        <label>\uC815\uB9AC \uC2DC\uAC04<input id="cleanup-input" type="number" inputmode="numeric" min="1" value="30"></label>
        <label>\uCC98\uB9AC \uBC29\uC2DD<input value="\uC885\uB8CC\uC2DC\uAC01 - \uC785\uB825\uBD84" readonly></label>
      </div>
      <div class="segmented">
        <button data-action="fix-cleanup" data-zone="${zoneId}">\uBCF4\uC815 \uC801\uC6A9</button>
        <button data-action="skip-cleanup" data-zone="${zoneId}">\uC815\uB9AC \uC5C6\uC74C</button>
      </div>
    </section>
  `;
}
function renderZoneCards() {
  return `<div class="zone-list">${getOrderedZones().map((zone) => renderZoneCard(zone.id)).join("")}</div>`;
}
function renderZoneCard(zoneId) {
  if (!currentDay) return "";
  const zone = currentDay.zones.find((item) => item.id === zoneId);
  const start = latestZoneEvent(zoneId, "zone_start");
  const end = latestZoneEvent(zoneId, "zone_end");
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  const sortingEnd = latestZoneEvent(zoneId, "sorting_end");
  const count = readDeliveredPayload(end);
  const showSorting = zoneId !== "miju";
  const status = end ? "\uC644\uB8CC" : start ? "\uC9C4\uD589" : "\uB300\uAE30";
  return `
    <article class="zone-card">
      <div>
        <strong>${escapeHtml(zone?.name ?? getZoneName2(zoneId))}</strong>
        <span>${status}</span>
      </div>
      <p>\uC218\uB7C9 ${count}\uAC1C</p>
      <p>\uC2DC\uC791 ${start ? formatTime(start.at) : "-"} / \uC885\uB8CC ${end ? formatTime(end.at) : "-"}</p>
      ${showSorting ? `<p>\uC815\uB9AC ${sortingStart ? formatTime(sortingStart.at) : "-"} ~ ${sortingEnd ? formatTime(sortingEnd.at) : "-"}</p>` : ""}
      ${end ? renderCompletedZoneEditForm(zoneId) : ""}
    </article>
  `;
}
function renderCompletedZoneEditForm(zoneId) {
  const start = latestZoneEvent(zoneId, "zone_start");
  const end = latestZoneEvent(zoneId, "zone_end");
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  const sortingEnd = latestZoneEvent(zoneId, "sorting_end");
  const payload = end?.payload;
  const delivered = typeof payload?.delivered === "number" ? payload.delivered : 0;
  const failed = typeof payload?.failed === "number" ? payload.failed : 0;
  const extra = typeof payload?.extra === "number" ? payload.extra : 0;
  const one = typeof payload?.building1Total === "number" ? payload.building1Total : 0;
  const two = typeof payload?.building2Total === "number" ? payload.building2Total : 0;
  const three = typeof payload?.building3Total === "number" ? payload.building3Total : 0;
  const aTotal = typeof payload?.aTotal === "number" ? payload.aTotal : one + two + three || delivered;
  const bTotal = typeof payload?.restTotal === "number" ? payload.restTotal : typeof payload?.bTotal === "number" ? payload.bTotal : 0;
  const quantitySummary = zoneId === "miju" ? `\uBBF8\uC8FC \uCD1D\uD569 ${delivered}\uAC1C / A ${aTotal}\uAC1C / \uB098\uBA38\uC9C0 ${bTotal}\uAC1C` : `\uBC30\uC1A1 ${delivered}\uAC1C / \uC2E4\uD328 ${failed}\uAC1C / \uCD94\uAC00 ${extra}\uAC1C`;
  return `
    <details class="zone-edit">
      <summary>\uC644\uB8CC \uAE30\uB85D \uC218\uC815</summary>
      <p class="edit-summary">${quantitySummary}</p>
      <div class="form-grid edit-time-grid">
        <label>\uC2DC\uC791 \uC2DC\uAC04<input id="edit-${zoneId}-start" type="time" value="${formatIsoForTimeInput(start?.at)}"></label>
        <label>\uC885\uB8CC \uC2DC\uAC04<input id="edit-${zoneId}-end" type="time" value="${formatIsoForTimeInput(end?.at)}"></label>
      </div>
      <div class="form-grid edit-count-grid ${zoneId === "miju" ? "miju-edit-grid" : "generic-edit-grid"}">
        ${zoneId === "miju" ? `
            <label>1\uB3D9<input id="edit-${zoneId}-1" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${one || ""}"></label>
            <label>2\uB3D9<input id="edit-${zoneId}-2" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${two || ""}"></label>
            <label>3\uB3D9<input id="edit-${zoneId}-3" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${three || ""}"></label>
            <label class="edit-miju-total">\uBBF8\uC8FC \uC804\uCCB4<input id="edit-${zoneId}-total" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${delivered}"></label>
            <label class="edit-miju-rest">\uB098\uBA38\uC9C0<input value="${bTotal || ""}" readonly></label>
          ` : `
            <label class="edit-delivered">\uBC30\uC1A1 \uC218\uB7C9<input id="edit-${zoneId}-delivered" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${delivered}"></label>
            <label>\uC815\uB9AC \uC2DC\uC791<input id="edit-${zoneId}-sorting-start" type="time" value="${formatIsoForTimeInput(sortingStart?.at)}"></label>
            <label>\uC815\uB9AC \uC644\uB8CC<input id="edit-${zoneId}-sorting-end" type="time" value="${formatIsoForTimeInput(sortingEnd?.at)}"></label>
          `}
      </div>
      <div class="form-grid edit-extra-grid">
        <label>\uC2E4\uD328<input id="edit-${zoneId}-failed" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${failed}"></label>
        <label>\uCD94\uAC00<input id="edit-${zoneId}-extra" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${extra}"></label>
      </div>
      <button data-action="save-zone-edit" data-zone="${zoneId}">\uC218\uC815 \uC800\uC7A5</button>
    </details>
  `;
}
function renderQuantityComparison(title, comparison) {
  return `
    <article class="ratio-card">
      <div>
        <strong>${title}</strong>
        <span>${comparison.ratioLabel}</span>
      </div>
      <p>\uAE30\uC900: \uBC30\uC1A1 \uC644\uB8CC \uC218\uB7C9 \xB7 \uD569\uACC4 ${comparison.totalQuantity}\uAC1C</p>
      <div class="ratio-bars">
        ${comparison.buckets.map((bucket) => `
          <div>
            <label>${formatBucketLabel(bucket.key)} ${bucket.quantity}\uAC1C \xB7 ${bucket.percent}%</label>
            <span style="--w:${bucket.percent}%"></span>
          </div>
        `).join("")}
      </div>
    </article>
  `;
}
function formatBucketLabel(key) {
  if (key === "miju") return "\uBBF8\uC8FC";
  if (key === "hils") return "\uD790\uC2A4";
  return "\uB300\uCCB4\uBC30\uC1A1\uC9C0";
}
function formatBucketShortLabel(key) {
  if (key === "miju") return "\uBBF8";
  if (key === "hils") return "\uD790";
  return "\uB300";
}
function getZoneBucket(dayRecord, zoneId) {
  if (zoneId === "miju") return "miju";
  if (zoneId === "hils") return "hils";
  const name = getZoneNameFromDay(dayRecord, zoneId);
  return name.includes("\uD790\uC2A4") ? "hils" : "alternate";
}
function getZoneNameFromDay(dayRecord, zoneId) {
  const existing = dayRecord.zones.find((zone) => zone.id === zoneId)?.name;
  if (existing) return existing;
  if (zoneId === "miju") return "\uBBF8\uC8FC";
  if (zoneId === "hils") return "\uD790\uC2A4\uD14C\uC774\uD2B8";
  if (zoneId.startsWith("alt-")) return "\uB300\uCCB4\uBC30\uC1A1";
  return "\uCD94\uAC00 \uAD6C\uC5ED";
}
function getExpectedTotalForDay(dayRecord) {
  const depart = dayRecord.timeline.find((event) => event.type === "depart_jinjeop");
  const payload = depart?.payload;
  return typeof payload?.total === "number" && payload.total > 0 ? payload.total : void 0;
}
function sumDefined2(values) {
  const defined = values.filter((value) => typeof value === "number");
  if (defined.length === 0) return void 0;
  return defined.reduce((sum, value) => sum + value, 0);
}
function formatScanMiss(value) {
  if (value === void 0) return "-";
  if (value > 0) return `+${value}\uAC1C`;
  return `${value}\uAC1C`;
}
function getWeekRange(offset) {
  const base = parseDateKey(todayKey());
  const start = new Date(base);
  start.setDate(base.getDate() - base.getDay() + offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}
function getMonthRange(offset) {
  const base = parseDateKey(todayKey());
  const start = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const end = new Date(base.getFullYear(), base.getMonth() + offset + 1, 0);
  return { start, end };
}
function getHistoryInRange(history, start, end) {
  const startKey = dateKeyFromDate(start);
  const endKey = dateKeyFromDate(end);
  return history.filter((dayRecord) => dayRecord.date >= startKey && dayRecord.date <= endKey);
}
function isVirtualRegularHoliday(date) {
  return date < todayKey() && isRegularOffDate(date);
}
function isRegularOffDate(date) {
  const day = parseDateKey(date).getDay();
  return day === 0 || day === 1;
}
function getDateKeysInRange(start, end) {
  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(dateKeyFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
function parseDateKey(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}
function dateKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function formatDateRange(start, end) {
  return `${formatShortDate(dateKeyFromDate(start))} ~ ${formatShortDate(dateKeyFromDate(end))}`;
}
function formatMonthTitle(date) {
  return `${date.getFullYear()}\uB144 ${date.getMonth() + 1}\uC6D4`;
}
function formatKoreanDateLabel(date) {
  const parsed = parseDateKey(date);
  return `${parsed.getFullYear()}\uB144 ${parsed.getMonth() + 1}\uC6D4 ${parsed.getDate()}\uC77C ${weekdayLabel(parsed)}`;
}
function formatShortDate(date) {
  const parsed = parseDateKey(date);
  return `${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")} (${weekdayLabel(parsed, true)})`;
}
function weekdayLabel(date, short = false) {
  const labels = short ? ["\uC77C", "\uC6D4", "\uD654", "\uC218", "\uBAA9", "\uAE08", "\uD1A0"] : ["\uC77C\uC694\uC77C", "\uC6D4\uC694\uC77C", "\uD654\uC694\uC77C", "\uC218\uC694\uC77C", "\uBAA9\uC694\uC77C", "\uAE08\uC694\uC77C", "\uD1A0\uC694\uC77C"];
  return labels[date.getDay()] ?? "";
}
function renderImportFeedback() {
  if (!lastImportFeedback) return "";
  const imported = lastImportFeedback.importedDates.length > 0 ? lastImportFeedback.importedDates.join(", ") : "\uC5C6\uC74C";
  const skipped = lastImportFeedback.skippedDates.length > 0 ? lastImportFeedback.skippedDates.join(", ") : "\uC5C6\uC74C";
  return `
    <aside class="import-result">
      <strong>\uD604\uC7A5\uC571 \uBC31\uC5C5 \uAC00\uC838\uC624\uAE30 \uACB0\uACFC</strong>
      <p>${escapeHtml(lastImportFeedback.message)}</p>
      <ul>
        <li>\uD30C\uC77C: ${escapeHtml(lastImportFeedback.fileName)}</li>
        <li>\uC778\uC2DD\uD55C \uB0A0\uC9DC: ${lastImportFeedback.recognizedDays}\uC77C</li>
        <li>\uAC00\uC838\uC628 \uAE30\uB85D: ${lastImportFeedback.importedCount}\uC77C (${escapeHtml(imported)})</li>
        <li>\uBCF5\uC0AC/\uAC74\uB108\uB700: ${lastImportFeedback.skippedCount}\uC77C (${escapeHtml(skipped)})</li>
        <li>\uC0AC\uC804 \uC2A4\uB0C5\uC0F7: ${lastImportFeedback.snapshotCreated ? "\uC0DD\uC131\uB428" : "\uC5C6\uC74C"}</li>
        <li>\uBC31\uC5C5 \uD30C\uC77C: ${lastImportFeedback.backupExported ? "\uB0B4\uBCF4\uB0B4\uAE30 \uC2DC\uB3C4\uB428" : "\uC5C6\uC74C"}</li>
        ${lastImportFeedback.activeDate ? `<li>\uD604\uC7AC \uD45C\uC2DC \uB0A0\uC9DC: ${escapeHtml(lastImportFeedback.activeDate)}</li>` : ""}
      </ul>
    </aside>
  `;
}
async function handleAction(button) {
  if (!currentDay) return;
  const action = button.dataset.action ?? "";
  const zoneId = button.dataset.zone;
  if (action === "set-tab") {
    const tab = button.dataset.tab;
    if (tab && ["work", "log", "report", "stats", "backup"].includes(tab)) {
      activeTab = tab;
      render();
    }
    return;
  }
  if (action === "set-stats-tab") {
    const tab = button.dataset.statsTab;
    if (tab && ["week", "month", "date"].includes(tab)) {
      activeStatsTab = tab;
      render();
    }
    return;
  }
  if (action === "stats-week-prev") {
    statsWeekOffset -= 1;
    render();
    return;
  }
  if (action === "stats-week-next") {
    statsWeekOffset = Math.min(0, statsWeekOffset + 1);
    render();
    return;
  }
  if (action === "stats-month-prev") {
    statsMonthOffset -= 1;
    render();
    return;
  }
  if (action === "stats-month-next") {
    statsMonthOffset = Math.min(0, statsMonthOffset + 1);
    render();
    return;
  }
  if (action === "stats-date-today") {
    statsSelectedDate = todayKey();
    render();
    return;
  }
  if (action === "refresh") {
    await loadToday();
    render();
    return;
  }
  if (action === "copy-report") {
    const report = buildDailyReport(currentDay, calculateDay(currentDay), { title: "Delivery Master Install Report" });
    await navigator.clipboard.writeText(report.text);
    toast("\uB9AC\uD3EC\uD2B8\uB97C \uBCF5\uC0AC\uD588\uC2B5\uB2C8\uB2E4.");
    return;
  }
  if (action === "snapshot") {
    const backup = await store.createBackup({ kind: "all" });
    downloadJsonFile(backup, buildBackupFilename("manual"));
    toast("\uBC31\uC5C5 \uD30C\uC77C \uB0B4\uBCF4\uB0B4\uAE30\uB97C \uC2DC\uC791\uD588\uC2B5\uB2C8\uB2E4.");
    return;
  }
  if (action === "import-field-backup") {
    await importFieldBackupFile();
    return;
  }
  if (action === "reset-confirm") {
    if (!confirm("\uC624\uB298 \uAE30\uB85D\uC744 \uCD08\uAE30\uD654\uD560\uAE4C\uC694? \uBA3C\uC800 \uC2A4\uB0C5\uC0F7\uC744 \uB9CC\uB4E0 \uB4A4 \uC9C4\uD589\uD569\uB2C8\uB2E4.")) return;
    await downloadPreparedSnapshot("reset-before", { kind: "date", date: currentDay.date });
    currentDay = createEmptyDay(currentDay.date);
    await store.saveDay(currentDay);
    await refreshHistory();
    render();
    return;
  }
  if (action === "prepare-default-order") {
    ensureDefaultWorkOrder();
    await saveAndRender();
    return;
  }
  if (action === "fix-cleanup") {
    await correctCleanup(zoneId);
    return;
  }
  if (action === "skip-cleanup") {
    removeMissingCleanup(zoneId);
    await saveAndRender();
    return;
  }
  if (action === "save-zone-edit" && zoneId) {
    await saveCompletedZoneEdit(zoneId);
    return;
  }
  if (action === "save-miju-detail") {
    saveMijuCheckpoint();
    await saveAndRender();
    return;
  }
  if (action === "clear-miju-detail") {
    clearMijuCheckpoint();
    await saveAndRender();
    return;
  }
  if (action === "set-work-order") {
    setWorkOrder(button.dataset.order ?? "");
    await saveAndRender();
    return;
  }
  if (action === "move-zone-up" && zoneId) {
    moveZone(zoneId, -1);
    await saveAndRender();
    return;
  }
  if (action === "move-zone-down" && zoneId) {
    moveZone(zoneId, 1);
    await saveAndRender();
    return;
  }
  if (action === "add-alt-zone-to-order") {
    addZoneToOrder("alt");
    await saveAndRender();
    return;
  }
  if (action === "add-custom-zone-to-order") {
    addZoneToOrder("custom", readText("#custom-zone-name", "\uCD94\uAC00 \uAD6C\uC5ED"));
    await saveAndRender();
    return;
  }
  if (action === "skip-zone" && zoneId) {
    skipZone(zoneId);
    await saveAndRender();
    return;
  }
  if (action === "add-event") {
    addIncidentEvent();
    await saveAndRender();
    return;
  }
  if (action === "add-alt-zone") {
    addExtraZone("alt");
    await saveAndRender();
    return;
  }
  if (action === "add-custom-zone") {
    addExtraZone("custom", readText("#custom-zone-name", "\uCD94\uAC00 \uAD6C\uC5ED"));
    await saveAndRender();
    return;
  }
  if (action === "close-day" && mustCorrectCleanupBeforeClose()) {
    toast("\uC815\uB9AC \uC644\uB8CC \uBCF4\uC815\uC774 \uBA3C\uC800 \uD544\uC694\uD569\uB2C8\uB2E4.");
    render();
    return;
  }
  if (action === "zone-end" && zoneId && hasMissingCleanupFinish(currentDay, zoneId)) {
    await addZoneEnd(zoneId);
    render();
    return;
  }
  if (action === "depart") addDepartEvent();
  if (action === "arrive") {
    addEvent("arrive_cheongnyangni");
    if (currentDay && !isUnpaidHelperDay(currentDay)) ensureDefaultWorkOrder();
  }
  if (action === "zone-start" && zoneId) addZoneStart(zoneId);
  if (action === "sorting-start" && zoneId) addZoneEvent("sorting_start", zoneId);
  if (action === "sorting-end" && zoneId) addZoneEvent("sorting_end", zoneId);
  if (action === "delivery-start" && zoneId) addDeliveryStart(zoneId);
  if (action === "zone-end" && zoneId) await addZoneEnd(zoneId);
  if (action === "close-day-now" && isUnpaidHelperDay(currentDay)) {
    const closeAt = nowIso();
    addUnpaidHelperEvent(closeAt);
    addEvent("day_close", void 0, closeAt);
    await saveAndRender();
    await downloadFullBackup(PHONE_INSTALL_BACKUP_FILENAME);
    toast("\uC5C5\uBB34 \uC885\uB8CC \uC800\uC7A5 \uC644\uB8CC. \uC804\uCCB4 \uBC31\uC5C5 \uB0B4\uBCF4\uB0B4\uAE30\uB97C \uC2DC\uC791\uD588\uC2B5\uB2C8\uB2E4.");
    return;
  }
  if (action === "close-day") {
    const closeAt = isUnpaidHelperDay(currentDay) ? readHelperCloseAt() : nowIso();
    if (isUnpaidHelperDay(currentDay)) addUnpaidHelperEvent(closeAt);
    addEvent("day_close", void 0, closeAt);
    await saveAndRender();
    await downloadFullBackup(PHONE_INSTALL_BACKUP_FILENAME);
    toast("\uC5C5\uBB34 \uC885\uB8CC \uC800\uC7A5 \uC644\uB8CC. \uC804\uCCB4 \uBC31\uC5C5 \uB0B4\uBCF4\uB0B4\uAE30\uB97C \uC2DC\uC791\uD588\uC2B5\uB2C8\uB2E4.");
    return;
  }
  await saveAndRender();
}
function addDepartEvent() {
  const expectedInput = readLimitedNumberField("#expected-count", 4);
  if (!expectedInput.hasValue) {
    toast("\uC608\uC0C1 \uC218\uB7C9\uC744 \uC785\uB825\uD574\uC57C \uCD9C\uBC1C\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uBB34\uBCF4\uC218 \uB3C4\uC6B0\uBBF8\uB0A0\uC774\uBA74 0\uC744 \uC9C1\uC811 \uC785\uB825\uD558\uC138\uC694.");
    return;
  }
  const expected = expectedInput.value;
  if (expected === 0 && !confirm("\uC608\uC0C1 \uC218\uB7C9 0\uAC1C\uC785\uB2C8\uB2E4. \uBB34\uBCF4\uC218 \uB3C4\uC6B0\uBBF8\uB0A0\uB85C \uC2DC\uC791\uD560\uAE4C\uC694?")) return;
  if (!confirmLargeNumber(expected, MAX_REASONABLE_EXPECTED, "\uC608\uC0C1 \uC218\uB7C9")) return;
  addEvent("depart_jinjeop", { total: expected, helperDay: expected === 0 });
}
function addEvent(type, payload, at = nowIso()) {
  if (!currentDay) return;
  currentDay = createEvent(currentDay, { type, at, payload });
  currentDay.status = type === "day_close" ? "closed" : "active";
}
function addUnpaidHelperEvent(closeAt) {
  if (!currentDay || hasEvent("helper_add")) return;
  const helperId = `helper-${currentDay.date}`;
  const arrive = currentDay.timeline.find((event) => event.type === "arrive_cheongnyangni");
  currentDay = createEvent(currentDay, {
    type: "helper_add",
    at: closeAt,
    payload: {
      helperId,
      name: "\uBB34\uBCF4\uC218 \uB3C4\uC6B0\uBBF8",
      action: "add",
      unpaid: true,
      minutes: arrive ? diffMinutesFromIso(arrive.at, closeAt) : void 0
    }
  });
  currentDay.helpers = [
    ...currentDay.helpers.filter((helper) => helper.id !== helperId),
    {
      id: helperId,
      name: "\uBB34\uBCF4\uC218 \uB3C4\uC6B0\uBBF8",
      linkedEventIds: [currentDay.timeline.at(-1).id],
      memo: "\uC218\uB7C9 0 \uCD9C\uBC1C\uB85C \uAE30\uB85D\uB41C \uBB34\uBCF4\uC218 \uB3C4\uC6B0\uBBF8\uB0A0"
    }
  ];
}
function addZoneStart(zoneId) {
  if (!currentDay || hasZoneStarted(zoneId)) return;
  const zone = ensureZone(zoneId);
  currentDay = createEvent(currentDay, {
    type: "zone_start",
    at: nowIso(),
    zoneId,
    payload: { zoneName: zone.name, order: zone.order }
  });
  linkLatestEvent(zoneId, "zone_start", "startEventId");
  currentDay.status = "active";
}
function addExtraZone(kind, requestedName) {
  if (!currentDay || getActiveExtraZone()) return;
  const id = createExtraZoneId(kind);
  const defaultName = kind === "alt" ? getNextAltZoneName() : requestedName?.trim() || "\uCD94\uAC00 \uAD6C\uC5ED";
  ensureZone(id, defaultName, getNextZoneOrder());
  addZoneStart(id);
}
function setWorkOrder(orderValue) {
  if (!currentDay || currentDay.zones.length > 0) return;
  const ids = orderValue.split(",").map((value) => value.trim()).filter(Boolean);
  ids.forEach((id, index) => {
    if (id === "alt") {
      ensureZone(createExtraZoneId("alt"), "\uB300\uCCB4\uBC30\uC1A1", index + 1);
      return;
    }
    ensureZone(id, getZoneName2(id), index + 1);
  });
}
function ensureDefaultWorkOrder() {
  if (!currentDay || currentDay.zones.length > 0) return;
  ensureZone("miju", "\uBBF8\uC8FC", 1);
  ensureZone("hils", "\uD790\uC2A4\uD14C\uC774\uD2B8", 2);
  ensureZone(createExtraZoneId("alt"), "\uB300\uCCB4\uBC30\uC1A1", 3);
}
function addZoneToOrder(kind, requestedName) {
  if (!currentDay || hasAnyZoneStarted()) return;
  const id = createExtraZoneId(kind);
  const name = kind === "alt" ? getNextAltZoneName() : requestedName?.trim() || "\uCD94\uAC00 \uAD6C\uC5ED";
  ensureZone(id, name, getNextZoneOrder());
  normalizeZoneOrders();
}
function skipZone(zoneId) {
  if (!currentDay || hasZoneStarted(zoneId)) return;
  currentDay.zones = currentDay.zones.filter((zone) => zone.id !== zoneId);
  normalizeZoneOrders();
}
function moveZone(zoneId, direction) {
  if (!currentDay || hasAnyZoneStarted()) return;
  const ordered = getOrderedZones();
  const index = ordered.findIndex((zone) => zone.id === zoneId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
  const next = [...ordered];
  const [item] = next.splice(index, 1);
  if (!item) return;
  next.splice(targetIndex, 0, item);
  currentDay.zones = next.map((zone, orderIndex) => ({ ...zone, order: orderIndex + 1 }));
}
function normalizeZoneOrders() {
  if (!currentDay) return;
  currentDay.zones = getOrderedZones().map((zone, index) => ({ ...zone, order: index + 1 }));
}
function addIncidentEvent() {
  if (!currentDay) return;
  const title = readText("#event-title", "\uAE30\uD0C0");
  const scope = readText("#event-scope", "work");
  const minutes = readNumber("#event-minutes", 0);
  const at = readOptionalTimeInput("#event-at") ?? nowIso();
  const note = readText("#event-note", "");
  const zoneId = scope.startsWith("zone:") ? scope.slice("zone:".length) : void 0;
  currentDay = createEvent(currentDay, {
    type: "incident",
    at,
    zoneId,
    payload: {
      title,
      minutes,
      scope,
      affectsEfficiency: true
    },
    note: note || void 0
  });
}
function saveMijuCheckpoint() {
  if (!currentDay) return;
  const parts = readMijuDetailParts();
  if (!parts.ok) {
    toast(parts.message ?? "A\uAD6C\uAC04 \uC218\uB7C9\uC744 \uD655\uC778\uD558\uC138\uC694.");
    return;
  }
  currentDay = createEvent(currentDay, {
    type: "manual_adjust",
    at: nowIso(),
    zoneId: "miju",
    payload: {
      reason: "miju_a_checkpoint",
      building1Total: parts.one,
      building2Total: parts.two,
      building3Total: parts.three,
      restTotal: parts.rest,
      aTotal: parts.aTotal,
      total: parts.detailTotal
    }
  });
  toast(`A\uAD6C\uAC04 \uC800\uC7A5: ${parts.aTotal}\uAC1C`);
}
function clearMijuCheckpoint() {
  if (!currentDay) return;
  currentDay = createEvent(currentDay, {
    type: "manual_adjust",
    at: nowIso(),
    zoneId: "miju",
    payload: {
      reason: "miju_a_checkpoint_clear"
    }
  });
  toast("A\uAD6C\uAC04 \uC800\uC7A5\uAC12\uC744 \uCD08\uAE30\uD654\uD588\uC2B5\uB2C8\uB2E4.");
}
function addZoneEvent(type, zoneId) {
  if (!currentDay || hasZoneEvent(zoneId, type)) return;
  ensureZone(zoneId);
  currentDay = createEvent(currentDay, { type, at: resolveZoneEventAt(type, zoneId), zoneId });
  linkLatestEvent(zoneId, type, type === "sorting_start" ? "sortingStartEventId" : "sortingEndEventId");
}
function addDeliveryStart(zoneId) {
  if (!currentDay || hasZoneEvent(zoneId, "delivery_start")) return;
  ensureZone(zoneId);
  currentDay = createEvent(currentDay, { type: "delivery_start", at: nowIso(), zoneId });
  linkLatestEvent(zoneId, "delivery_start", "deliveryStartEventId");
}
async function addZoneEnd(zoneId) {
  if (!currentDay || hasZoneEnded(zoneId)) return;
  const zone = ensureZone(zoneId);
  if (zoneId !== "miju" && !hasZoneEvent(zoneId, "sorting_start") && !hasZoneEvent(zoneId, "delivery_start")) {
    toast("\uC815\uB9AC \uC2DC\uC791 \uB610\uB294 \uBC14\uB85C \uBC30\uC1A1 \uC2DC\uC791\uC744 \uBA3C\uC800 \uC120\uD0DD\uD558\uC138\uC694.");
    return;
  }
  if (zoneId !== "miju" && !hasZoneEvent(zoneId, "sorting_end")) {
    if (hasZoneEvent(zoneId, "sorting_start")) toast("\uC815\uB9AC \uC644\uB8CC\uB97C \uBA3C\uC800 \uAE30\uB85D\uD574\uC57C \uD569\uB2C8\uB2E4.");
    return;
  }
  const mijuParts = zoneId === "miju" ? readMijuPayloadParts() : void 0;
  const deliveredInput = zoneId === "miju" ? void 0 : readZoneDelivered(zoneId);
  if (mijuParts?.ok === false) {
    toast(mijuParts.message ?? "\uBBF8\uC8FC \uC218\uB7C9\uC744 \uD655\uC778\uD558\uC138\uC694.");
    return;
  }
  if (zoneId === "miju" && mijuParts?.hasDetail && !mijuParts.totalHasValue) {
    toast("\uBBF8\uC8FC \uC804\uCCB4 \uC218\uB7C9\uC744 \uC785\uB825\uD574\uC57C \uB098\uBA38\uC9C0\uB97C \uC790\uB3D9 \uACC4\uC0B0\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
    return;
  }
  const rawDelivered = mijuParts?.delivered ?? deliveredInput?.value ?? 0;
  const hasValue = mijuParts ? mijuParts.totalHasValue || mijuParts.hasDetail : Boolean(deliveredInput?.hasValue);
  const delivered = resolveValidatedDelivered(zoneId, rawDelivered, hasValue);
  if (delivered === void 0) return;
  currentDay = createEvent(currentDay, {
    type: "zone_end",
    at: nowIso(),
    zoneId,
    payload: {
      total: delivered,
      delivered,
      failed: 0,
      extra: 0,
      zoneName: zone.name,
      ...mijuParts ? {
        building1Total: mijuParts.one,
        building2Total: mijuParts.two,
        building3Total: mijuParts.three,
        restTotal: mijuParts.rest,
        aTotal: mijuParts.aTotal,
        bTotal: mijuParts.rest,
        detailMode: mijuParts.hasDetail
      } : {}
    }
  });
  linkLatestEvent(zoneId, "zone_end", "endEventId");
}
async function correctCleanup(zoneId) {
  if (!currentDay || !zoneId) return;
  const result = applyMissingCleanupCorrection(currentDay, {
    zoneId,
    closeAt: findLatestZoneCloseAt(currentDay, zoneId) ?? nowIso(),
    minutes: readNumber("#cleanup-input", 30),
    source: "zone_close_prompt"
  });
  currentDay = result.dayRecord;
  await saveAndRender();
}
async function saveCompletedZoneEdit(zoneId) {
  if (!currentDay) return;
  const editParts = zoneId === "miju" ? readMijuEditParts(zoneId) : void 0;
  if (editParts?.ok === false) {
    toast(editParts.message ?? "\uC218\uC815 \uC218\uB7C9\uC744 \uD655\uC778\uD558\uC138\uC694.");
    return;
  }
  const deliveredInput = zoneId === "miju" ? void 0 : readLimitedNumberField(`#edit-${zoneId}-delivered`, 3);
  const rawDelivered = editParts?.delivered ?? deliveredInput?.value ?? 0;
  const hasValue = editParts ? editParts.totalHasValue || editParts.hasDetail : Boolean(deliveredInput?.hasValue);
  const delivered = resolveValidatedDelivered(zoneId, rawDelivered, hasValue);
  if (delivered === void 0) return;
  const start = latestZoneEvent(zoneId, "zone_start");
  const end = latestZoneEvent(zoneId, "zone_end");
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  const sortingEnd = latestZoneEvent(zoneId, "sorting_end");
  const startAt = readOptionalTimeInput(`#edit-${zoneId}-start`, start?.at);
  const endAt = readOptionalTimeInput(`#edit-${zoneId}-end`, end?.at);
  const sortingStartAt = readOptionalTimeInput(`#edit-${zoneId}-sorting-start`, sortingStart?.at);
  const sortingEndAt = readOptionalTimeInput(`#edit-${zoneId}-sorting-end`, sortingEnd?.at);
  const timeError = validateZoneEditTimes(zoneId, { startAt, endAt, sortingStartAt, sortingEndAt });
  if (timeError) {
    toast(timeError);
    return;
  }
  await downloadPreparedSnapshot("zone-edit-before", { kind: "date", date: currentDay.date });
  currentDay = applyCompletedZoneEdit(currentDay, {
    zoneId,
    startAt,
    endAt,
    sortingStartAt,
    sortingEndAt,
    delivered,
    failed: readLimitedNumber(`#edit-${zoneId}-failed`, 3),
    extra: readLimitedNumber(`#edit-${zoneId}-extra`, 3),
    miju1: editParts?.hasDetail ? editParts.one : void 0,
    miju2: editParts?.hasDetail ? editParts.two : void 0,
    miju3: editParts?.hasDetail ? editParts.three : void 0,
    mijuRest: editParts?.hasDetail ? editParts.rest : void 0,
    reason: "completed_zone_edit_from_app"
  });
  toast("\uC644\uB8CC \uAD6C\uC5ED \uC218\uC815\uC774 \uC800\uC7A5\uB410\uC2B5\uB2C8\uB2E4.");
  await saveAndRender();
}
function validateZoneEditTimes(zoneId, input) {
  if (isAfter(input.startAt, input.endAt)) return "\uAD6C\uC5ED \uC2DC\uC791 \uC2DC\uAC01\uC774 \uC885\uB8CC \uC2DC\uAC01\uBCF4\uB2E4 \uB2A6\uC2B5\uB2C8\uB2E4.";
  if (isAfter(input.sortingStartAt, input.sortingEndAt)) return "\uC815\uB9AC \uC2DC\uC791 \uC2DC\uAC01\uC774 \uC815\uB9AC \uC644\uB8CC \uC2DC\uAC01\uBCF4\uB2E4 \uB2A6\uC2B5\uB2C8\uB2E4.";
  if (isAfter(input.startAt, input.sortingStartAt)) return "\uC815\uB9AC \uC2DC\uC791 \uC2DC\uAC01\uC774 \uAD6C\uC5ED \uC2DC\uC791\uBCF4\uB2E4 \uBE60\uB97C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
  if (isAfter(input.sortingEndAt, input.endAt)) return "\uC815\uB9AC \uC644\uB8CC \uC2DC\uAC01\uC774 \uAD6C\uC5ED \uC885\uB8CC\uBCF4\uB2E4 \uB2A6\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
  const arrive = currentDay?.timeline.find((event) => event.type === "arrive_cheongnyangni");
  if (isBefore(input.startAt, arrive?.at)) return "\uAD6C\uC5ED \uC2DC\uC791\uC740 \uCCAD\uB7C9\uB9AC \uB3C4\uCC29\uBCF4\uB2E4 \uBE60\uB97C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
  const previousEndAt = getPreviousZoneEndAt(zoneId);
  if (isBefore(input.startAt, previousEndAt)) return "\uAD6C\uC5ED \uC2DC\uC791\uC740 \uC774\uC804 \uAD6C\uC5ED \uC644\uB8CC\uBCF4\uB2E4 \uBE60\uB97C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
  const nextStartAt = getNextZoneStartAt(zoneId);
  if (isAfter(input.endAt, nextStartAt)) return "\uAD6C\uC5ED \uC885\uB8CC\uB294 \uB2E4\uC74C \uAD6C\uC5ED \uC2DC\uC791\uBCF4\uB2E4 \uB2A6\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
  const dayClose = currentDay?.timeline.find((event) => event.type === "day_close");
  if (isAfter(input.endAt, dayClose?.at)) return "\uAD6C\uC5ED \uC885\uB8CC\uB294 \uC5C5\uBB34 \uC885\uB8CC\uBCF4\uB2E4 \uB2A6\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
  return void 0;
}
function isAfter(left, right) {
  if (!left || !right) return false;
  return new Date(left).getTime() > new Date(right).getTime();
}
function isBefore(left, right) {
  if (!left || !right) return false;
  return new Date(left).getTime() < new Date(right).getTime();
}
function getPreviousZoneEndAt(zoneId) {
  if (!currentDay) return void 0;
  const zone = currentDay.zones.find((candidate) => candidate.id === zoneId);
  if (!zone) return void 0;
  const previousZone = [...currentDay.zones].filter((candidate) => candidate.order < zone.order).sort((a, b) => b.order - a.order)[0];
  return previousZone ? latestZoneEvent(previousZone.id, "zone_end")?.at : void 0;
}
function getNextZoneStartAt(zoneId) {
  if (!currentDay) return void 0;
  const zone = currentDay.zones.find((candidate) => candidate.id === zoneId);
  if (!zone) return void 0;
  const nextZone = [...currentDay.zones].filter((candidate) => candidate.order > zone.order).sort((a, b) => a.order - b.order)[0];
  return nextZone ? latestZoneEvent(nextZone.id, "zone_start")?.at : void 0;
}
function removeMissingCleanup(zoneId) {
  if (!currentDay || !zoneId) return;
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  if (!sortingStart) return;
  currentDay = {
    ...currentDay,
    timeline: currentDay.timeline.filter((event) => event.id !== sortingStart.id),
    zones: currentDay.zones.map(
      (zone) => zone.id === zoneId ? { ...zone, sortingStartEventId: void 0, sortingEndEventId: void 0 } : zone
    )
  };
}
function mustCorrectCleanupBeforeClose() {
  if (!currentDay) return false;
  return currentDay.zones.some((zone) => hasMissingCleanupFinish(currentDay, zone.id));
}
function ensureZone(zoneId, name = getZoneName2(zoneId), order = getDefaultZoneOrder(zoneId)) {
  if (!currentDay) throw new Error("No current day");
  const existing = currentDay.zones.find((zone2) => zone2.id === zoneId);
  if (existing) return existing;
  const zone = { id: zoneId, name, order };
  currentDay.zones.push(zone);
  return zone;
}
function linkLatestEvent(zoneId, type, field) {
  if (!currentDay) return;
  const event = latestZoneEvent(zoneId, type);
  currentDay.zones = currentDay.zones.map((zone) => zone.id === zoneId && event ? { ...zone, [field]: event.id } : zone);
}
function latestZoneEvent(zoneId, type) {
  if (!currentDay) return void 0;
  return [...currentDay.timeline].reverse().find((event) => event.zoneId === zoneId && event.type === type);
}
function hasEvent(type) {
  return currentDay?.timeline.some((event) => event.type === type) ?? false;
}
function hasZoneEvent(zoneId, type) {
  return currentDay?.timeline.some((event) => event.zoneId === zoneId && event.type === type) ?? false;
}
function hasZoneStarted(zoneId) {
  return hasZoneEvent(zoneId, "zone_start");
}
function hasAnyZoneStarted() {
  return currentDay?.zones.some((zone) => hasZoneStarted(zone.id)) ?? false;
}
function hasZoneEnded(zoneId) {
  return hasZoneEvent(zoneId, "zone_end");
}
function isUnpaidHelperDay(dayRecord) {
  const depart = dayRecord.timeline.find((event) => event.type === "depart_jinjeop");
  return Boolean(
    depart && typeof depart.payload === "object" && depart.payload && depart.payload.total === 0
  );
}
function diffMinutesFromIso(start, end) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return void 0;
  return Math.round((endMs - startMs) / 6e4);
}
function findLatestZoneCloseAt(dayRecord, zoneId) {
  return [...dayRecord.timeline].reverse().find((event) => event.zoneId === zoneId && event.type === "zone_end")?.at;
}
function resolveZoneEventAt(type, zoneId) {
  if (type === "sorting_end") {
    const sortingStart = latestZoneEvent(zoneId, "sorting_start");
    const now = nowIso();
    return sortingStart && Date.parse(sortingStart.at) > Date.parse(now) ? sortingStart.at : now;
  }
  if (zoneId === "miju") return nowIso();
  const previousEndAt = getPreviousZoneEndAt(zoneId);
  if (!previousEndAt) return nowIso();
  const previousEnd = new Date(previousEndAt);
  if (Number.isNaN(previousEnd.getTime())) return nowIso();
  const diffMinutes3 = (Date.now() - previousEnd.getTime()) / 6e4;
  return diffMinutes3 < 1 ? addMinutes(previousEndAt, 5) : nowIso();
}
function addMinutes(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 6e4).toISOString();
}
async function saveAndRender() {
  if (!currentDay) return;
  currentDay.meta.updatedAt = nowIso();
  await store.saveDay(currentDay);
  await buildPhoneInstallDashboard(store);
  await refreshHistory();
  render();
}
async function refreshHistory() {
  const summaries = await store.listDates();
  const days = await Promise.all(summaries.map((summary) => store.getDay(summary.date)));
  historyDays = days.filter((day) => Boolean(day));
}
async function importFieldBackupFile() {
  const file = await pickJsonFile();
  if (!file) return;
  try {
    const data = await readJsonFile(file);
    const migration = buildFieldAppMigrationBackup(data, { appVersion: APP_VERSION });
    const recognizedDays = migration.backup.days.length;
    if (recognizedDays === 0) {
      lastImportFeedback = {
        fileName: file.name,
        recognizedDays,
        importedCount: 0,
        skippedCount: 0,
        importedDates: [],
        skippedDates: [],
        message: "\uD604\uC7A5\uC571 \uBC31\uC5C5\uC5D0\uC11C \uAC00\uC838\uC62C \uB0A0\uC9DC\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
        snapshotCreated: false,
        backupExported: false
      };
      render();
      return;
    }
    const dates = migration.backup.days.map((day) => day.date).join(", ");
    const ok = confirm(
      `\uD604\uC7A5\uC571 \uBC31\uC5C5\uC5D0\uC11C ${recognizedDays}\uC77C\uCE58\uB97C \uCC3E\uC558\uC2B5\uB2C8\uB2E4.

${dates}

\uAC00\uC838\uC624\uAE30 \uC804\uC5D0 \uC804\uCCB4 \uBC31\uC5C5 \uD30C\uC77C\uC744 \uB0B4\uBCF4\uB0C5\uB2C8\uB2E4.
\uBE48 \uC624\uB298 \uAE30\uB85D\uC740 \uAC00\uC838\uC628 \uAE30\uB85D\uC73C\uB85C \uC790\uB3D9 \uBCF4\uC815\uD558\uACE0, \uC2E4\uC81C \uAE30\uB85D\uC774 \uC788\uB294 \uB0A0\uC9DC\uB294 \uBCF5\uC0AC\uBCF8\uC73C\uB85C \uBCF4\uD638\uD569\uB2C8\uB2E4.`
    );
    if (!ok) {
      lastImportFeedback = {
        fileName: file.name,
        recognizedDays,
        importedCount: 0,
        skippedCount: 0,
        importedDates: [],
        skippedDates: [],
        message: "\uC0AC\uC6A9\uC790\uAC00 \uAC00\uC838\uC624\uAE30\uB97C \uCDE8\uC18C\uD588\uC2B5\uB2C8\uB2E4.",
        snapshotCreated: false,
        backupExported: false
      };
      render();
      return;
    }
    const beforeBackup = await store.createBackup({ kind: "all" });
    downloadJsonFile(beforeBackup, buildBackupFilename("before-import"));
    const result = await applyFieldImportWithAutoCorrection(migration.backup.days);
    await refreshHistory();
    currentDay = await pickDayToDisplayAfterImport(result.importedDates) ?? currentDay;
    const afterBackup = await store.createBackup({ kind: "all" });
    downloadJsonFile(afterBackup, buildBackupFilename("after-import"));
    lastImportFeedback = {
      fileName: file.name,
      recognizedDays,
      importedCount: result.importedDates.length,
      skippedCount: result.protectedDates.length,
      importedDates: result.importedDates,
      skippedDates: result.protectedDates,
      message: result.importedDates.length > 0 ? "\uD604\uC7A5\uC571 \uBC31\uC5C5\uC744 \uAC1C\uBC1C\uC571 \uAE30\uB85D\uC73C\uB85C \uAC00\uC838\uC654\uC2B5\uB2C8\uB2E4. \uBE48 \uC624\uB298 \uAE30\uB85D\uC740 \uC790\uB3D9\uC73C\uB85C \uBCF4\uC815\uD588\uC2B5\uB2C8\uB2E4." : "\uAC00\uC838\uC628 \uAE30\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uD30C\uC77C \uD615\uC2DD\uC744 \uD655\uC778\uD558\uC138\uC694.",
      snapshotCreated: true,
      backupExported: true,
      activeDate: currentDay?.date
    };
    toast(`\uD604\uC7A5\uC571 \uBC31\uC5C5 \uAC00\uC838\uC624\uAE30 \uC644\uB8CC: ${result.importedDates.length}\uC77C`);
    render();
  } catch (error) {
    lastImportFeedback = {
      fileName: file.name,
      recognizedDays: 0,
      importedCount: 0,
      skippedCount: 0,
      importedDates: [],
      skippedDates: [],
      message: error instanceof Error ? error.message : "\uD604\uC7A5\uC571 \uBC31\uC5C5 \uAC00\uC838\uC624\uAE30 \uC2E4\uD328",
      snapshotCreated: false,
      backupExported: false
    };
    render();
    toast(error instanceof Error ? error.message : "\uD604\uC7A5\uC571 \uBC31\uC5C5 \uAC00\uC838\uC624\uAE30 \uC2E4\uD328");
  }
}
async function applyFieldImportWithAutoCorrection(days) {
  const importedDates = [];
  const protectedDates = [];
  for (const incoming of days) {
    const existing = await store.getDay(incoming.date);
    if (!existing || isAutoReplaceableEmptyDay(existing)) {
      await store.saveDay({
        ...incoming,
        meta: {
          ...incoming.meta,
          updatedAt: nowIso(),
          recoveryStatus: existing ? "needsReview" : incoming.meta.recoveryStatus
        }
      });
      importedDates.push(incoming.date);
      continue;
    }
    const copy = createBackupCopyDay(incoming);
    await store.saveDay(copy);
    importedDates.push(copy.date);
    protectedDates.push(`${incoming.date} -> ${copy.date}`);
  }
  return { importedDates, protectedDates };
}
function isAutoReplaceableEmptyDay(day) {
  return day.status === "draft" && day.timeline.length === 0 && day.zones.length === 0 && day.helpers.length === 0 && day.adjustments.length === 0;
}
async function pickDayToDisplayAfterImport(importedDates) {
  const today = todayKey();
  if (importedDates.includes(today)) return store.getDay(today);
  const firstDate = importedDates[0];
  return firstDate ? store.getDay(firstDate) : store.getDay(today);
}
function downloadJsonFile(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
async function downloadFullBackup(filename) {
  const backup = await store.createBackup({ kind: "all" });
  downloadJsonFile(backup, filename);
}
async function downloadPreparedSnapshot(label, scope = { kind: "all" }) {
  const plan = await preparePhoneInstallUpdate(store, scope);
  downloadJsonFile(plan.snapshot, buildBackupFilename(label));
}
function buildBackupFilename(label) {
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  return PHONE_INSTALL_BACKUP_FILENAME.replace(/\.json$/i, `_${label}_${stamp}.json`);
}
function pickJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    }, { once: true });
    input.click();
  });
}
async function readJsonFile(file) {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(repairKnownFieldJson(text));
  }
}
function repairKnownFieldJson(text) {
  return text.replace(/^(\s*)"([^"\r\n]*?):\s*([{\[])/gm, '$1"$2": $3');
}
function createEmptyDay(date) {
  const now = nowIso();
  return {
    schemaVersion: 1,
    id: `day-${date}`,
    date,
    status: "draft",
    timeline: [],
    zones: [],
    helpers: [],
    adjustments: [],
    meta: {
      createdAt: now,
      updatedAt: now,
      appVersion: APP_VERSION,
      recoveryStatus: "none"
    }
  };
}
function getOrderedZones() {
  if (!currentDay) return [];
  return [...currentDay.zones].sort((a, b) => a.order - b.order);
}
function getExtraZones() {
  if (!currentDay) return [];
  return currentDay.zones.filter((zone) => !BASE_ZONE_IDS.includes(zone.id)).sort((a, b) => a.order - b.order);
}
function isExtraZone(zoneId) {
  return !BASE_ZONE_IDS.includes(zoneId);
}
function getActiveExtraZone() {
  return getExtraZones().find((zone) => hasZoneStarted(zone.id) && !hasZoneEnded(zone.id));
}
function getCurrentWorkZone() {
  if (!currentDay) return void 0;
  return [...currentDay.zones].sort((a, b) => a.order - b.order).find((zone) => !hasZoneEnded(zone.id));
}
function getDefaultEventScope() {
  const current = getCurrentWorkZone();
  if (current && hasZoneStarted(current.id)) return `zone:${current.id}`;
  const previous = getPreviousCompletedZone();
  if (previous && current && !hasZoneStarted(current.id)) return `between:${previous.id}:${current.id}`;
  if (current) return `zone:${current.id}`;
  return "work";
}
function getEventScopeOptions() {
  const options = [{ value: "work", label: "\uC804\uCCB4 \uC5C5\uBB34" }];
  const ordered = getOrderedZones();
  for (let index = 0; index < ordered.length; index += 1) {
    const zone = ordered[index];
    options.push({ value: `zone:${zone.id}`, label: `${zone.name} \uC9C4\uD589 \uC911` });
    const next = ordered[index + 1];
    if (next) {
      options.push({ value: `between:${zone.id}:${next.id}`, label: `${zone.name} \u2192 ${next.name} \uC0AC\uC774` });
    }
  }
  options.push({ value: "custom", label: "\uC0AC\uC6A9\uC790 \uC9C0\uC815" });
  return options;
}
function getPreviousCompletedZone() {
  if (!currentDay) return void 0;
  return [...currentDay.zones].filter((zone) => hasZoneEnded(zone.id)).sort((a, b) => b.order - a.order)[0];
}
function getMijuCheckpoint() {
  if (!currentDay) return void 0;
  return getMijuCheckpointForDay(currentDay);
}
function getMijuCheckpointForDay(dayRecord) {
  const event = [...dayRecord.timeline].reverse().find(
    (candidate) => candidate.type === "manual_adjust" && candidate.zoneId === "miju" && typeof candidate.payload === "object" && candidate.payload && ["miju_a_checkpoint", "miju_a_checkpoint_clear"].includes(
      String(candidate.payload.reason)
    )
  );
  const payload = event?.payload;
  if (!payload) return void 0;
  if (payload.reason === "miju_a_checkpoint_clear") return void 0;
  const one = numberOrZero2(payload.building1Total);
  const two = numberOrZero2(payload.building2Total);
  const three = numberOrZero2(payload.building3Total);
  const rest = numberOrZero2(payload.restTotal);
  if (one + two + three + rest === 0) return void 0;
  return {
    one,
    two,
    three,
    rest,
    aTotal: one + two + three
  };
}
function getZoneName2(zoneId) {
  const existing = currentDay?.zones.find((zone) => zone.id === zoneId)?.name;
  if (existing) return existing;
  if (zoneId === "miju") return "\uBBF8\uC8FC";
  if (zoneId === "hils") return "\uD790\uC2A4\uD14C\uC774\uD2B8";
  if (zoneId.startsWith("alt-")) return "\uB300\uCCB4\uBC30\uC1A1";
  return "\uCD94\uAC00 \uAD6C\uC5ED";
}
function getDefaultZoneOrder(zoneId) {
  if (zoneId === "miju") return 1;
  if (zoneId === "hils") return 2;
  return getNextZoneOrder();
}
function getNextZoneOrder() {
  if (!currentDay || currentDay.zones.length === 0) return 3;
  return Math.max(2, ...currentDay.zones.map((zone) => zone.order)) + 1;
}
function getNextAltZoneName() {
  const count = getExtraZones().filter((zone) => zone.id.startsWith("alt-")).length + 1;
  return count === 1 ? "\uB300\uCCB4\uBC30\uC1A1" : `\uB300\uCCB4\uBC30\uC1A1 ${count}`;
}
function createExtraZoneId(kind) {
  return `${kind}-${Date.now().toString(36)}`;
}
function statusLabel(status) {
  if (status === "draft") return "\uB300\uAE30";
  if (status === "active") return "\uC9C4\uD589";
  if (status === "closed") return "\uC644\uB8CC";
  return "\uD655\uC778 \uD544\uC694";
}
function todayKey() {
  const now = /* @__PURE__ */ new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function readHelperCloseAt() {
  const value = document.querySelector("#helper-close-at")?.value;
  if (!value) return nowIso();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? nowIso() : parsed.toISOString();
}
function readOptionalTimeInput(selector, existingIso) {
  const value = document.querySelector(selector)?.value;
  if (!value) return void 0;
  if (value.includes("T")) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? void 0 : parsed.toISOString();
  }
  return mergeCurrentDateAndTime(value, existingIso);
}
function mergeCurrentDateAndTime(value, existingIso) {
  if (!currentDay) return void 0;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return void 0;
  const existing = existingIso ? new Date(existingIso) : void 0;
  if (existing && !Number.isNaN(existing.getTime()) && formatTimeOnlyValue(existing) === value) {
    return existingIso;
  }
  const [year, month, day] = currentDay.date.split("-").map(Number);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!year || !month || !day || hour > 23 || minute > 59) return void 0;
  const second = existing && !Number.isNaN(existing.getTime()) ? existing.getSeconds() : 0;
  const millisecond = existing && !Number.isNaN(existing.getTime()) ? existing.getMilliseconds() : 0;
  return new Date(year, month - 1, day, hour, minute, second, millisecond).toISOString();
}
function formatIsoForTimeInput(iso) {
  if (!iso) return "";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : formatTimeOnlyValue(parsed);
}
function formatTimeInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}
function formatTimeOnlyValue(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
function readZoneDelivered(zoneId) {
  if (zoneId === "miju") {
    const parts = readMijuPayloadParts();
    return { value: parts.delivered, hasValue: parts.totalHasValue || parts.hasDetail };
  }
  if (zoneId === "hils") return readLimitedNumberField("#hils-count", 3);
  return readLimitedNumberField("#extra-count", 3);
}
function readMijuPayloadParts() {
  const parts = readMijuDetailParts();
  return {
    ...parts,
    totalHasValue: readLimitedNumberField("#miju-total-count", 3).hasValue
  };
}
function readMijuDetailParts() {
  const one = readLimitedNumberField("#miju-1-count", 3);
  const two = readLimitedNumberField("#miju-2-count", 3);
  const three = readLimitedNumberField("#miju-3-count", 3);
  const rest = readLimitedNumberField("#miju-rest-count", 3);
  const checkpoint = getMijuCheckpoint();
  const resolved = {
    one: one.hasValue ? one.value : checkpoint?.one || 0,
    two: two.hasValue ? two.value : checkpoint?.two || 0,
    three: three.hasValue ? three.value : checkpoint?.three || 0,
    rest: rest.hasValue ? rest.value : checkpoint?.rest || 0
  };
  const total = readLimitedNumberField("#miju-total-count", 3);
  return toMijuParts(resolveMijuDetailQuantity({
    total: total.value,
    totalHasValue: total.hasValue,
    one: resolved.one,
    two: resolved.two,
    three: resolved.three,
    rest: resolved.rest,
    restHasValue: rest.hasValue || Boolean(checkpoint?.rest)
  }), total.hasValue);
}
function readMijuEditParts(zoneId) {
  const one = readLimitedNumberField(`#edit-${zoneId}-1`, 3);
  const two = readLimitedNumberField(`#edit-${zoneId}-2`, 3);
  const three = readLimitedNumberField(`#edit-${zoneId}-3`, 3);
  const rest = readLimitedNumberField(`#edit-${zoneId}-rest`, 3);
  const total = readLimitedNumberField(`#edit-${zoneId}-total`, 3);
  return toMijuParts(resolveMijuDetailQuantity({
    total: total.value,
    totalHasValue: total.hasValue,
    one: one.value,
    two: two.value,
    three: three.value,
    rest: rest.value,
    restHasValue: rest.hasValue
  }), total.hasValue);
}
function resolveValidatedDelivered(zoneId, entered, hasValue) {
  if (!currentDay) return void 0;
  const zoneName = getZoneName2(zoneId);
  const result = validateZoneQuantity({
    zoneName,
    entered,
    hasValue,
    expectedTotal: getExpectedTotal2(),
    completedOther: getCompletedDeliveredTotal(zoneId),
    maxReasonable: MAX_REASONABLE_ZONE
  });
  if (!result.ok) {
    toast(result.message ?? `${zoneName} \uC218\uB7C9\uC744 \uD655\uC778\uD558\uC138\uC694.`);
    return void 0;
  }
  if (result.suggestedValue !== void 0) {
    toast(`${zoneName} ${entered}\uAC1C\uC5D0\uC11C \uC774\uC804 \uC644\uB8CC ${getCompletedDeliveredTotal(zoneId)}\uAC1C\uB97C \uBE7C ${result.suggestedValue}\uAC1C\uB85C \uC800\uC7A5\uD569\uB2C8\uB2E4.`);
    return result.suggestedValue;
  }
  if (result.warning) {
    const ok = confirm(`${result.warning}

\uADF8\uB300\uB85C \uC800\uC7A5\uD560\uAE4C\uC694?`);
    return ok ? entered : void 0;
  }
  return result.value;
}
function getExpectedTotal2() {
  const depart = currentDay?.timeline.find((event) => event.type === "depart_jinjeop");
  const payload = depart?.payload;
  return typeof payload?.total === "number" && payload.total > 0 ? payload.total : void 0;
}
function getCompletedDeliveredTotal(excludingZoneId) {
  if (!currentDay) return 0;
  return currentDay.timeline.reduce((sum, event) => {
    if (event.type !== "zone_end" || event.zoneId === excludingZoneId) return sum;
    const payload = event.payload;
    return sum + (typeof payload?.delivered === "number" ? payload.delivered : 0);
  }, 0);
}
function toMijuParts(result, totalHasValue) {
  return {
    ok: result.ok,
    message: result.message,
    one: result.one,
    two: result.two,
    three: result.three,
    rest: result.rest,
    aTotal: result.aTotal,
    detailTotal: result.detailTotal,
    delivered: result.delivered,
    hasDetail: result.hasDetail,
    totalHasValue
  };
}
function readDeliveredPayload(event) {
  const payload = event?.payload;
  return typeof payload?.delivered === "number" ? payload.delivered : 0;
}
function readNumber(selector, fallback = 0) {
  const raw = document.querySelector(selector)?.value ?? "";
  const value = parseInt(raw.replace(/\D/g, ""), 10);
  return Number.isFinite(value) ? value : fallback;
}
function readLimitedNumber(selector, maxDigits, fallback = 0) {
  const input = document.querySelector(selector);
  const cleaned = (input?.value ?? "").replace(/\D/g, "").slice(0, maxDigits);
  if (input && input.value !== cleaned) input.value = cleaned;
  const value = parseInt(cleaned, 10);
  return Number.isFinite(value) ? value : fallback;
}
function readLimitedNumberField(selector, maxDigits) {
  const input = document.querySelector(selector);
  const cleaned = (input?.value ?? "").replace(/\D/g, "").slice(0, maxDigits);
  if (input && input.value !== cleaned) input.value = cleaned;
  const value = parseInt(cleaned, 10);
  return {
    value: Number.isFinite(value) ? value : 0,
    hasValue: cleaned.length > 0
  };
}
function bindNumericLimits() {
  root.querySelectorAll("[data-numeric-limit]").forEach((input) => {
    input.addEventListener("input", () => {
      const maxDigits = parseInt(input.dataset.numericLimit ?? "3", 10);
      input.value = input.value.replace(/\D/g, "").slice(0, maxDigits);
    });
  });
}
function bindStatsDateInput() {
  const input = root.querySelector("#stats-date-input");
  if (!input) return;
  input.addEventListener("change", () => {
    if (!input.value) return;
    statsSelectedDate = input.value;
    render();
  });
}
function numberOrZero2(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function confirmLargeNumber(value, limit, label) {
  if (value <= limit) return true;
  return confirm(`${label} ${value}\uAC1C\uAC00 \uC785\uB825\uB410\uC2B5\uB2C8\uB2E4. \uB108\uBB34 \uD070 \uAC12\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uADF8\uB300\uB85C \uC800\uC7A5\uD560\uAE4C\uC694?`);
}
function readText(selector, fallback) {
  const value = document.querySelector(selector)?.value.trim();
  return value || fallback;
}
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}
function formatMin(value) {
  return formatDuration(value);
}
function formatEff(value) {
  return value === void 0 ? "-" : `${Math.round(value)}\uAC1C/\uC2DC\uAC04`;
}
function formatDuration(value) {
  if (value === void 0) return "-";
  const minutes = Math.round(value);
  if (minutes < 60) return `${minutes}\uBD84`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}\uC2DC\uAC04` : `${hours}\uC2DC\uAC04 ${rest}\uBD84`;
}
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn("Service worker registration failed; app boot continues.", error);
  }
}
//# sourceMappingURL=app.js.map
