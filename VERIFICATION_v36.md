# v36 검수 및 배포 증거

## 대상

- 저장소: C:\Codex55Workspace\delivery-master\delivery-master-install-deploy
- 브랜치: codex/hils-handling-minutes
- 화면 v36 / APP_VERSION 0.2.35-android-install / Android versionCode9, versionName0.2.35
- package: io.github.owenyu9292.deliverymaster
- PWA main 보존 기준: 1119e923ad6b8bf53e389b890ff9ba2024132d40
- 상태: 로컬 검수 및 APK 빌드 완료. GitHub 공개 결과는 아래 배포 확인 절에 기록한다.

## 자동 검수

- npm run check: 타입, 도메인61/61, 플랫폼, SQLiteDayStore, 런타임 선택, 별도작업시간, 저장 안전성, 실제 SQLite 파일 실패/재개방6종, 정정 안전성 통과.
- npm run test:zone-identity: 명시적 종류와 방문 ID 분리, 4종 조합, 같은 이름, 구형 자료 fallback, 무료/유료 도우미, 보고서/통계 분류, JSON 왕복, 미방문 예정 구역 제외 통과.
- npm run check:field: 새 업무 화면의 실제 클릭/입력6개 시나리오 묶음 통과.
- npm run check:handling: 최종 코드로 기존 저장/복구/정정 회귀22개 시나리오 묶음 재실행 통과.
- npm audit --omit=dev: 프로덕션 의존성 취약점 0. 개발 도구 전체 audit의 기존 경고와는 구분한다.

## 현장 가혹 검수

1. 진행 중 힐스 -> 대체 -> 미주 -> 대체 -> 미주 -> 힐스. 방문 ID/시간, 100 입력, 5+6+9=20 A기록 및 재실행 보존.
2. 빈값, 0, 음수, 소수, 문자, NaN, 지수 표기, 99999. 잘못된 입력으로 완료되지 않으며 입력을 고쳐 다시 진행.
3. 대체배송7개 추가 및 순서 변경. 대체13 -> 미주 누적32(19) -> 대체 누적53(21) -> 힐스 누적70(17) -> 재방문 미주 누적90(20). 합계90, 방문별 A/B 분리.
4. 잘못 추가 취소, 저장 실패 주입 후 전체 원본/이름/편집창 보존, 재시도 두 번 눌러도 하나만 추가. 예정 대체 -> 미주 -> 힐스 -> 삭제. 예정 전부 삭제 후 마감 가능.
5. 구역 완료 저장 실패 주입 후 원본과 100 입력 보존. 재시도 두 번 눌러도 완료 이벤트1개.
6. 411x762/DPR2.63 및360폭, 정확한150% 글자 확대. 가로 넘침/하단 탐색 잘림 없음. 정리 완료 우선, 보정 접힘, 런타임 미처리 예외 없음.

원래 사용자의 브라우저/업무 DB가 아닌 별도 headless Chrome 프로필과 임시 DB만 사용했다.

## 증거 위치

- 최종 새 업무 UI: C:\Users\Lenovo\AppData\Local\Temp\delivery-field-v36-UgXYyf\result.json 및 화면11장
- 최종 저장/정정22묶음: C:\Users\Lenovo\AppData\Local\Temp\delivery-handling-88hyUm
- 최종 실제 SQLite 파일6종: C:\Users\Lenovo\AppData\Local\Temp\delivery-sqlite-safety-NzW2Hf
- 보관 스크린샷: docs/review-v36/

## APK 검증

- npm run build, npx cap sync android, gradlew assembleDebug --no-daemon 성공.
- 파일: downloads/DeliveryMaster-v36-debug.apk
- 크기: 25,411,390바이트
- SHA-256: 1C2F492E984C3A56D50B4FEE13446A266C1B393CE8ADA4ED2787B890C16AF7D3
- v35와 동일 서명 SHA-256: f7f90c90211f12d16e03ce0381657690b5bd7de06b52f46abad70a795081f164
- APK 내 assets/app.js, sourcemap, styles.css, field-app.css, index.html이 최종 dist와 바이트 해시 일치.
- app.js SHA-256: 0C6E4EF28B7FA2BD0E87B6105B41FFB3D1269F3408AA22C37821A319BCF7BEE2
- field-app.css SHA-256: 9F4DDF08BC6489F05A6AD20AA112F5BEE8A05A797C8ACD11805F3ACBDAD6064A

## 확인하지 못한 부분

- adb devices: 연결 기기 없음. 실제 Fold7 설치/키보드/유료 삼성 폰트/Android 문서 선택창은 이번 버전 실기기 미검수.
- 실제 SQLite 파일 검수는 Android 플러그인 실기기 검수와 다르다.
- 모든 가능한 버그가 없다는 보증은 아니다. 수행한 범위와 미검수 범위를 분리한다.

## 배포 확인

공개 전. 승인된 커밋/푸시/GitHub APK 배포 후 실제 공개 다운로드 해시를 기록한다.
