# 배송마스터 설치형 결정 기록

## 2026-05-18
- 배송마스터 설치형은 기존 시즌1/시즌2를 그대로 확장하지 않고 새 구조로 재개발한다.
- 하루 타임라인 이벤트를 원본 데이터로 삼는다.
- 로그 화면, 리포트, 통계는 원본 데이터에서 파생한다.
- 레거시 시즌1/시즌2 코드는 읽기전용 참조로만 사용한다.
- 데이터 마이그레이션은 원본을 덮어쓰지 않고 복사본으로 먼저 수행한다.

## 2026-07-10

- 현재 개발앱 PWA를 새 source-of-truth로 승격하고 설치판은 이 공통 원본에서 파생한다.
- Android 설치판은 Capacitor 8과 내부 SQLite로 확정했고, package ID `io.github.owenyu9292.deliverymaster`로 Android 프로젝트와 debug APK를 생성했다.
- 설치판은 다운로드 파일을 계속 쌓지 않고 내부 저장소에서 날짜별 `DayRecord`를 갱신한다.
- 저장 구현은 `DayStore` 뒤의 `SqliteDayStore`로 추가했으며 웹/PWA는 기존 IndexedDB를 유지한다.
- PWA IndexedDB는 자동 승계하지 않고 전체 백업 JSON을 한 번 검증 가져오기한다.
- package ID와 서명키를 첫 배포부터 고정한다.
- 상세 기준은 `INSTALL_ARCHITECTURE.md`를 따른다.
