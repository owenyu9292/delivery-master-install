import { createElement, Truck, List, FileText, ChartColumn, FolderArchive, RefreshCw, Plus, Pencil, ArrowUp, ArrowDown, ChevronRight, X, Check, Route } from "lucide";
import type { ZoneKind } from "../domain/zoneIdentity";

const icons = { work: Truck, log: List, report: FileText, stats: ChartColumn, backup: FolderArchive, refresh: RefreshCw, plus: Plus, edit: Pencil, up: ArrowUp, down: ArrowDown, next: ChevronRight, close: X, check: Check, route: Route };
export function fieldIcon(name: keyof typeof icons): string {
  return createElement(icons[name], { width: 20, height: 20, "aria-hidden": "true", "stroke-width": 1.8 }).outerHTML;
}
export function fieldEscape(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}
export interface RouteSheetState {
  mode: "plans" | "edit" | "close";
  zoneId?: string;
  kind: ZoneKind;
  name: string;
}
export interface PlannedVisit { id: string; name: string; order: number }
export function renderRouteSheet(state: RouteSheetState, plans: PlannedVisit[], canRemove: boolean, active: boolean, total: number): string {
  const e = fieldEscape;
  const heading = state.mode === "plans" ? "다음 구역" : state.mode === "close" ? "오늘 업무 마감" : state.zoneId ? "구역 변경" : "구역 추가";
  const content = state.mode === "plans"
    ? `<div class="route-plan-list">${plans.map((z, i) => `<div class="order-row"><button class="plan-name" data-action="select-next-zone" data-zone="${e(z.id)}">${z.order}. ${e(z.name)}</button><button class="symbol-button" data-action="move-zone-up" data-zone="${e(z.id)}" ${i === 0 ? "disabled" : ""} title="위로" aria-label="${e(z.name)} 위로">${fieldIcon("up")}</button><button class="symbol-button" data-action="move-zone-down" data-zone="${e(z.id)}" ${i === plans.length - 1 ? "disabled" : ""} title="아래로" aria-label="${e(z.name)} 아래로">${fieldIcon("down")}</button><button class="symbol-button" data-action="open-route-editor" data-zone="${e(z.id)}" title="구역 변경" aria-label="${e(z.name)} 변경">${fieldIcon("edit")}</button></div>`).join("") || '<p class="hint">예정 구역 없음</p>'}</div><button class="secondary full-width" data-action="open-route-editor">${fieldIcon("plus")}구역 추가</button>`
    : state.mode === "close"
      ? `<p class="close-total">오늘 완료 <strong>${total}개</strong></p>${active ? '<p role="alert">진행 중인 구역을 먼저 완료해 주세요.</p>' : `<p class="hint">${plans.length ? "시작하지 않은 " + plans.length + "구역은 예정으로 남습니다." : "오늘 기록을 보존합니다."}</p><button class="primary full-width" data-action="confirm-close-day">업무 마감</button>`}`
      : `<div class="route-mode" role="group" aria-label="배송 구분"><label><input type="radio" name="route-mode" value="own" ${state.kind !== "alt" ? "checked" : ""}>내 구역</label><label><input type="radio" name="route-mode" value="alt" ${state.kind === "alt" ? "checked" : ""}>대체배송</label></div>
         ${state.kind !== "alt" ? `<label class="route-field">구역<select id="route-place"><option value="miju" ${state.kind === "miju" ? "selected" : ""}>미주</option><option value="hils" ${state.kind === "hils" ? "selected" : ""}>힐스테이트</option><option value="custom" ${state.kind === "custom" ? "selected" : ""}>직접 입력</option></select></label>` : ""}
         ${state.kind === "custom" || state.kind === "alt" ? `<label class="route-field">구역 이름<input id="route-name" maxlength="24" value="${e(state.name)}" placeholder="${state.kind === "alt" ? "대체배송" : "구역 이름"}"></label>` : ""}
         <button class="primary full-width" data-action="save-route-editor">${state.zoneId ? "변경 적용" : "예정에 추가"}</button>
         ${canRemove ? '<button class="text-button full-width" data-action="remove-planned-zone">예정에서 빼기</button>' : ""}`;
  return `<dialog class="route-sheet" aria-labelledby="route-sheet-title"><header><h2 id="route-sheet-title">${heading}</h2><button class="symbol-button" data-action="close-route-sheet" title="닫기" aria-label="닫기">${fieldIcon("close")}</button></header>${content}</dialog>`;
}
