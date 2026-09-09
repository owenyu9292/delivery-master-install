# Android v39 배포 검증

## 대상

- 소스: delivery-master-install-deploy / codex/hils-handling-minutes.
- 설치판 APK만 배포. PWA 게시본, main의 보관용 웹 파일, season2 변경/게시 없음.
- 배포 상태: 소스 커밋509519c, 작업 브랜치와 v39 태그 푸시, GitHub 릴리스 공개 완료. Release ID385523572.
- 전달할 GitHub 페이지: https://github.com/owenyu9292/delivery-master-install/releases/tag/v39

## 동일 설치본

- 파일: DeliveryMaster-v39-debug.apk.
- 원본: android/app/build/outputs/apk/debug/app-debug.apk.
- SHA256: 1D63627005CBD477B47BDDF46CFAE4E5467D74784C5BFA0278A7B8EA0ADA9E09.
- 패키지: io.github.owenyu9292.deliverymaster. versionCode12, versionName0.2.38, 화면 v39.
- 기존 서명 유지: f7f90c90211f12d16e03ce0381657690b5bd7de06b52f46abad70a795081f164.
- 폰 USB 설치 성공 및 설치 전후 DB 해시 동일. 이미 설치한 사용자는 다시 설치할 필요 없다. 앱을 삭제하지 않고 업데이트 설치한다.
- APK 내 app.js/field-app.css/styles.css/index.html 해시가 최종 dist와 일치.

## 변경과 검수

- 공통 스크롤/키보드 여백/Back 동작, 전체 높이 리포트, 오입력 원문 보존/재시도, 디스크 저장 후 성공 알림, 저장 실패 시 동별 초안 보존, 버튼 간격·터치 높이 보완.
- npm run check 전체 통과. 최종 간격/기본 브라우저: delivery-field-v37-IGEnOH, 버튼378회/제어912회/입력168회, 키보드 모사16조건.
- 상세 문서: VERIFICATION_spacing_2026-09-09.md, VERIFICATION_basics_2026-09-09.md 및 keyboard/navigation/report 검수 문서.
- 실제 Fold7의 설치/데이터 보존 및 삼성 숫자 키보드 공백 해소는 확인. 실제 시간 키보드·시스템 Back·파일 선택/내보내기 왕복 전체는 미완료. 브라우저 검수를 전 실기기 통과라고 보고하지 않는다.
- Android lint 오류0/경고17 기록 유지. 이번 간격 변경은 TS 마크업/CSS 변경이다.
- 비공개 DB 백업과 기기 캡처는 .device-backup/.device-qa에 보관하고 Git에서 제외한다. 공개 검수 스크린샷은 합성 테스트 자료이다.

## 공개 검증

- 비로그인으로 릴리스 API 및 실제 APK 다운로드 성공. 25,463,087바이트, 위 SHA256과 동일. 다운로드 검사는 메모리에서 수행해 추가 파일을 남기지 않았다.
- 배포 직전 전체 브라우저 재검수: 업무50묶음 delivery-field-v37-ub4fQD, 저장22묶음 delivery-handling-O6Eq1Y, 키보드 모사16조건 delivery-field-v37-5BvMMj. 모두 통과. 결과는 docs/review-basic-2026-09-09/v39-release-*-result.json에 보관.
- 사용자 폰은 이미 동일 APK 설치 완료. 공개 릴리스 때문에 재설치할 필요 없음.
