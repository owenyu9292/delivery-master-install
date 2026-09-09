# v38 인스톨 통계 확장 배포 검증

- 사용자 배포 승인: 2026-09-09. 작업 전 HEAD 75b317f5d55807d1623704b3865b65dddf8328e7.
- 브랜치 codex/hils-handling-minutes. 기존 PWA main 1119e923ad6b8bf53e389b890ff9ba2024132d40 보존.
- 통계 확장 내역 및 예외 처리: VERIFICATION_statistics_2026-09-09.md. 기존 업무·저장 자료 구조 변경 없음.
- 화면 v38 / APP_VERSION 0.2.37-android-install / Android versionCode11, versionName0.2.37.

## 최종 재검수

- npm run check 통과: 도메인61, 기존 저장/SQLite/런타임/정정 검사, 시간 연동17, 자동 정리18, 시간·수량2684조합, 도우미 원복11, 통계15묶음+600변형.
- npm run check:browser 통과: 업무·시간·도우미·통계26묶음 + 저장·정정22묶음. 401일 원본 불변, 과거18개월 왕복, 상세 전부 펼침, 날짜 이동 포함.
- Fold7 앞 화면411x762/DPR2.63, 추가360폭/글자150%. 사용자 Chrome와 무관한 독립 headless 프로필·임시 DB 사용.
- 영구 증거 docs/review-v38/field-result.json, storage-result.json 및 두 통계 화면 PNG.
- 원래 증거 delivery-field-v37-e5ZjbO, delivery-handling-tkVqI8 (임시 폴더 이름 v37은 검수 도구 접두사이며 실행한 소스는 v38).
- 실제 SQLite 파일6종: C:\Users\Lenovo\AppData\Local\Temp\delivery-sqlite-safety-AijB70.

## APK 검증

- npm run build, cap sync android, Gradle assembleDebug 성공.
- downloads/DeliveryMaster-v38-debug.apk, 25,447,490바이트.
- SHA-256: 310079BB8721BAED0BF84C39A4F97599BB0968AA87F241A7027CBA17D2C9251E.
- 패키지 io.github.owenyu9292.deliverymaster 유지. 기존 서명 SHA-256 f7f90c90211f12d16e03ce0381657690b5bd7de06b52f46abad70a795081f164 일치.
- APK 내부 app.js/app.js.map/styles.css/field-app.css/index.html/sw.js가 최종 dist와 전부 일치.
- app.js SHA-256: 0636E64DA2771D98F533159F13B1C7172A3EBD519C049596B0833FB8D2803541.
- 실기기 설치·네이티브 파일 왕복·절전 검수는 별도다. 기존 앱을 삭제하지 말고 백업 후 업데이트 설치한다.

## 공개 상태

APK 로컬 검증 완료. 커밋·푸시·GitHub 공개 및 비로그인 다운로드 검증 결과는 실제 완료 후 아래에 기록한다.
