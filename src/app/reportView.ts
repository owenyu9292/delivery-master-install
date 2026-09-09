import { buildDailyReportView } from "../domain/reportBuilder";
import type { DayCalculation, DayRecord } from "../domain/types";
import { fieldEscape as e, fieldIcon } from "./fieldView";

export function renderDailyReport(day: DayRecord, calculation: DayCalculation, copy = false): string {
  const view = buildDailyReportView(day, calculation);
  const rows = (items: { label: string; value: string }[]) => `<dl class="report-facts">${items.map(item =>
    `<div><dt>${e(item.label)}</dt><dd>${e(item.value)}</dd></div>`).join("")}</dl>`;
  return `<article class="report report-document" aria-label="일일 배송 리포트">
    <header class="report-heading"><div><p>${e(view.date)}</p><h2>오늘의 배송</h2></div><span class="report-status">${e(view.status)}</span>
      ${copy ? `<button class="symbol-button secondary" data-action="copy-report" title="리포트 복사" aria-label="리포트 복사">${fieldIcon("copy")}</button>` : ""}</header>
    <section class="report-overview" aria-label="배송 실적">
      <div class="report-total"><span>총 배송 수량</span><strong data-report="total">${e(view.total)}</strong></div>
      <div class="report-key-metrics"><div><span>배송 시간</span><strong data-report="delivery">${e(view.delivery)}</strong></div><div><span>배송 효율</span><strong data-report="efficiency">${e(view.efficiency)}</strong></div></div>
    </section>
    <section class="report-section"><h3>업무 시간</h3><ol class="report-flow">${view.flow.map(item => `<li><span>${e(item.label)}</span><strong>${e(item.value)}</strong></li>`).join("")}</ol>${rows(view.summary)}</section>
    <section class="report-section"><h3>구역별 내역 <span>${view.zones.length}곳</span></h3>
      ${view.zones.map(zone => `<article class="report-zone" data-report-zone="${e(zone.id)}"><header><span class="report-order">${zone.order}</span><div><h4>${e(zone.name)}</h4><p>${e(zone.period)}</p></div><strong class="report-zone-count">${e(zone.count)}</strong></header>${rows(zone.rows)}</article>`).join("") || '<p class="report-empty">아직 시작한 구역이 없어요.</p>'}
    </section>
    ${view.helpers.length ? `<section class="report-section"><h3>도우미 배송</h3><ul class="report-notes">${view.helpers.map(text => `<li>${e(text)}</li>`).join("")}</ul></section>` : ""}
    ${view.incidents.length ? `<section class="report-section"><h3>별도 작업 · 이벤트</h3>${view.incidents.map(item => `<div class="report-event"><div><strong>${e(item.title)}</strong><p>${e(item.detail)}</p></div><span>${e(item.duration)}</span></div>`).join("")}</section>` : ""}
    ${view.warnings.length ? `<section class="report-section report-review"><h3>확인 필요</h3><ul class="report-notes">${view.warnings.map(text => `<li>${e(text)}</li>`).join("")}</ul></section>` : ""}
    ${copy ? `<footer class="report-footer"><button class="secondary full-width" data-action="copy-report">${fieldIcon("copy")}리포트 복사</button></footer>` : ""}
  </article>`;
}
