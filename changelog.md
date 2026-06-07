# 2026-06-07

- 2026-06-08 v19 `phone-backup-restore`
  - 백업설정에 `개발앱 백업 복구` 버튼을 추가했다.
  - 정상화된 개발앱 백업 JSON을 기존 날짜에 덮어쓸 수 있게 했다.
  - 기존 날짜가 있으면 `확인=덮어쓰기`, `취소=복사본`으로 선택한다.
  - 복구 전후 전체 백업 파일을 자동 내보내기한다.
  - `현장앱 백업 가져오기`는 기존 날짜 보호용으로 유지한다.

- 2026-06-08 v18 `cumulative-correction-helper`
  - 구역 수량 계산을 배송지 이름 기준이 아니라 작업 순서 기준으로 보강했다.
  - 2구역 이후 입력값이 앞 구역 합계보다 크면 누적 총합으로 보고 앞 구역 합계를 차감해 저장한다.
  - 기록 정정 화면에 `이 구역 실제 수량 / 누적 총합에서 이전 구역 자동 차감` 선택을 추가했다.
  - 기록 정정 화면에 `누락 도우미 배송 추가`를 추가해 사라졌거나 빠진 도우미 배송을 다시 입력할 수 있게 했다.
  - 브라우저 검수에 누적 입력 `13 -> 32 -> 53` 저장 결과 `13/19/21` 케이스와 누락 도우미 추가 케이스를 추가했다.
  - 검수: `npm run check`, `npm run build`, 411x762 / DPR 2.63 브라우저 스모크 통과.

- 핫픽스 채널 운영 목적을 정규화했다.
- 핫픽스 채널은 핸드폰 현장 접속 안정성을 위한 초경량 장애 대응 채널이며, 긴 기획/회고/구조 정리는 일반 작업창에서 처리한다.
- 핫픽스 채널에서 현장 긴급 수정 요청이 들어오면 임시 차단/복구용 최소 수정, 검사, 빌드, 배포까지 전량 승인으로 간주한다고 명시했다.
- 핫픽스에서 막은 내용은 문서화하고, 정식 수정은 일반 작업창에서 진행한다고 명시했다.
- `instruction.md`에 핫픽스 채널 최상위 규칙을 추가했다.
- `HOTFIX_HANDOFF.md`에 핫픽스 채널 운영 목적과 최소 진행 흐름을 추가했다.
- `delivery-master-install-deploy`를 개발앱 PWA의 단일 source-of-truth 및 GitHub Pages 배포 repo로 고정했다.
- 이전 작업 폴더 `C:\#WORKSPACE\AI_HUB\AI_WORKSPACE\PROJECTS\delivery-master-install`에서 원본 `src`, 빌드/테스트 스크립트, 설정, 작업 문서를 이관했다.
- `README.md`, `instruction.md`, `HOTFIX_HANDOFF.md`, `progress.md`, `todo.md`를 새 루트 기준으로 갱신했다.
- `current-source/`는 원본이 아닌 격리 참고 스냅샷으로 분류했다.
- 구역 수량 계산을 작업 순서 기준으로 고정하고, 미주 특수 로직은 1/2/3동/나머지 상세 분해로만 제한했다.
- 도우미 배송 무료/유료를 추가했다. 무료는 총수량 포함/효율 제외, 유료는 총수량 포함/효율 포함으로 계산한다.
- 백업설정의 기록 정정에서 완료 구역을 도우미 배송 무료/유료로 전환할 수 있게 했다.
- 로그 화면은 보기 전용으로 유지하고, 도우미 전환 결과만 깔끔한 문구로 표시한다.

# 배송마스터 개발앱 변경 기록

실제로 완료된 변경만 기록한다.
작업이 완료되려면 수정 파일, 테스트, 브라우저 검수 여부, 남은 위험이 이 문서에 남아야 한다.

## 2026-06-03

### 공용 작업 트리 / 훅 적용 기준 정리

상태: 문서 반영 완료, hook 설치 보류

수정 파일:

- `instruction.md`
- `README.md`
- `todo.md`
- `progress.md`
- `changelog.md`

반영 내용:

- 기존 PWA 현장앱 v1, PWA season2, 개발앱 PWA 원본, GitHub Pages 배포 repo의 역할을 분리했다.
- 현장앱 v1/season2는 보관/백업용 과거 세대 원본으로 보호하며, 명시 요청 없이는 수정하지 않는다고 정리했다.
- 현재 실사용 및 개발 source-of-truth는 `delivery-master-install` 개발앱 PWA라고 명시했다.
- `delivery-master-install-deploy`는 배포 산출물 repo이며 source-of-truth가 아니라고 명시했다.
- 공용 규칙은 자동 설치가 아니라 배송마스터 구조에 맞춘 선별 적용으로 정리했다.
- Hermes/OpenClaw 서버 동기화, systemd, MCP, Zulip/Hermes 보고서 완료 조건은 배송마스터 개발앱에는 기본 적용하지 않기로 정리했다.
- 개발앱 원본용 프로젝트 맞춤 `.githooks/pre-commit`과 `scripts/codex-precommit-check.mjs`를 추가했다.
- `npm run check:codex` dry-run 스크립트를 추가했다.
- hook은 source-of-truth 폴더명, 금지 경로, `changelog.md` 동반 여부, 민감정보 패턴, `git diff --check`를 검사한다.
- 무거운 앱 테스트와 브라우저 검수는 hook에 넣지 않고 기존 검수 단계로 유지한다.

테스트:

- 앱 코드는 수정하지 않았다.
- 문서 구조와 적용 기준만 업데이트했다.
- `node --check scripts/codex-precommit-check.mjs` 통과
- `npm run check:codex` 통과

완료 판정:

- 폴더/세대 기준 정리와 개발앱 전용 hook 초안 작성은 완료됐다.
- 실제 hook 연결은 `core.hooksPath .githooks` 확인 후 완료한다.

## 2026-06-02

### 같은 분 로그 구역 전환 순서 보정

상태: 완료

수정 파일:

- `src/app/main.ts`
- `scripts/browser-smoke.mjs`
- `instruction.md`
- `todo.md`
- `unresolved.md`
- `progress.md`
- `changelog.md`

반영 내용:

- 로그 화면에서 같은 분에 이전 구역 완료와 다음 구역 시작이 겹치면 이전 구역 완료가 먼저 보이도록 표시 정렬을 보정했다.
- 원본 `DayRecord.timeline` 정렬이나 저장 시간은 바꾸지 않고, 로그 표시용 정렬만 조정했다.
- 브라우저 스모크 검수에 `previousZoneEndBeforeNextZoneStart` 항목을 추가했다.
- 최상위 검수 규칙에 같은 분 로그 업무 흐름 검수를 추가했다.

테스트:

- `npm run check` 통과, domain tests `46/46`
- `npm run build` 통과
- `node --check scripts/browser-smoke.mjs` 통과
- 폴드 앞 화면 기준 `411x762 / DPR 2.63` 브라우저 스모크 검수 통과
- `previousZoneEndBeforeNextZoneStart: true`

완료 판정:

- 같은 분 구역 전환 로그 순서 보정은 완료됐다.

## 2026-05-27

### 운영 문서 체계 생성

상태: 완료

수정 파일:

- `instruction.md`
- `todo.md`
- `progress.md`
- `unresolved.md`
- `changelog.md`
- `README.md`

반영 내용:

- 최상위 작업 규칙 문서 `instruction.md`를 만들었다.
- 작업 항목 장부 `todo.md`를 만들었다.
- 현재 작업 범위 장부 `progress.md`를 만들었다.
- 미해결 문제 장부 `unresolved.md`를 만들었다.
- 실제 완료 변경 기록 `changelog.md`를 만들었다.
- 2026-05-27 현장 테스트에서 나온 문제를 해결 완료가 아니라 미해결 상태로 등록했다.

테스트:

- 앱 코드는 수정하지 않았다.
- 문서 파일 존재 여부와 핵심 항목 검색으로 확인했다.

완료 판정:

- 다음 코드 작업을 위한 운영 문서 체계는 준비됐다.
- 실제 앱 버그는 아직 해결되지 않았다.

### 운영 문서 한국어화 및 인코딩 규칙 추가

상태: 완료

수정 파일:

- `instruction.md`
- `todo.md`
- `progress.md`
- `unresolved.md`
- `changelog.md`

반영 내용:

- 오빠가 읽어야 하는 운영 문서 내용을 한국어 중심으로 바꿨다.
- 파일명과 코드 식별자는 영어 체계를 유지하기로 했다.
- 새 문서는 UTF-8 기준으로 작성한다는 규칙을 추가했다.
- 깨진 기존 문서는 임의로 추정 복구하지 않고 미해결 문제로 등록했다.

테스트:

- 앱 코드는 수정하지 않았다.
- 문서 핵심 항목과 미해결 항목 검색으로 확인한다.

완료 판정:

- 오빠는 `instruction.md`만 읽으면 작업 규칙을 파악할 수 있다.
- 기존 손상 문서 복구는 별도 작업으로 남아 있다.

### 실제 앱 검수 규칙 분리

상태: 완료

수정 파일:

- `.gitignore`
- `instruction.md`
- `progress.md`
- `changelog.md`

반영 내용:

- `instruction.md` 7번에서 현재 버그 목록을 제거했다.
- 7번을 실제 앱 실행 또는 브라우저 접속 검수 규칙으로 정리했다.
- 구체적인 미주/힐스 문제는 `unresolved.md`와 `todo.md`에서 관리하도록 역할을 분리했다.

테스트:

- 앱 코드는 수정하지 않았다.
- 문서 내용만 UTF-8 기준으로 확인한다.

완료 판정:

- `instruction.md`는 절대 규칙과 검수 원칙만 담는다.
- 현재 문제 목록은 장부 문서에서 추적한다.

### 지시 파악 보고 규칙 및 구역 순서 변경 요구사항 등록

상태: 완료

수정 파일:

- `instruction.md`
- `todo.md`
- `progress.md`
- `unresolved.md`
- `changelog.md`

반영 내용:

- 새 지시나 수정사항을 받으면 바로 구현하지 않고, 먼저 파악한 내용을 보고한다는 규칙을 추가했다.
- 보고에는 문제, 기대 동작, 영향 범위, 문서 반영 위치를 포함하기로 했다.
- 개발앱의 구역 순서 변경 기능 부족을 미해결 문제로 등록했다.
- 이전 현장앱처럼 미주, 힐스테이트, 대체배송지, 추가구역을 화살표로 위아래 조정하는 요구사항을 TODO로 추가했다.

테스트:

- 앱 코드는 수정하지 않았다.
- 문서 내용만 UTF-8 기준으로 확인한다.

완료 판정:

- 새 요구사항은 구현 전 장부에 등록됐다.
- 실제 구역 순서 변경 기능 구현은 다음 코드 작업으로 남아 있다.

### 입력 안정성 문제를 전 구역 공통 문제로 승격

상태: 완료

수정 파일:

- `instruction.md`
- `todo.md`
- `progress.md`
- `unresolved.md`
- `changelog.md`

반영 내용:

- 특정 구역 증상을 앱 전체 공통 구조 문제인지 먼저 판단한다는 규칙을 추가했다.
- 미주 A구간 누락, 미주 총합 자동계산, 힐스 전체 수량 오입력 문제를 개별 버그가 아니라 전 구역 공통 입력 안정성 문제로 재정리했다.
- 공통 입력 검증, 총합/부분값 자동계산, 이상 수량 경고/차단을 다음 코드 작업의 핵심 축으로 정리했다.
- 다음 코드 작업 계획 초안을 `progress.md`에 남겼다.

테스트:

- 앱 코드는 수정하지 않았다.
- 문서 내용만 UTF-8 기준으로 확인한다.

완료 판정:

- 오늘 수정 방향은 개별 구역 패치가 아니라 전 구역 공통 입력 안정성 보강으로 잡혔다.
- 실제 앱 수정과 브라우저 검수는 다음 작업으로 남아 있다.

## 2026-05-28

### 개발앱 전 구역 입력 안정성 및 순서 조정 반영

상태: 완료, 배포 완료

수정 파일:

- `src/app/main.ts`
- `src/domain/zoneValidation.ts`
- `public/styles.css`
- `dist/index.html`
- `dist/styles.css`
- `dist/sw.js`
- `dist/manifest.webmanifest`
- `dist/assets/app.js`
- `dist/assets/app.js.map`
- `public/sw.js`
- `scripts/run-domain-tests.ts`
- `scripts/browser-smoke.mjs`
- `review-mobile.png`
- `todo.md`
- `progress.md`
- `unresolved.md`
- `changelog.md`

반영 내용:

- 전 구역 공통 수량 검증 함수를 추가했다.
- 수량 미입력과 0개 입력으로 구역 완료가 저장되지 않게 했다.
- 입력값이 당일 전체 수량처럼 보이면 이미 완료한 구역 수량을 빼 현재 구역 수량으로 보정할 수 있게 했다.
- 미주 총합과 1/2/3동 상세를 함께 입력하면 나머지 수량을 자동 계산한다.
- 완료 기록 수정의 실패/추가 입력칸을 별도 줄로 분리했다.
- 작업 시작 전 구역 순서를 화살표로 조정하고 대체배송/추가구역을 붙일 수 있게 했다.
- 브라우저 검수용 `scripts/browser-smoke.mjs`를 추가했다.
- 서비스워커 캐시를 `delivery-master-install-v8`로 올렸다.

테스트:

- `npm.cmd run check`: 통과.
- 도메인 테스트: 46/46 통과.
- `npm.cmd run build`: 통과.
- 실제 브라우저 모바일 크기 검수: 통과.

브라우저 검수 결과:

- 작업 순서 편집 화면 표시: 통과.
- 미주/힐스테이트 화살표 이동: 통과.
- 대체배송 추가: 통과.
- 미주 총합 321개와 A구간 153개 입력 시 나머지 168개 자동계산: 통과.
- 힐스테이트에 당일 전체 수량 560개 입력 시 이미 완료한 321개를 빼 239개로 보정: 통과.
- 힐스테이트 빈 수량 완료 차단: 통과.

완료 판정:

- 개발앱 로컬 수정과 검수는 완료됐다.
- GitHub Pages 배포를 완료했다.
- 배포 커밋: `8c38bd5 Deploy field guardrails update`
- 배포 확인: `https://owenyu9292.github.io/delivery-master-install/sw.js`에서 `delivery-master-install-v8` 확인.
- 다음 단계는 현장 테스트 후 실제 사용 문제를 다시 확인하는 것이다.

### 개발앱 운영 기준점 규칙 추가

상태: 문서 반영 완료, git 작업 대기

수정 파일:

- `instruction.md`
- `progress.md`
- `changelog.md`

반영 내용:

- 개발앱 원본을 고정된 과거 버전이 아니라 현장에서 사용 가능한 최신 안정 상태로 정의했다.
- 코기가 git, 테스트, 백업, 배포 분리 같은 기본 개발 안전장치가 빠져 있으면 먼저 제안한다는 규칙을 추가했다.
- 개발앱 수정 전 git 기준점을 남기고 새 브랜치에서 작업한다는 운영 원칙을 추가했다.
- 오늘 현장에서 에러 없이 사용한 `v8 / 0.2.7-field-guardrails`를 첫 이동 기준점으로 삼는 방향을 기록했다.
- git 기준점 생성 전 준비로 `node_modules`, 브라우저 검수 임시 폴더, 빌드 산출물 등을 제외하는 `.gitignore`를 추가했다.

테스트:

- 앱 코드는 수정하지 않았다.
- 문서만 갱신했다.

남은 작업:

- 개발앱 폴더 git 상태 확인.
- `.gitignore` 정리.
- 첫 기준점 커밋 생성.
- 다음 작업용 브랜치 생성 규칙 확정.

### 개발앱 첫 git 기준점 생성

상태: 완료

수정 파일:

- `progress.md`
- `changelog.md`

git 작업:

- 개발앱 폴더에 git 저장소를 초기화했다.
- 기준 브랜치를 `main`으로 정리했다.
- 첫 기준점 커밋을 만들었다: `f98410d Baseline field-tested v8 guardrails`
- 다음 작업 브랜치를 만들었다: `codex/field-ux-redesign`

의미:

- 오늘 현장에서 에러 없이 사용한 `v8 / 0.2.7-field-guardrails`가 첫 이동 기준점이 됐다.
- 이후 작업은 기준점에서 바로 고치는 방식이 아니라 브랜치에서 진행한다.
- 문제가 생기면 `f98410d` 기준점으로 되돌릴 수 있다.

다음 방향:

- 오빠 개인 현장앱 기준으로 입력 UX를 재설계한다.
- 조회, 리포트, 주간/월간 통계의 기본 앱 골격을 만든다.
- 실제 구현 전 예상 수정 파일과 브라우저 검수 항목을 다시 보고한다.

### 현장 입력 UX 1차 개편

상태: 브랜치 구현 및 검수 완료, 배포 대기

수정 파일:

- `src/app/main.ts`
- `src/domain/reportBuilder.ts`
- `scripts/browser-smoke.mjs`
- `review-mobile.png`
- `todo.md`
- `progress.md`
- `changelog.md`

반영 내용:

- 작업 시작 후 구역 순서를 미주/힐스테이트/대체배송/추가구역 기본 목록과 화살표 조정 방식으로 열게 했다.
- 미주는 1동/2동/3동 입력을 먼저 보여주고 `1/2/3동 기록` 후 전체 수량으로 나머지를 자동 계산하게 했다.
- 완료 기록 수정에서도 미주 나머지 수량을 사용자가 직접 계산하지 않게 했다.
- 힐스테이트/대체배송/추가구역은 `정리 시작`, `정리 완료`, `바로 배송 시작` 중심으로 흐름을 줄였다.
- 업무 종료 후 저장 완료 피드백을 보여주게 했다.
- 리포트 시간 표시는 분 단독 대신 `n시간 n분` 형식으로 정리했다.
- 브라우저 검수에 무입력 완료와 말도 안 되게 큰 수량 입력 시나리오를 추가했다.

테스트:

- `npm.cmd run check`: 통과.
- 도메인 테스트: 46/46 통과.
- `npm.cmd run build`: 통과.
- 실제 브라우저 모바일 크기 검수: 통과.

브라우저 검수 결과:

- 작업 순서 화살표 이동: 통과.
- 미주 1/2/3동 선기록: 통과.
- 미주 전체 수량 누락 완료 차단: 통과.
- 미주 나머지 자동계산: 통과.
- 힐스테이트 정리 시작/정리 완료/배송 시작 흐름: 통과.
- 힐스테이트 무입력 완료 차단: 통과.
- 말도 안 되게 큰 수량 입력 후 저장 방지: 통과.

완료 판정:

- 브랜치 작업과 검수는 완료됐다.
- 오빠 승인 후 GitHub Pages 배포 저장소에 반영했다.
- 앱 버전은 `0.2.8-field-ux`, 서비스워커 캐시는 `delivery-master-install-v9`로 올렸다.
- 배포 커밋은 `ccfe9e8 Deploy field UX update`이다.
- GitHub 원격 저장소 main의 `sw.js`는 `v9` 확인 완료.
- GitHub Pages URL은 배포 직후 반영 지연으로 잠시 `v8`을 줄 수 있으므로 추가 확인한다.

### 2026-05-29 필드 피드백 작업 준비 문서화

상태: 준비 완료, 구현 대기

수정 파일:

- `todo.md`
- `progress.md`
- `unresolved.md`
- `changelog.md`

반영 내용:

- v9 필드 테스트에서 입력 UX는 대체로 맞았고, 확인창/로그/리포트/통계/백업설정이 다음 핵심 작업임을 문서화했다.
- 뒤 구역 전체 수량 자동차감 중 확인창이 뜨면 실패로 보는 기준을 추가했다.
- 현장앱 로그 타임라인을 개발앱의 주요 확인 화면 기준으로 삼았다.
- 리포트는 현장앱 포맷을 계승하고 운전시간과 원본 시간축을 포함해야 한다고 정리했다.
- 화면 탭 방향을 `업무 / 로그 / 리포트 / 통계 / 백업설정`으로 정리했다.
- 백업설정은 백업 내보내기, 현장앱 백업 가져오기, 오늘 초기화, 버전 확인을 모으는 탭으로 정의했다.

테스트:

- 문서 작업만 진행했다.
- 구현 전 작업 범위와 검수 계획을 정리했다.

완료 판정:

- 다음 구현 작업의 범위와 검수 기준이 준비됐다.
- 구현은 오빠 승인 후 진행한다.

### 2026-05-29 로그/리포트/통계/백업설정 1차 구현

상태: 구현 및 검수 완료, 배포 대기

수정 파일:

- `src/app/main.ts`
- `src/domain/reportBuilder.ts`
- `public/styles.css`
- `scripts/browser-smoke.mjs`
- `review-mobile.png`
- `todo.md`
- `progress.md`
- `unresolved.md`
- `changelog.md`

반영 내용:

- 화면을 `업무 / 로그 / 리포트 / 통계 / 백업설정` 탭 구조로 정리했다.
- 뒤 구역 전체 수량 입력은 확인창 없이 이전 완료 수량을 자동 차감해 저장하게 했다.
- 로그 탭은 현장앱 기준의 시간순 타임라인으로 구현했다.
- 리포트는 현장앱 포맷 기준으로 재구성하고 출발/도착/순수 운전/최종 종료/구역별 상세를 포함했다.
- 주간/월간 비율 배지는 원시 비율 문자열 대신 퍼센트 중심의 읽기 쉬운 표현으로 바꿨다.
- 백업설정 탭에 백업 내보내기, 현장앱 백업 가져오기, 오늘 초기화, 버전 확인을 모았다.

테스트:

- `npm.cmd run check`: 통과.
- 도메인 테스트: 46/46 통과.
- `npm.cmd run build`: 통과.
- `scripts/browser-smoke.mjs`: 통과.
- 실제 브라우저 탭 검수: 로그/리포트/통계/백업설정 표시 통과.

완료 판정:

- 구현과 검수는 완료됐다.
- GitHub Pages 배포는 아직 하지 않았다.
- 배포 전 앱 버전과 서비스워커 캐시 버전을 올려야 한다.

### 앱 상단 수정본 표시 추가

상태: 구현 및 검수 완료, 배포 대기

수정 파일:

- `src/app/main.ts`
- `todo.md`
- `progress.md`
- `changelog.md`

반영 내용:

- 앱 상단에 `phoneInstall alpha · v0.2.9-field-log-report · 2026-05-29 수정본`을 표시한다.
- 백업설정 탭의 앱 버전에도 같은 값을 표시한다.
- 현장에서 최신 수정본 여부를 바로 확인하기 위한 임시 운영 표시다.

테스트:

- `npm.cmd run check`: 통과.
- 도메인 테스트: 46/46 통과.
- `npm.cmd run build`: 통과.

완료 판정:

- 표시 구현은 완료됐다.
- GitHub Pages 배포는 아직 하지 않았다.
### 2026-05-29 앱 버전/캐시 버전 단일 기준 연동

상태: 구현 및 검증 완료, 배포 대기

수정 파일:

- `src/app/version.ts`
- `src/app/main.ts`
- `scripts/build-app.mjs`
- `public/sw.js`
- `todo.md`
- `progress.md`
- `changelog.md`

반영 내용:

- 앱 상단 표시는 `phoneInstall alpha · v10`처럼 짧은 캐시 버전만 보이도록 변경했다.
- 백업설정의 앱 버전에는 `0.2.9-field-log-report · 2026-05-29 수정본 · cache v10` 상세 정보를 남겼다.
- `src/app/version.ts`를 단일 버전 기준 파일로 추가했다.
- 빌드 스크립트가 `src/app/version.ts`의 `CACHE_NAME`을 읽어 `dist/sw.js` 캐시명에 자동 반영하도록 변경했다.
- `public/sw.js`는 직접 버전 숫자를 박지 않고 빌드 치환용 placeholder를 사용한다.

테스트:

- `node --check scripts/build-app.mjs`: 통과.
- `npm.cmd run check`: 통과, 도메인 테스트 46/46.
- `npm.cmd run build`: 통과.
- `dist/sw.js`에 `delivery-master-install-v10` 반영 확인.
- `dist/assets/app.js`에 상단 `v10`, 백업설정 상세 버전 기준 반영 확인.

완료 판정:

- 버전 표시와 서비스워커 캐시 버전의 기준 분리는 정리됐다.
- 다음 배포부터는 `src/app/version.ts`의 `CACHE_VERSION`을 올리면 앱 상단 표시와 빌드된 서비스워커 캐시명이 같이 바뀐다.

## 2026-05-30

### 필드 안정성 로컬 수정

상태: 구현 및 검수 완료, 배포 대기

수정 파일:

- `src/app/main.ts`
- `src/domain/zoneValidation.ts`
- `src/domain/fieldAppMigration.ts`
- `src/storage/indexedDbAdapter.ts`
- `src/ui/uiScreens.ts`
- `scripts/browser-smoke.mjs`
- `review-mobile.png`
- `progress.md`
- `todo.md`
- `unresolved.md`
- `changelog.md`

반영 내용:

- 출발 예상 수량 빈칸을 0으로 처리하지 않고 차단한다.
- 예상 수량 `0`은 무보수 도우미날 확인을 거쳐야 저장된다.
- 청량리 도착 후 기본 구역 순서를 자동 생성한다.
- 현재 구역 시작 버튼을 작업 순서 편집 UI보다 위에 배치했다.
- 오늘 초기화와 완료 기록 수정 전에 실제 백업 JSON 다운로드를 시작한다.
- 업무 종료 시 전체 개발앱 백업 JSON 다운로드를 자동으로 시작한다.
- 완료 기록 수정에서 시간 역전을 차단한다.
- 정리 시작/정리 완료 중복 이벤트를 방어한다.
- 뒤 구역 전체 수량 자동차감 조건을 당일 총량 근처 입력으로 제한한다.
- 현장앱 import 미주 A/B 상세값을 리포트와 통계에 이어지게 보정했다.
- 백업 appVersion과 서비스워커 실패 방어를 보강했다.
- 브라우저 스모크 검수에 빈 출발 수량 차단과 현재 구역 시작 버튼 위치 검증을 추가했다.

테스트:

- `npm run check`: 통과, 도메인 테스트 46/46.
- `npm run build`: 통과.
- headless 브라우저 검수: 통과.

브라우저 검수 결과:

- 빈 출발 수량 차단: 통과.
- 현재 구역 시작 버튼이 순서 편집보다 위에 있음: 통과.
- 작업 순서 화살표 이동: 통과.
- 대체배송 추가: 통과.
- 미주 전체 수량 누락 차단: 통과.
- 미주 나머지 자동계산: 통과.
- 뒤 구역 전체 수량 자동차감: 통과.
- 무입력 완료 차단: 통과.
- 말도 안 되게 큰 수량 방어: 통과.

완료 판정:

- 로컬 소스 구현과 검수는 완료됐다.
- GitHub Pages 배포와 push는 하지 않았다.

### 정기휴무 가상표시 보강

상태: 구현 및 검수 완료, 배포 대기

수정 파일:
- `instruction.md`
- `src/app/main.ts`
- `public/styles.css`
- `scripts/browser-smoke.mjs`
- `todo.md`
- `progress.md`
- `changelog.md`

반영:
- 과거 일요일/월요일에 기록이 없으면 통계/조회 화면에서만 `정기휴무`로 표시한다.
- 오늘과 미래 날짜는 자동 휴무로 판단하지 않는다.
- 휴무는 저장 원본으로 자동 생성하지 않고, 백업 JSON에도 빈 휴무 기록을 만들지 않는다.
- 날짜조회에서 과거 정기휴무 빈 날짜를 선택하면 화면 표시 전용 휴무임을 안내한다.
- 월간 일별 목록은 과거 날짜 범위를 기준으로 보여주며, 기록 없음과 정기휴무를 구분한다.
- 브라우저 스모크 검수에 `statsVirtualHoliday` 항목을 추가했다.

검수:
- `npm run check`: 통과, 도메인 테스트 46/46.
- `npm run build`: 통과.
- `node --check scripts/browser-smoke.mjs`: 통과.
- 브라우저 스모크 검수: 새 검수 프로필의 `411x762 / DPR 2.63`에서 통과.
- `statsVirtualHoliday`: 통과.

완료 판정:
- 로컬 소스 구현과 검수는 완료됐다.
- GitHub Pages 배포와 push는 하지 않았다.

### 통계 탭 기간 탐색 보강

상태: 구현 및 검수 완료, 배포 대기

수정 파일:
- `src/app/main.ts`
- `public/styles.css`
- `scripts/browser-smoke.mjs`
- `todo.md`
- `progress.md`
- `unresolved.md`
- `changelog.md`

반영:
- `통계` 탭을 `주간 / 월간 / 날짜조회` 서브탭 구조로 바꿨다.
- 주간/월간 화면에서 미주/힐스테이트/대체배송 비율카드를 최상단 핵심 카드로 배치했다.
- 주간은 이전주/다음주 이동, 주 범위, 총 배송, 근무일, 평균 효율, 스캔차, 배송 시간, 일 평균, 구역별 요약, 일별 현황을 표시한다.
- 월간은 이전달/다음달 이동, 월 제목, 총계/효율 요약, 최다/최소 배송일, 구역별 요약, 요일별 평균, 해당 월 기록 목록을 표시한다.
- 날짜조회는 선택 날짜의 요약, 로그, 리포트를 한 화면에서 보여준다.
- 브라우저 스모크 검수에 통계 비율카드 우선순위, 주/월 이동, 날짜조회 검증을 추가했다.

검수:
- `npm run check`: 통과, 도메인 테스트 46/46.
- `npm run build`: 통과.
- 브라우저 스모크 검수: `411x762 / DPR 2.63`에서 통과.
- `statsRatioCardFirst`, `statsRatioLabel`, `statsWeekNavigation`, `statsMonthNavigation`, `statsDateSearch` 모두 통과.

완료 판정:
- 로컬 소스 구현과 검수는 완료됐다.
- GitHub Pages 배포와 push는 하지 않았다.

### 공통 구역 UI 현장 순서 보정

상태: 구현 및 검수 완료, 배포 대기

수정 파일:

- `instruction.md`
- `src/app/main.ts`
- `public/styles.css`
- `scripts/browser-smoke.mjs`
- `review-mobile.png`
- `progress.md`
- `todo.md`
- `unresolved.md`
- `changelog.md`

반영 내용:

- `instruction.md` 최상단에 `0. 최상위 설계 원칙: 사용자 편의`를 추가했다.
- 사용자 편의와 현장 다음 행동 우선 원칙을 절대 규칙보다 위에 두었다.
- 한국어 문서는 처음부터 UTF-8 기준 도구로 읽고, 깨져 보이는 PowerShell 출력은 작업 근거로 쓰지 않는다는 규칙을 추가했다.
- 한국어 문서 UTF-8 우선 규칙을 `0-1. 최상위 작업 전제`로 승격했다.
- 작업 전 절차에 한국어 문서를 UTF-8 기준 도구로 확인한다는 항목을 추가했다.
- 현장 흐름 UI는 코드 상태 순서가 아니라 다음 행동 순서로 배치한다는 규칙을 `instruction.md`에 추가했다.
- 힐스테이트, 대체배송, 추가구역 공통 UI에서 `정리 시작`을 최상단 주버튼으로 배치했다.
- `바로 배송 시작`은 예외 행동이므로 보조 버튼으로 낮췄다.
- 정리 중 화면은 `정리 완료`를 안내문보다 먼저 보여주게 했다.
- 수량 입력 단계는 `전체 수량` 입력칸과 완료 버튼을 먼저 보여주고 설명을 아래로 내렸다.
- 보조 버튼 스타일을 추가했다.
- 브라우저 스모크 검수에 공통 구역 UI 순서 검증을 추가했다.

테스트:

- `npm run check`: 통과, 도메인 테스트 46/46.
- `npm run build`: 통과.
- headless 브라우저 검수: 통과.

브라우저 검수 결과:

- `genericInitialUiOrder`: 통과.
- `genericSortingUiOrder`: 통과.
- `genericCountUiOrder`: 통과.
- 기존 필드 입력 스모크 검수 항목도 유지 통과.

완료 판정:

- 로컬 소스 구현과 검수는 완료됐다.
- GitHub Pages 배포와 push는 하지 않았다.

### 최상위 규칙 승격 체계 보강

상태: 문서 반영 완료

수정 파일:
- `instruction.md`
- `todo.md`
- `progress.md`
- `changelog.md`

반영:
- 중요 지시가 하위 문서에만 남고 최상위 규칙으로 올라가지 않는 문제를 작업 시스템 문제로 정리했다.
- `instruction.md`에 `0-2. 최상위 작업 전제: 중요 지시 승격과 문서 위치`를 추가했다.
- 데이터 보존과 `DayRecord.timeline` 원본 우선 원칙을 `0-3. 최상위 데이터 원칙`으로 승격했다.
- 실제 앱/브라우저 검수 없이는 현장 흐름 작업을 완료 처리하지 않는 원칙을 `0-4. 최상위 검수 원칙`으로 승격했다.
- 작업 전 절차에 새 지시가 최상위 규칙 후보인지 판단하고, 후보면 `instruction.md` 반영 위치를 먼저 보고하는 단계를 추가했다.

검수:
- 문서 항목 검색으로 최상위 섹션과 작업 전 절차 반영을 확인했다.

완료 판정:
- 문서 운영 규칙 보강은 완료됐다.
- 코드 수정, 빌드, 배포, push는 하지 않았다.

### 완료 기록 수정 폼 및 시간축 검증 보강

상태: 구현 및 검수 완료, 배포 대기

수정 파일:
- `instruction.md`
- `todo.md`
- `progress.md`
- `changelog.md`
- `public/styles.css`
- `scripts/browser-smoke.mjs`
- `src/app/main.ts`

반영:
- 완료 기록 수정 폼에서 날짜/연도까지 보이는 `datetime-local` 입력을 시간 전용 입력으로 바꿨다.
- 완료 기록 수정 폼의 미주/일반 구역 그리드를 모바일 폭 기준으로 재정리했다.
- 시간 저장 시 현재 업무 날짜와 입력 시간을 결합하고, 기존 이벤트의 초 단위는 가능한 보존한다.
- 구역 시작이 청량리 도착보다 빠르거나 이전 구역 완료보다 빠르면 저장을 차단한다.
- 구역 종료가 다음 구역 시작보다 늦거나 업무 종료보다 늦으면 저장을 차단한다.
- 로그는 같은 분 안에서 업무 이벤트 우선순위로 정렬해 청량리 도착과 구역 시작 순서가 뒤집히지 않게 했다.
- 브라우저 검수는 모바일 폭 기준으로 진행해야 한다는 원칙을 `instruction.md` 최상단 검수 원칙에 추가했다.

검수:
- `npm run check`: 통과, 도메인 테스트 46/46.
- `npm run build`: 통과.
- 모바일 폭 브라우저 검수: 통과.
- 검수 항목 `mobileViewport`, `editFormMobileOk`, `timelineEditBlocked`, `arriveBeforeMijuStart` 모두 통과.

완료 판정:
- 로컬 소스 구현과 검수는 완료됐다.
- GitHub Pages 배포와 push까지 완료했다.
- 배포 저장소 커밋: `ede9022 Deploy fold cover field fixes`
- 원격 `sw.js`에서 `delivery-master-install-v11` 반영을 확인했다.

### 실제 폴드 앞 화면 검수 기준 반영

상태: 완료

수정 파일:
- `instruction.md`
- `todo.md`
- `progress.md`
- `changelog.md`
- `unresolved.md`
- `scripts/browser-smoke.mjs`

반영:
- 실제 폴드 앞 화면 CSS 값 `411x762 / DPR 2.63`을 기본 모바일 검수 기준으로 바꿨다.
- `360x800 / DPR 3`은 기본값이 아니라 좁은 폭 보수 검수 옵션으로 남겼다.

검수:
- `node --check scripts/browser-smoke.mjs`: 통과.
- 브라우저 스모크 검수: `411x762 / DPR 2.63`에서 통과.
- `mobileViewport`, `editFormMobileOk`, `timelineEditBlocked`, `arriveBeforeMijuStart`, `backupShowsViewport` 포함 전체 스모크 항목 통과.

완료 판정:
- 로컬 소스 구현과 검수는 완료됐다.
- GitHub Pages 배포는 하지 않았다.

### 갤럭시 폴드 앞 화면 기준 검수 보강

상태: 구현 및 검수 완료, 배포 대기

수정 파일:
- `instruction.md`
- `todo.md`
- `progress.md`
- `changelog.md`
- `scripts/browser-smoke.mjs`
- `src/app/main.ts`
- `review-fold-cover-360x800.png`

반영:
- `instruction.md` 최상위 검수 원칙에 갤럭시 폴드 접힌 앞 화면 기준을 추가했다.
- 오빠가 보내는 현장 스크린샷은 실제 앞 화면 검수 증거로 취급하도록 명시했다.
- 브라우저 스모크 기본 뷰포트를 `360x800 / DPR 3`으로 보강했다.
- `백업설정` 화면에 실제 CSS 화면값을 보여주는 `화면 정보` 항목을 추가했다.

검수:
- `node --check scripts/browser-smoke.mjs`: 통과.
- `npm run check`: 통과, 도메인 테스트 46/46.
- `npm run build`: 통과.
- 브라우저 스모크 검수: `360x800 / DPR 3`에서 통과.
- 검수 항목 `mobileViewport`, `editFormMobileOk`, `timelineEditBlocked`, `arriveBeforeMijuStart`, `backupShowsViewport` 포함 전체 통과.

완료 판정:
- 로컬 소스 구현과 검수는 완료됐다.
- GitHub Pages 배포와 push는 하지 않았다.
## 2026-06-03 승인 기록 / 작업 트리 훅 보강

상태: 문서/훅 반영 완료

수정 파일:

- `instruction.md`
- `progress.md`
- `todo.md`
- `changelog.md`
- `scripts/codex-precommit-check.mjs`

반영 내용:

- 승인 직후 `progress.md`에 작업 시작 기록을 남기는 규칙을 최상위 작업 전제로 추가했다.
- 작업 전 절차를 `이해 보고 -> 승인 -> progress 기록 -> 작업` 순서로 정리했다.
- 코드/스크립트/테스트/package 변경 커밋 시 `progress.md`와 `changelog.md`가 함께 staged 되도록 pre-commit 훅을 보강했다.
- `todo.md` 또는 `unresolved.md`는 모든 작업에 강제하지 않고, 코드 변경 시 검토 알림을 출력하도록 했다.

검수 계획:

- `node --check scripts/codex-precommit-check.mjs`
- `npm run check:codex`
- staged dry-run으로 `progress.md` / `changelog.md` 동반 규칙 확인
## 2026-06-06 정리 UI / 통계 비율 최종 보정

상태: 구현/검수/배포 완료

수정 파일:

- `src/app/main.ts`
- `src/app/version.ts`
- `scripts/browser-smoke.mjs`
- `review-fold-cover-411x762.png`
- `todo.md`
- `progress.md`
- `changelog.md`

반영 내용:

- 업무 탭에서 현재 작업 단계가 정리 완료 누락 보정 패널보다 먼저 나오도록 렌더링 순서를 바꿨다.
- 정리 시작 후에는 `정리 완료`가 `보정 적용`, `정리 없음`보다 위에 표시된다.
- 주간/월간 통계 비율카드 상단 배지를 수량비 대신 `미57:힐43:대0` 같은 백분율 요약으로 바꿨다.
- 브라우저 스모크 검수가 false 항목을 출력만 하고 통과하던 문제를 고쳐, 실패 항목이 있으면 종료 실패로 처리하게 했다.
- 브라우저 스모크 시작 시 origin storage를 지워 이전 검수 상태가 남지 않게 했다.
- 앱 버전과 캐시를 `0.2.11-field-final-polish / v12`로 올렸다.

검수 결과:

- `node --check scripts/browser-smoke.mjs`: 통과
- `npm run check`: 통과, domain tests 46/46
- `npm run build`: 통과
- `node scripts/browser-smoke.mjs`: 411x762 / DPR 2.63에서 전 항목 true
- 추가 확인 항목: `sortingEndBeforeCleanupCorrection`, `statsRatioLabel`

배포 결과:

- 배포 저장소 커밋: 96e3de7 Deploy final polish v12`n- GitHub Pages 원격 sw.js에서 delivery-master-install-v12 확인.

남은 위험:

- 일요일 실제 대체배송 필드 테스트는 아직 남아 있다.
## 2026-06-07 바로 배송 시작 완료 저장 핫픽스

상태: 구현/검사/빌드/배포 완료

수정 파일:

- `src/app/main.ts`
- `src/app/version.ts`
- `scripts/browser-smoke.mjs`
- `todo.md`
- `progress.md`
- `changelog.md`

반영 내용:

- 미주 외 구역 완료 저장 조건을 수정했다.
- `정리 시작`을 누른 경우에만 `정리 완료`를 요구한다.
- `바로 배송 시작` 루트는 `정리 완료` 없이 수량 완료 저장을 허용한다.
- 힐스 첫 구역 `바로 배송 시작 -> 13개 완료` 검수 케이스를 브라우저 스모크에 추가했다.
- 앱 버전과 캐시를 `0.2.12-direct-delivery-hotfix / v13`으로 올렸다.

검수 결과:

- `node --check scripts/browser-smoke.mjs`: 통과
- `npm run check`: 통과, domain tests 46/46
- `npm run build`: 통과
- 브라우저 스모크는 새 창을 띄우지 않기 위해 생략했다. 기존 CDP 포트가 닫혀 있었고, 현장 막힘 해소가 우선이다.

배포 결과:

- source 커밋:  6b579a Allow direct delivery zone completion`n- 배포 저장소 커밋: 33751c9 Deploy direct delivery hotfix v13`n- GitHub Pages 원격 sw.js에서 delivery-master-install-v13 확인.

남은 위험:

- 오늘 현장 실제 힐스/대체배송 완료 저장 확인이 필요하다.
## 2026-06-07 직접배송 공통 검수 확장

상태: 문서/검수 보강 완료

수정 파일:

- `instruction.md`
- `scripts/browser-smoke.mjs`
- `todo.md`
- `progress.md`
- `changelog.md`

반영 내용:

- 현장 장애 긴급 대응 기준을 최상위 규칙에 추가했다.
- 대체배송 직접배송 완료 검수 항목을 추가했다.
- 추가구역 직접배송 완료 검수 항목을 추가했다.
- v13 배포 결과를 source 문서에 보강했다.

검수 계획:

- `node --check scripts/browser-smoke.mjs`
- `npm run check`
- `npm run build`
- `npm run check:codex`

## 2026-06-07 기록 정정 재수정 보강

상태: 구현/검수 진행 중

수정 파일:

- `instruction.md`
- `src/app/main.ts`
- `scripts/browser-smoke.mjs`
- `todo.md`
- `progress.md`
- `unresolved.md`
- `changelog.md`

반영 내용:

- 백업설정의 `기록 정정`을 단발 전환 버튼이 아니라 반복 수정 가능한 정정 목록으로 바꿨다.
- 완료 구역을 도우미 배송 무료/유료로 전환할 수 있게 했다.
- 전환된 도우미 기록은 무료/유료, 수량, 시각을 다시 수정할 수 있게 했다.
- 잘못 전환한 도우미 기록을 대체배송, 힐스테이트, 미주, 추가구역 기록으로 복구할 수 있게 했다.
- 도우미 전환 시 새 이벤트 ID를 타임라인 마지막 이벤트로 잘못 연결하던 문제를 고쳤다.
- 복구된 미주/힐스테이트 구역도 주간/월간 비율 통계에서 미주/힐스로 분류되게 보정했다.
- 브라우저 스모크에 도우미/구역 역변환 검수 루트를 추가했다.
- 앱 버전과 캐시를 배포 후보 `0.2.14-record-correction-rework / v15`로 올렸다.
- 사전검사 스크립트가 예전 source 폴더명만 허용하던 문제를 현재 source-of-truth 폴더명 기준으로 고쳤다.
- 브라우저 검수용 임시 프로필 `.chrome-smoke/`가 커밋에 섞이지 않도록 `.gitignore`에 추가했다.
- `HOTFIX_HANDOFF.md`를 v15 기준으로 갱신하고, 최신 업데이트 기록은 5개만 유지하며 6개째부터 가장 오래된 항목을 삭제하는 규칙을 추가했다.

검수 결과:

- `npm run check`: 통과, domain tests 48/48
- `npm run build`: 통과
- 브라우저 스모크 검수: 411x762 / DPR 2.63, 전체 항목 true
- 추가 검수 항목: `directHilsFirstComplete`, `directAlternateComplete`, `directCustomComplete`, `correctionAltToPaidHelper`, `correctionPaidToFreeHelper`, `correctionHelperRestoredToAlt`, `correctionHelperRestoredToHils`, `correctionHelperRestoredToMiju`

## 2026-06-07 기록 정정 선택형 반복 수정 v16

상태: 구현/검수 완료

수정 파일:

- `src/app/main.ts`
- `scripts/browser-smoke.mjs`
- `src/app/version.ts`
- `todo.md`
- `progress.md`
- `unresolved.md`
- `changelog.md`
- `HOTFIX_HANDOFF.md`

반영 내용:

- `기록 정정`을 단발 카드 목록에서 `수정할 기록 선택 -> 기록 불러오기 -> 선택 기록 정정 반영` 구조로 바꿨다.
- 완료 구역의 구역 종류, 이름, 수량, 시작/종료, 정리 시작/완료, 실패/추가를 반복 수정할 수 있게 했다.
- 도우미 배송 무료/유료 전환 후에도 다시 무료/유료, 수량, 시각을 재수정할 수 있게 했다.
- 도우미 기록을 구역으로 복구한 뒤에도 다시 선택해서 재수정할 수 있게 했다.
- 도우미에서 구역으로 복구할 때 실제 시작시간 기준으로 구역 순서를 재정렬해 재수정 검증이 막히지 않게 했다.
- 기록 정정에서 시간칸을 바꾸지 않은 경우 기존 시간 검증을 건드리지 않아, 이름/수량만 고치는 현장 정정이 막히지 않게 했다.
- 앱 버전과 캐시를 `0.2.15-repeatable-record-correction / v16`으로 올렸다.

검수 결과:

- `npm run check`: 통과, domain tests 48/48
- `npm run build`: 통과
- 브라우저 스모크 검수: 411x762 / DPR 2.63, 별도 Chrome 프로필, 전체 항목 true
- 추가 확인: `correctionZoneRepeatedEdit` 통과

## 2026-06-08 지난 날짜 기록 정정 v17

상태: 구현/검수 완료

수정 파일:

- `src/app/main.ts`
- `src/app/version.ts`
- `scripts/browser-smoke.mjs`
- `todo.md`
- `progress.md`
- `changelog.md`
- `HOTFIX_HANDOFF.md`

반영 내용:

- `백업설정 > 기록 정정`에 `정정 날짜` 선택을 추가했다.
- 저장된 지난 날짜 기록을 불러와 기존 선택형 기록 정정 UI에서 수정할 수 있게 했다.
- 지난 날짜 정정 후 `오늘로 돌아가기`로 현재 날짜 기록을 다시 불러올 수 있게 했다.
- 선택 날짜가 오늘이 아니면 초기화 버튼 문구를 `선택 날짜 초기화`로 바꿨다.
- 앱 버전과 캐시를 `0.2.16-past-record-correction / v17`로 올렸다.

검수 결과:

- `npm run check`: 통과, domain tests 48/48
- `npm run build`: 통과
- 브라우저 스모크 검수: 411x762 / DPR 2.63, 별도 Chrome 프로필, 전체 항목 true
- 추가 확인: `pastCorrectionSeeded`, `pastCorrectionDateLoaded`, `pastCorrectionEdited` 통과
