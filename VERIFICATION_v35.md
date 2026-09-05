# v35 배포 검증 (2026-09-05)

- 승인: 사용자 '배포하고 마무리까지'. 대상은 Android 인스톨판, PWA 게시본은 보호.
- 상태: APK 빌드·검수 완료, GitHub 게시 진행 중.
- APK: downloads/DeliveryMaster-v35-debug.apk
- 버전: v35 / 0.2.34-android-install / Android versionCode8, versionName0.2.34.
- 패키지: io.github.owenyu9292.deliverymaster. 앱 이름: 배송마스터. minSdk24 / targetSdk36.
- APK SHA256: 529C6D2323103BB908C7202EF330A59947284C07B1A71A860D0F43D9FEED07D2
- 서명 SHA256: f7f90c90211f12d16e03ce0381657690b5bd7de06b52f46abad70a795081f164. v34와 동일.
- APK 내부 assets/app.js, styles.css, index.html 해시가 dist와 동일하다. 예전 번들이 들어간 APK가 아니다.
- npm run check 통과: 도메인61/61, 플랫폼, 저장소, runtime, handling, correction, 실제 SQLite 파일 테스트 포함.
- v35 숨김 브라우저22개 묶음 통과: C:\Users\Lenovo\AppData\Local\Temp\delivery-handling-u7e0Sr\result.json
- Android assembleDebug / testDebugUnitTest 성공. 실제 단위 테스트는 기본 ExampleUnitTest 1건이며 네이티브 파일 왕복 검증을 대체하지 않는다.
- 현재 adb 연결기기0대. 실제 Fold7 설치·SQLite 재조회·외부 파일 왕복은 미실행. 기존 폰 자료는 건드리지 않았다.
- GitHub Release 예정 URL: https://github.com/owenyu9292/delivery-master-install/releases/tag/v35
- 배포는 작업 브랜치/태그 및 APK Release로 수행한다. PWA를 서비스하는 main 브랜치와 root assets/styles/sw는 변경하지 않는다.
- 상세 수정/실패 주입 검수: VERIFICATION_2026-09-05.md.
- 커밋 훅이 미연결된 상태를 발견해 이 repo의 core.hooksPath=.githooks로 연결했다. 저장소 밖 Downloads 금지는 유지하고 정식 downloads/DeliveryMaster-v숫자-debug.apk만 커밋 검사에서 허용한다.
