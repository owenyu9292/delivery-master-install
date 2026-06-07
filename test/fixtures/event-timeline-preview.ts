import { deriveLog, validateTimeline } from "../../src/domain/eventTimeline";
import { sampleDayRecord } from "./sample-day-record";

export const sampleTimelineValidation = validateTimeline(sampleDayRecord);
export const sampleDerivedLog = deriveLog(sampleDayRecord);
