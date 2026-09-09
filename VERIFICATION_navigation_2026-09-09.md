# 스크롤·뒤로가기 및 기본 조작 재검수 (2026-09-09)

이 문서는 리포트 재설계 전 검사 기록이다. 후속 최종 소스/검사용 APK 해시/38+22묶음 결과는 VERIFICATION_report_2026-09-09.md를 기준으로 한다. 아래 APK 경로의 파일은 후속 로컬 빌드로 교체되었다.

## 현재 상태와 범위

- 사용자 v38 설치 화면에서 마지막 구역 현황이 하단 메뉴에 가리고 더 내려가지 않는 문제를 보고했다.
- 수정 기준 HEAD dcae04f, 브랜치 codex/hils-handling-minutes. Android 인스톨판 소스만 수정했다.
- 로컬 수정·회귀검사·검사용 APK 빌드 완료. 버전은 아직 v38이며 새 배포 버전이 아니다. 커밋·푸시·공개·폰 설치는 하지 않았다.
- 기존 PWA/main/season2, 공개 downloads APK, 사용자 업무 자료를 변경하지 않았다. 임시 브라우저 프로필·합성 자료로 검사했다.

## 확인한 결함과 수정

1. 하단 공간이 88px 고정이라 실제 메뉴 높이가 이를 넘으면 마지막 내용이 가렸다. 메뉴 padding을 110px로 늘린 재현에서 footer174px, 마지막 항목 bottom673px, 메뉴 top588px, scrollY=max126이었다. 끝까지 스크롤해도 85px 가렸다.
2. 실제 메뉴 border-box 높이를 ResizeObserver로 측정하고 하단 공간을 자동 갱신했다. 콘텐츠 크기만 관찰하면 padding 변경을 놓치는 문제도 실패 재현 후 border-box 관찰로 수정했다. 화면·키보드 크기 변경과 편집창 최대 높이도 연동했다.
3. Android backButton 연결은 화면 상태와 무관하게 App.exitApp을 호출했다. 이제 입력 포커스, 구역 편집, 로그 편집, 수량 확인, 펼친 항목, 탭 순으로 처리하고 업무 기본 화면에서만 종료한다. 저장 중에는 종료하지 않는다. 연속 누름과 비동기 처리 중 재호출도 차단한다.
4. 편집창 Escape/배경 취소도 저장 중에는 닫히지 않도록 보강했다. 편집 취소로 업무 입력 초안이나 저장 원본을 삭제하지 않는다.

## 실행 결과

| 검사 | 결과 및 경계 |
| --- | --- |
| npm run check | 타입 검사, 기존61 도메인, 플랫폼/저장/복구/시간/수량 검사 통과 |
| 시간·수량 스트레스 | 2684 결정적 조합 통과. 시간 역전, 순서, 큰 수량, 수정·복구·JSON 포함 |
| 통계 | 15묶음 +600변형 통과. 불확실 효율, 무료/유료 도우미, 원본 불변 포함 |
| 뒤로가기 디스패처 | 5묶음, 연속 누름/지연/예외/100회 왕복 통과. OS 제스처가 아닌 함수 검증 |
| npm run check:browser | 업무34묶음 + 저장·정정22묶음 통과. 격리된 headless Chrome |
| 마지막 내용 도달 | 5탭 x4화면 x3하단 여백 =60조합. 실제 wheel 입력으로 끝까지 스크롤 후 가림 검사 |
| 화면 범위 | 411x762 DPR2.63, 360x640, 762x411, 411x430. 추가 360x430 편집창, 150% 글자 |
| 버튼 실제 클릭 | 최하단 구역 현황, 25개 예정 구역 중 마지막 편집, 작은 편집창 삭제 버튼의 가림 확인 후 좌표 클릭 |
| 뒤로/취소 | 입력 포커스 해제, 구역/로그 편집 닫기, 업무 탭 복귀, 기본 화면 종료 허용. 브라우저에서는 실제 앱 콜백을 호출하는 테스트 전용 연결 사용 |
| 저장 중단 | 느린 저장 중 Back/Escape, 완료 저장 실패 재시도·중복 탭, 완료 저장 대기 중 reload 후 원본과 수량100 초안 보존 |
| 계산 및 업무 | 빈값/0/99999, 반복 대체배송, 순서 변경, 누적차감, 미주 A/B, 도우미 유료/무료/구역 왕복, 자정·시간 재수정 |
| 가져오기 | 잘못된 내부 JSON, 두 번째 쓰기 실패, transaction abort, skip/overwrite, 저장 후 스냅샷 실패, 손상 원문 보존/복구. 선택 취소도 원본 유지 |
| 실제 SQLite 파일 | 6종 실패·재개방·원자적 복구 통과. Android 플러그인 실기기 검사는 아님 |
| APK | build, cap sync android, assembleDebug 성공. 내장 app.js/field-app.css/styles.css/index.html과 dist 해시 일치 |

## 검수 증거

- docs/review-navigation-2026-09-09/field-result.json: 업무34묶음.
- docs/review-navigation-2026-09-09/storage-result.json: 저장·정정22묶음.
- 같은 폴더 14/15/16 PNG: 하단 여백 재현 조건, 마지막 메뉴 실제 펼침, 150% 확대 글자. 15/16은 직접 이미지로도 확인했다.
- 임시 원본 결과: C:\Users\Lenovo\AppData\Local\Temp\delivery-field-v37-V0YMmJ 및 delivery-handling-PriG0f.
- 실제 SQLite 파일 결과: C:\Users\Lenovo\AppData\Local\Temp\delivery-sqlite-safety-dEe8RO.
- 검사용 APK: android/app/build/outputs/apk/debug/app-debug.apk. SHA256 F09FFBFA3482BC3A2F100E4E01531F6D164DA7B5B1E2D9AE0FDAC805299E508A.
- 기존과 같은 서명 SHA256 f7f90c90211f12d16e03ce0381657690b5bd7de06b52f46abad70a795081f164. 공개 APK는 교체하지 않았다.

## 남은 검증과 이전 검수의 한계

- 이전 검수는 계산·저장과 화면 폭 위주였고 실제 스크롤 끝에서 마지막 항목을 누를 수 있는지를 충분히 검증하지 못했다. 기존 검사 통과를 이 항목까지 확인한 것으로 표현하면 안 된다.
- 이번에 같은 형태의 가림을 재현·수정했지만, 원래 Fold7에서 발생한 native inset/폰트 조건을 직접 측정한 것은 아니다.
- adb devices -l에 연결 기기 없음. Fold7 실제 뒤로가기 버튼/제스처, 삼성 키보드 열기/닫기, 유료 폰트, OS 앱 전환·강제 종료, SQLite 플러그인 및 시스템 파일 저장/선택 왕복은 이번 수정 실기기 검수 전이다.
- 브라우저 viewport 축소는 키보드 크기 모사이며 실제 삼성 키보드 검증이 아니다. 내부 back 콜백 시험도 Android OS 이벤트 전달의 실기기 증거는 아니다.
- 재배포 전 별도 버전 갱신과 패키징/내장 파일/서명 대조가 필요하다. 현장 무오류 또는 하루 자료 손실 가능성 0%를 보장하지 않는다.

## 후속 검수에 포함된 자동화

- scripts/browser-navigation-cases.mjs를 기존 check:browser 경로에 연결했다. UI_ONLY=1로 신규8묶음만 독립 재현도 가능하다.
- test:back-navigation을 npm run check에 포함했다. 앞으로 일반 검사에서 기본 뒤로가기 검증이 빠지지 않는다.
