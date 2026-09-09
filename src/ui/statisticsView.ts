import type { StatsModel, StatsSummary, TimeKey } from "../analytics/statistics";
import { fieldEscape as esc } from "../app/fieldView";

const number = (n?: number, digits = 0) => n === undefined || !Number.isFinite(n) ? "-" : n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const rate = (s: StatsSummary) => `${number(s.rate, 1)}개/시간`;
const duration = (n?: number) => n === undefined ? "-" : `${Math.floor(Math.round(n) / 60)}시간 ${Math.round(n) % 60}분`;
const clock = (n?: number) => n === undefined ? "-" : `${Math.round(n) >= 1440 ? "다음 날 " : ""}${String(Math.floor(Math.round(n) / 60) % 24).padStart(2, "0")}:${String(Math.round(n) % 60).padStart(2, "0")}`;
function change(now: number | undefined, before: number | undefined, unit: string): string {
  if (now === undefined || before === undefined) return "비교 자료 없음";
  const delta = now - before;
  return `${delta > 0 ? "+" : ""}${number(delta, 1)}${unit}${before > 0 ? ` (${delta > 0 ? "+" : ""}${number(delta * 100 / before, 1)}%)` : " · 이전 기준 0"}`;
}
const row = (label: string, value: string, detail = "") => `<div class="analysis-row"><span>${esc(label)}</span><strong>${esc(value)}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}</div>`;
const groupTable = (groups: {label: string; stats: StatsSummary}[]) => groups.map(({label,stats:s}) => row(label, rate(s), `${s.days}일 · ${number(s.quantity)}개 · 효율 유효 ${s.rateDays}일`)).join("");

export function renderStatistics(model: StatsModel): string {
  const s = model.current, p = model.previous;
  const zoneTotal = s.buckets.reduce((sum, b) => sum + b.quantity, 0);
  const max = Math.max(1, ...model.trend.map(t => t.stats.quantity));
  const timeLabels: Record<TimeKey,string> = {drive:"출근 운전",movement:"구역 이동",sorting:"정리",delivery:"배송",handling:"반품·선집화·상차",other:"기타 이벤트",unknown:"미분류 시간"};
  const names = {miju:"미주",hils:"힐스테이트",alt:"대체배송",custom:"추가 구역"};
  const ranked=[...model.days].sort((a,b)=>b.quantity-a.quantity||a.date.localeCompare(b.date));
  return `<div class="statistics-analysis">
    <section class="ratio-card analysis-ratio" aria-label="구역 수량 비율">
      <div class="analysis-heading"><h3>구역 비율</h3><strong>${s.buckets.map((b,i)=>["미","힐","대"][i]+number(b.percent)).join(":")}</strong></div>
      <p>${esc(model.start)} ~ ${esc(model.end)}<br>마감 ${s.days}일 · 구역 배송 ${number(zoneTotal)}개${s.separate ? ` · 별도 도우미 ${number(s.separate)}개` : ""}</p>
      <div class="analysis-stacked" aria-hidden="true">${s.buckets.map(b=>`<span class="bucket-${b.key}" style="width:${b.percent}%"></span>`).join("")}</div>
      <div class="analysis-ratios">${s.buckets.map(b=>`<div><span><i class="bucket-${b.key}"></i>${b.label}</span><strong>${number(b.percent,1)}<small>%</small></strong><span>${number(b.quantity)}개</span></div>`).join("")}</div>
    </section>
    ${!s.days ? `<p class="analysis-notice">이 기간에는 마감한 업무가 없습니다.</p>` : ""}
    ${model.pending ? `<p class="analysis-notice">진행 중 ${model.pending}일 · 마감 통계에서 제외</p>` : ""}
    <section class="analysis-section"><h3>이전 기간과 비교</h3><p>${esc(model.previousStart)} ~ ${esc(model.previousEnd)} · 이전 ${p.days}일 / 선택 ${s.days}일</p>
      <div class="analysis-metrics">${row("배송 수량",`${number(s.quantity)}개`,change(s.quantity,p.days?p.quantity:undefined,"개"))}${row("하루 평균",`${number(s.dailyAverage,1)}개`,change(s.dailyAverage,p.dailyAverage,"개"))}${row("배송 효율",rate(s),change(s.rate,p.rate,"개/시간"))}${row("효율 표본",`${s.rateDays}/${s.days}일`,s.autoDays?`자동 보정 포함 ${s.autoDays}일`:"자동 보정 없음")}</div>
    </section>
    <section class="analysis-section"><h3>수량 추이</h3><div class="analysis-trend">${model.trend.map(t=>`<div class="analysis-trend-item"><span>${number(t.stats.quantity)}</span><div class="analysis-column"><div style="height:${t.stats.quantity/max*100}%"></div></div><strong>${esc(t.label)}</strong><small>${t.stats.days}일</small></div>`).join("")}</div></section>
    <section class="analysis-section"><h3>업무 시간 구성</h3><p>시간 구성 확인 ${s.timeDays}/${s.days}일 · ${duration(s.elapsed)}</p>
      ${Object.entries(timeLabels).map(([key,label])=>{const n=s.parts[key as TimeKey];return `<div class="analysis-time">${row(label,duration(s.timeDays?n:undefined),s.elapsed?`${number(n*100/s.elapsed,1)}%`:"표본 없음")}<div class="analysis-track"><span style="width:${s.elapsed?n*100/s.elapsed:0}%"></span></div></div>`;}).join("")}
    </section>
    <details class="analysis-detail"><summary>비율 변화 · 최근 6기간</summary>${model.trend.map(t=>row(t.label,t.stats.buckets.map((b,i)=>["미","힐","대"][i]+number(b.percent)+"%").join(" · "),`${t.stats.days}일 · ${number(t.stats.quantity)}개`)).join("")}</details>
    <details class="analysis-detail"><summary>물량별 효율</summary>${groupTable(model.bands)}</details>
    <details class="analysis-detail"><summary>최다·최소 물량</summary>${ranked.length?row("최다",`${number(ranked[0]!.quantity)}개`,ranked[0]!.date)+row("최소",`${number(ranked[ranked.length-1]!.quantity)}개`,ranked[ranked.length-1]!.date):"<p>마감 자료 없음</p>"}</details>
    <details class="analysis-detail"><summary>구역별 실적</summary>${s.visits.map(v=>row(names[v.kind],`${number(v.quantity)}개`,`${v.visits}회 · ${number(v.rate,1)}개/시간 · 효율 유효 ${v.validVisits}회`)).join("")}</details>
    <details class="analysis-detail"><summary>요일별 실적</summary>${groupTable(model.weekdays)}</details>
    <details class="analysis-detail"><summary>도우미 이용일 비교</summary>${groupTable(model.helpers)}${row("무료 도움",`${number(s.free)}개`,"배송 수량 포함 · 효율 수량 제외")}${row("유료 도움",`${number(s.paid)}개`,"배송·효율 수량 포함 · 중복 합산 없음")}${row("수량 미기록",`${s.helperUncounted}건`)}</details>
    <details class="analysis-detail"><summary>미주 1·2·3동 / 나머지</summary>${row("1·2·3동",`${number(model.miju.a)}개`)}${row("나머지 동",`${number(model.miju.b)}개`)}<p>상세 수량 ${model.miju.samples}회 · 미기록 ${model.miju.missing}회</p></details>
    <details class="analysis-detail"><summary>출발·마감 시각</summary>${row("평균 출발",clock(s.startClock))}${row("평균 마감",clock(s.endClock))}<p>시각 확인 ${s.clockDays}일</p></details>
    <details class="analysis-detail"><summary>스캔 차이 · 실패 · 추가</summary>${row("스캔 차이 합계",s.scan===undefined?"-":`${s.scan>0?"+":""}${number(s.scan)}개`,`${s.scanDays}/${s.days}일 예상 수량 확인`)}${row("날짜별 차이 절댓값 합",`${number(s.scanAbsolute)}개`)}${row("실패",`${number(s.failed)}개`)}${row("추가·예외",`${number(s.extra)}개`)}</details>
    <details class="analysis-detail analysis-quality"><summary>기록 확인 ${model.issues.length}건</summary>${model.issues.length?model.issues.map(i=>`<div class="analysis-issue"><span>${esc(i.date)}<br>${esc(i.label)}</span>${/^\d{4}-\d{2}-\d{2}$/.test(i.date)?`<button class="secondary" data-action="stats-open-date" data-date="${i.date}" aria-label="${i.date} 기록 보기">보기</button>`:""}</div>`).join(""):"<p>선택 기간에 확인할 항목이 없습니다.</p>"}</details>
  </div>`;
}
