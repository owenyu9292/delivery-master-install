import type { ZoneRecord } from "./types";

export type ZoneKind = "miju" | "hils" | "alt" | "custom";

type ZoneIdentityInput = Pick<ZoneRecord, "id" | "name" | "kind">;

export function getZoneKind(zone?: ZoneIdentityInput): ZoneKind {
  if (!zone) return "custom";

  if (zone.kind === "miju" || zone.kind === "hils" || zone.kind === "alt" || zone.kind === "custom") {
    return zone.kind;
  }

  const id = zone.id.toLowerCase();
  const name = zone.name.toLowerCase();
  if (id === "miju" || id.includes("miju") || name === "miju" || name.includes("미주")) {
    return "miju";
  }
  if (id === "hils" || id.includes("hils") || name === "hils" || name.includes("힐스")) {
    return "hils";
  }
  if (id.startsWith("alt-") || name.includes("대체배송")) {
    return "alt";
  }
  return "custom";
}
