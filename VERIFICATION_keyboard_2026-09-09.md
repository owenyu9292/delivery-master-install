# 공통 키보드 공백 검수 - 2026-09-09

## 범위와 판정

- 대상: delivery-master-install-deploy Android 인스톨판. 기존 공개 v38의 모든 입력에서 메뉴와 키보드 사이 큰 공백 보고.
- 로컬 수정/자동 검사/격리 브라우저 화면 모사/APK 빌드 완료. 실기기 해결 확인과 배포는 미완료.
- PWA, 사용자 폰 데이터, 외부 브라우저 프로필은 변경하지 않았다. 커밋/푸시/설치 없음.

## 원인과 변경

- MainActivity의 content 루트가 IME 포함 padding을 넣은 뒤 같은 inset을 자식으로 전달했다.
- 설치된 Capacitor Android 8.4.1 SystemBars의 기본 css 처리 역시 WebView 부모에 IME padding을 적용하는 경로가 존재했다.
- SystemBars.insetsHandling=disable로 내부 중복 처리를 끄고 루트에서 처리한 inset을 자식에게 0으로 전달한다.
- Android viewportLayout은 물리적으로 축소된 WebView 높이를 사용한다. visualViewport의 차이를 추가 키보드 padding으로 더하지 않는다.
- 기존 adjustResize, 상태 표시줄 보호, 시스템 글꼴, 입력 자동 스크롤은 유지한다.
- 이 원인 판정은 코드 경로 확인에 근거하며 실제 Fold7의 네이티브 높이 측정은 하지 못했다.

## 검수 결과

- npm run check 통과: 도메인64, 시간2684조합, 통계15묶음+600변형, 저장/정정/도우미/뒤로가기 및 실제 SQLite 회귀 포함.
- npm run check:browser 최종 결과: 업무38묶음 + 저장22묶음 + 키보드 모사16조건, errors=[].
- 키보드: 411px/DPR2.63, 가용 높이520/430/320px 및 닫기 후762px 복원. 수량/시/분/구역 이름 각각 검사.
- 입력값 유지, 원본 기록 불변, 입력칸 히트 테스트, 메뉴 하단 위치 및 추가 키보드 여백0 확인.
- 키보드 모사는 Java/삼성 IME 자체를 실행한 검사가 아니다. 실제 키보드가 렌더링됐다는 의미가 아니다.
- 시간 입력 검수 PNG 직접 확인: 입력칸과 저장/취소가 메뉴 위에 있으며 큰 공백 없음.
- 기존 업무 흐름, 빈값/과대값, 저장 실패/반복 누름/재수정/재시작, 자동 정리, 정정 시간, 60조합 끝 스크롤, 리포트와 날짜 조회 검사도 통과.
- npm run build, cap sync android, Gradle assembleDebug 통과.
- APK 내부 assets/app.js, field-app.css, styles.css, index.html이 최종 dist와 SHA-256 일치.
- APK 내 capacitor.config.json의 SystemBars.insetsHandling=disable 확인.
- APK SHA-256: CA8D5ED015C745C9CEB7193B31DB820FB3BFCB9DF131130D8263DFF96AF979B2
- 기존 인증서 SHA-256: f7f90c90211f12d16e03ce0381657690b5bd7de06b52f46abad70a795081f164
- 검사용 APK 경로: android/app/build/outputs/apk/debug/app-debug.apk. 아직 v38 번호이며 배포용으로 전달하지 않는다.
- 위 APK가 이전 navigation/report 검수 문서에 적힌 로컬 APK를 대체한다. 과거 결과 해시는 당시 이력이다.

## 증거

- docs/review-keyboard-2026-09-09/field-result.json: delivery-field-v37-ymoWLS
- docs/review-keyboard-2026-09-09/storage-result.json: delivery-handling-qgQbIH
- docs/review-keyboard-2026-09-09/keyboard-result.json 및 20-native-keyboard-*.png: delivery-field-v37-vAsu5R
- 전체 자동 검사 SQLite 임시 증거: delivery-sqlite-safety-oy5JSq

## 남은 실기기 검사

- Fold7 실제 삼성 키보드의 모든 입력 열기/닫기/다음, 시스템 뒤로가기/제스처, 반복 포커스와 앱 복귀.
- 유료 폰트/글자 확대, 상태 표시줄과 하단 메뉴, 실제 파일 선택/저장 및 업데이트 설치 후 기존 데이터 보존.
- 실기기 미연결 상태에서 위 항목까지 통과했다고 보고하지 않는다.
