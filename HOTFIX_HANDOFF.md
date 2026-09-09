# v39 최종 수정본 인계 (USB 설치 완료 / GitHub 배포 진행)

- 현재 기준: VERIFICATION_v39.md. 최종 APK SHA256 1D63627005CBD477B47BDDF46CFAE4E5467D74784C5BFA0278A7B8EA0ADA9E09, versionCode12/0.2.38, 화면 v39.
- Fold7에 최종 APK USB 덮어 설치 성공. 설치 전후 SQLite 해시 동일, 기존152일 자료 보존. 실제 자료 시험 입력/초기화 없음.
- 이번 수정: 스크롤·IME 중복 여백·Back, 리포트 전면 표시, 잘못된 숫자 원문 보존, 저장 후 성공 알림, 실패 시 초안 보존, 출발/정정/구역 선택 등 버튼 간격.
- 최종 간격 검수: 버튼 도달378회/제어912회/입력168회와 키보드 모사16조건. 실제 삼성 숫자 키보드 공백 해소는 확인했으나 시스템 Back/시간 키보드/파일 왕복 전체 실기기 검수 완료는 아님.
- 사용자 배포·커밋·푸시 승인. 설치판 APK만 공개하며 PWA main/season2는 보관용 그대로 유지한다.
- 아래는 과거 단계별 이력이다. '설치 대기/미배포'는 당시 상태이며 현재 상태로 해석하지 않는다.

# v39 기본 재검수 인계 (이전 연결 대기 이력)

- 연결 통보 후 삼성 USB 인식은 확인, ADB 기기는0대. USB 디버깅 확인 대기이며 설치/실자료 접근은 하지 않았다.

- 최신 상태는 VERIFICATION_basics_2026-09-09.md. 기존 모든 미배포 수정에 오입력 원문 보존, 성공 알림 시점, 동별 초기화 실패 복구를 추가했다.
- 전체48+22묶음/키보드16조건/입력168회 및 Android 빌드/lint 통과. 실제 폰 검수는 아직 미실행.
- 설치 대기 v39/versionCode12, 공개판은 v38 유지. 사용자 폰 연결 후 덮어 설치·테스트 승인됨. 앱 삭제/실자료 초기화 금지, 시험 자료 격리.
- 커밋/푸시/공개/설치 없음. 아래 v38 검사용 APK 설명은 이전 이력이다.

# 공통 키보드 인계 (2026-09-09, 미배포)

- 모든 입력 시 큰 공백 보고. MainActivity와 Capacitor SystemBars의 IME 이중 여백 경로를 정리하고 Android CSS 추가 보정도 비활성화.
- 로컬 수정은 이전 스크롤/뒤로가기/리포트 수정 포함. 전체 자동 검사, 업무38+저장22묶음, 키보드 화면 모사16조건 통과.
- 최신 증거와 APK 해시: VERIFICATION_keyboard_2026-09-09.md. 실제 삼성 키보드 미검수이며 브라우저 모사 통과를 실기기 통과로 안내하지 않는다.
- 검사용 APK는 v38 번호 유지. 커밋/푸시/배포/설치 없음. 공개판에는 미반영이며 다음 배포 시 버전 갱신 필요.

> 2026-09-09: 현재 작업 기준은 `instruction.md`이다. 이 문서의 과거 승인·작업 절차·모델·배포 규정은 강제하지 않는다. 기능 및 작업 이력은 참고용으로 보존하며, 수정 대상은 Android 인스톨판뿐이다.

# 리포트 재설계 인계 (2026-09-09, 미배포)

- 현재 로컬 수정은 아래 스크롤/뒤로가기 및 새 리포트 화면을 포함한다. 공개/폰은 기존 v38, 커밋·푸시·새 배포 없음.
- 화면은 TypeScript 계산 파생 모델. 총수량/시간/효율, 업무 흐름, 구역 내역, A/B·도우미·이벤트를 페이지 전체로 표시. 복사 텍스트는 유지.
- 추가 결함 보완: 과거 A/restTotal만 있는 미주 기록도 총량 정정 시 B와 나머지가 동기화된다. 테스트 기대값100->120/A40/B80 확인.
- 최종 검수38+22 브라우저 묶음 및 전체 자동 검사, 검사용 APK 성공. 상세 VERIFICATION_report_2026-09-09.md.
- 검사용 APK는 아직 v38 번호이므로 배포용으로 전달하지 않는다. 다음 배포 때 버전 갱신 필수. Fold7 실기기 검수는 미연결로 남아 있다.

# 스크롤·뒤로가기 수정 인계 (2026-09-09, 미배포)

- 사용자 폰은 v38 설치 화면 확인됨. 현재 작업 소스는 공개 v38 이후 스크롤/뒤로가기 로컬 수정본이다. 커밋·푸시·새 배포는 하지 않았다.
- 하단88px 고정 공간을 실제 메뉴 높이로 연동. 키보드 크기/작은 편집창 대응. 저장 중 Back/Escape 취소 방지와 단계별 뒤로가기 적용.
- npm run check 및 브라우저34+22묶음 통과. 끝 스크롤60조합, 25구역, 글자150%, 반복 수정/저장 실패/중단 복구 포함.
- 검사용 APK 빌드·기존 서명·내장4파일 대조 완료. 아직 v38 번호의 로컬 빌드이므로 새 배포판으로 안내하지 않는다.
- 상세 VERIFICATION_navigation_2026-09-09.md. Fold7 미연결로 실제 키보드·OS Back·파일 왕복·업데이트 검수는 미실행이다. PWA와 폰 자료 노터치.

# v38 통계 확장 배포 완료 이력 (2026-09-09)

- 최신 수정은 통계 확장이다. 소스/APK/태그 4e6c352. 커밋·푸시·v38 공개 및 비로그인 다운로드 해시 확인 완료. `VERIFICATION_v38.md` 참조.
- 다운로드 전달 페이지: https://github.com/owenyu9292/delivery-master-install/releases/tag/v38 . Assets의 DeliveryMaster-v38-debug.apk를 기존 앱 삭제 없이 업데이트 설치한다.
- 이후 사용자 v38 설치 화면 확인. 네이티브 파일 왕복은 별도이며, 통계는 원본을 저장하거나 변경하지 않는다.
- 주요 변경: 비율 우선, 같은 경과 기간 비교, 6기간 추이, 시간 구성, 물량/요일/구역/도우미/A·B/시각/스캔/품질 분석.
- 전체 자동 검사와 숨김 브라우저26+22묶음, 통계15묶음+600변형, 401일 원본 불변 및 411/360·150% 글씨 검수 통과. 별도 최종 통계 재검수 완료.
- v38 APK 25,447,490바이트, SHA256 310079BB8721BAED0BF84C39A4F97599BB0968AA87F241A7027CBA17D2C9251E. Android versionCode11/0.2.37, 기존 서명 유지. PWA는 계속 보관용이다.

# v37 배포 작업 (2026-09-09)

- 대상: 이 repo의 Android 인스톨판 src/public/android. 브랜치 codex/hils-handling-minutes. PWA main/season2 수정 금지.
- v37 소스/APK/태그 a059908, 커밋·푸시·GitHub 공개·비로그인 다운로드 해시 확인 완료. 증거는 VERIFICATION_v37.md.
- 전달 페이지: https://github.com/owenyu9292/delivery-master-install/releases/tag/v37 (직접 APK 링크 대신 이 페이지 전달).
- 최신 5건: (1) 힐스40분 경과 시 정리30분·배송 시작·업무 화면 자동 전환 (2) 정리완료/배송시작 양방향 및 동일 업무 경계 연동 (3) 수동 우선·자정 날짜·반복 수정 ID/저장 보호 (4) 도우미 전환 원본 보관·시간/상세 원복·총수량 누락 수정, 구형 시간 없는 기록은 효율 미확정 (5) 23개 업무/시간/도우미/통계+22개 저장 브라우저 묶음 및2684조합/도우미11묶음 검수.
- 자동 정리는 현재 단일 진행 힐스에만 적용하며 닫힌 과거 자료/직접 기록/편집 중에는 덮지 않는다. 실제 수량·배송 완료 시각을 자동 변경하지 않는다. 실제 다른 이동·대기 간격도 유지한다.
- 아래 v36 이하 내용은 당시 기록이다. Fold7 실기기 이번 APK 설치·복귀·파일 왕복은 미연결로 확인 전이다.

# v36 과거 작업 (2026-09-09)

- 수정 대상은 Android 인스톨판뿐이며 PWA main/season2는 보관한다.
- 실제 소스: 이 repo의 src/public/android. 브랜치 codex/hils-handling-minutes.
- v36 GitHub APK 공개 및 비로그인 다운로드 해시 확인 완료. 소스/APK/태그 e59c2d2. 전체 증거는 VERIFICATION_v36.md. 폰 설치는 미연결로 하지 않았다.
- 다운로드 전달은 GitHub Release 페이지: https://github.com/owenyu9292/delivery-master-install/releases/tag/v36
- 최신5건: (1) 하단 아이콘/탁색 블루 업무 UI (2) 한 곳에서 무제한 예정 추가·전환·삭제 (3) 방문ID 보존, 구역 순서 누적 차감, 미주 A/B 독립 (4) 저장 실패 복구·이중 누름·재수정·미방문 보고서 제외 (5) 시스템 폰트/배율 적용 및 APK 동일 서명. 실제 유료 폰트/폰 설치는 미확인.
- 아래 v35 이하 내용은 당시 기록이다. 이번 앱 반영 여부는 위 절과 v36 검수 문서가 현재 상태다.

# 작업 기준 갱신 이력 (2026-09-09)

- 기존 프로젝트 강제 절차는 해제했다. instruction.md 기준으로 Android 인스톨판만 수정하고 그 외 진행 방식은 코기가 판단한다.
- 규칙 해제 커밋 당시에는 문서·작업 훅만 변경했다. 이후 v36에서 실제 디자인·폰트·구역 조작 구현 및 APK 작업을 진행했다.

# 과거 v35 앱 인수인계 (2026-09-05 기준)

- 유일한 수정 대상: Android 인스톨 버전. 기존 개발앱 PWA 게시본 및 v1/season2는 원본 보관이며 수정·배포하지 않는다.
- repo: C:\Codex55Workspace\delivery-master\delivery-master-install-deploy / 브랜치 codex/hils-handling-minutes / v35 소스·APK 커밋 541eaf0.
- 현재 상태: v35 GitHub Release 배포 완료. Android versionCode8/versionName0.2.34. 실제 폰은 마지막 사용자 확인 v34이며 이번에는 미연결로 설치하지 않았다.
- 검수 증거 및 다음 관문: VERIFICATION_2026-09-05.md. npm run check, 실제 SQLite 파일 재개방/실패6종, 최종 숨김 브라우저22개 묶음, 기존 smoke 및 대체배송10개 경로 통과. Android 플러그인·실제 Fold7 설치 검수는 별도다.
- 공유 보드: todo.md/progress.md/unresolved.md/changelog.md. 핫픽스는 별도 칸반을 만들지 않고 기록자 hotfix로 남긴다. 커밋·푸시·패키징·공개 다운로드 해시 검증 완료, 폰 설치만 미실행.
- 배포: https://github.com/owenyu9292/delivery-master-install/releases/tag/v35 → Assets의 DeliveryMaster-v35-debug.apk. 직접 APK 링크 대신 이 페이지를 전달한다. 상세 증거: VERIFICATION_v35.md.
- 아래 v34 이하 절은 당시 작업 기록이다. 과거 미배포/USB/PWA 운영 문구보다 이 절과 OPERATING_RULES.md가 우선한다.

## 최신 5건 요약

1. 힐스 반품·선집화·상차: 기본 제안30분, 직접0~999분. 기존 정리에 추가 차감, 전체경과/수량 유지. 구역별1건 갱신·취소0·로그 재수정.
2. 저장/복구: 내부 구조 검증, 다중 날짜 전체취소, 실패 뒤 입력/원본 보존. 손상 기록 초기화 금지, raw 원문 보관·유효한 백업으로 선택 복구. 후속 스냅샷 실패는 실제 반영 건수와 구분.
3. 계산/정정: 무료 도우미 효율 제외, 미주 총량 정정 B 재계산, 누락 정리 완료와 자동 배송시작 연결, 시간 불명확 시 효율 미확정. 통계 가중 효율·대체배송 제외 정규 효율 수정.
4. 현장 UI: 남은 구역 순서 변경, 자정 이전업무/오늘 선택, 종료 로그 시간 수정, 미저장 초안 복원, 같은 분 로그 업무 순서, 연필48px, 주/월 가로 이동과 비율 우선.
5. 검수/인계: 별도 Chrome 프로필·411x762 DPR2.63/360폭·임시 DB 검수 통과. v35 APK 공개 다운로드와 SHA-256 일치 확인. 기존 PWA·폰 자료는 미변경. 다음은 전체 백업→기존 앱 삭제 없이 업데이트→Fold7 SQLite/파일 왕복 확인이다.

# v34 과거 작업 기록 (2026-08-23)

- 대상은 'delivery-master-install-deploy' Android 설치판 원본이며 PWA/season2는 건드리지 않는다.
- 현장에서 정리 시작 후 정리 완료를 빠뜨린 경우, 로그의 정리 완료 누락 항목에서 실제 완료 시각을 추가한다.
- 로그 연필 수정은 현장 정정 모드다. 이전/다음 이벤트와 시간 순서가 어긋나도 저장하고 adjustments에 시간축 경고를 남긴다.
- 로그 완료 수량은 0개와 5자리까지 직접 입력한다. 빈 수량만 저장하지 않는다.
- 일반 업무 입력과 백업설정의 정식 완료 수정은 기존 시간축 검증을 유지한다.
- 임시 Chrome 411x762 / DPR 2.63과 CDP 현장 정정 시나리오는 통과했다. 현재 버전은 Fold7 실기기 검수 전이며, APK 배포 완료로 보지 않는다.
- v34 APK 빌드 완료: downloads/DeliveryMaster-v34-debug.apk · SHA-256 497AAFB83D3412943E4C0A4D2030D4473DB9C6AE3BC2A7A3120A837889959B23

# v33 현재 운영 기준 (2026-07-15)

- 정식앱: Android 인스톨판. PWA/season2는 수정 금지 원본 보관.
- 현재: 앱 0.2.32-android-install, cache v33, Android versionCode 6.
- 추가구역 오입력: 시작 로그만 있으면 잘못 추가함 · 취소로 내부 스냅샷 후 복귀한다.
- 정리·배송·수량·이벤트·도우미 기록이 생기면 단순 취소하지 않고 기록 정정을 사용한다.
- 필수 검수: 종료 직전 오입력, 중간 취소·재추가, 반복 대체배송, 후속 기록별 취소 차단.
- APK: downloads/DeliveryMaster-v33-debug.apk.
- SHA256: 2A7AD1533E204D8D37FE26A965F1BA6F36FD37ABC8E6F5D3FEEA3E6FD0DF858B.
- 배포 페이지: https://github.com/owenyu9292/delivery-master-install/releases/tag/v33

# v32 현재 운영 기준 (2026-07-14)

- 정식앱: Android 인스톨판. PWA/season2는 수정 금지 원본 보관.
- 현재: 앱 `0.2.31-android-install`, cache `v32`, Android versionCode `5`.
- APK: `downloads/DeliveryMaster-v32-debug.apk`.
- Android 백업 내보내기는 공유가 아니라 시스템 파일 저장창이다.
- Android 백업 가져오기는 시스템 문서 선택창이며 앱 목록이 뜨면 정상 동작이 아니다.
- 기존 날짜 충돌: 확인은 덮어쓰기, 취소는 기존 날짜 유지+없는 날짜만 가져오기다. 신규 `__copy_` 날짜를 만들지 않는다.
- 자동 내부 스냅샷은 최신 5개만 순환 보관한다.
- 실기기에서 내보내기 저장창과 가져오기 문서 선택창 동작을 확인했다.
- 같은 백업을 다시 가져와 `0일`로 표시된 것은 기존 날짜 보존 모드에서 전부 건너뛴 정상 결과다.
- APK 전달은 직접 다운로드/raw 링크를 쓰지 않고 https://github.com/owenyu9292/delivery-master-install/releases/tag/v32 Release 페이지를 안내한다.

# v31 현재 운영 기준 (2026-07-13)

> **고정 규칙:** `OPERATING_RULES.md`가 이 문서의 과거 PWA·USB·GitHub Pages 기록보다 우선한다.

- 정식 대상: Android 인스톨 앱. PWA v1과 `season2`는 보관용이며 수정하지 않는다.
- 하위 작업: 범위가 분리되는 작업은 루나를 우선 사용하고, 코기가 병합·검수·커밋·GitHub 업로드를 책임진다.
- 배포: 정식 앱 업데이트는 GitHub APK 다운로드·업데이트 설치만 사용한다. USB/ADB는 실기기 검수용이다.
- 현재: 앱 `0.2.30-android-install`, cache `v31`, Android versionCode `4`.
- 시간 수정: 공통 시간축 검사로 저장 전에 차단한다. 바로 배송 시작은 구역 시작 후 2분을 넘겨 수정할 수 없다.
- 자동 안전 스냅샷: 앱 내부 저장만 사용한다. 사용자가 백업 내보내기를 누를 때만 Android 공유창을 연다.
- 다운로드 APK: `downloads/DeliveryMaster-v31-debug.apk` (debug 서명, 기존 앱 삭제 없이 업데이트).
- GitHub 배포 후 실기기 v31 시간 수정 재확인이 남아 있다.

# v30 현재 운영 기준 (2026-07-13)

이 절은 아래 과거 기록보다 우선한다.

- 시간 수정/완료 기록 수정의 자동 안전 스냅샷은 앱 내부에만 저장한다. Android 공유창은 절대 열지 않는다.
- `백업 내보내기`처럼 사용자가 명시한 경우에만 JSON 외부 공유/앱 선택 창을 연다.
- 현 버전: 앱 `0.2.29-android-install`, cache `v30`, Android versionCode `3`.

# v29 현재 운영 기준 (2026-07-13)

이 절은 아래 과거 기록보다 우선한다.

- 정식 제품 소스는 `delivery-master-install-deploy`의 Android/SQLite 설치판이다. PWA v1과 `season2`는 보관용이며 수정 금지다.
- 현장 긴급 대응이 필요하면 PWA를 임시 사용·최소 수정할 수 있으나, 업무 후 같은 수정은 반드시 인스톨판 소스에 정식 반영한다.
- 현 버전: 앱 `0.2.28-android-install`, cache `v29`, Android versionCode `2`.
- v29 핵심: Android 안전영역 보정, 전 구역 배송 시작 누락 자동 보정, 완료기록/로그 연필에서 배송 시작 복구.
- 배송 시작 누락 보정 규칙: 정리 완료 시각 우선 -> 이전 구역 종료+5분 -> 첫 구역은 구역 시작/청량리 도착. 자동 보정은 로그에 이유와 함께 표시한다.
- 현재 APK는 기존 v28 데이터 보존을 위해 같은 package ID와 debug 서명을 사용한다. GitHub Release의 테스트 APK도 동일 서명 업데이트용이다.
- 최신 상태: 코드 검사/빌드 완료, Fold7 USB 재연결 후 안전영역 실기기 확인 대기.


# 2026-07-12 현재 운영 기준: 현장앱 PWA와 인스톨판 분리

이 절은 아래의 과거 v25/v26 문구보다 우선한다.

- 현장앱은 현장에서 즉시 사용하는 PWA다. 업무 중 막히는 오류는 현장앱을 먼저 최소 수정·배포·폰 확인한다.
- 인스톨판은 Android/SQLite 정식 개발판이다. 현장앱 핫픽스는 퇴근 후 인스톨판에 구조적으로 다시 반영하고, 전체 검사·Android 빌드·실기기 검수·문서·Git 커밋까지 끝내야 완료다.
- PWA v1과 season2는 보관/참고/복구용 구버전이다. 신규 수정·배포·핫픽스 대상이 아니다.
- 현장앱 PWA 핫픽스는 `src` 원본에서 수정하고 빌드 산출물을 PWA 배포 경로에 반영한다. `assets/app.js` 직접 수정은 금지한다.
- 인스톨판 Android 패키지 ID는 `io.github.owenyu9292.deliverymaster`다. 현재 Android 작업 브랜치는 `codex/android-install-foundation`이다.

## 현장 핫픽스 절차

1. 현장앱 PWA에서 업무 진행을 막는 증상만 최소 범위로 수정한다.
2. PWA 빌드·배포·폰 실사용 확인을 먼저 한다.
3. 수정 파일·증상·현장 확인 결과·인스톨판 반영 필요 여부를 이 문서의 최신 5개 기록에 남긴다.
4. 퇴근 후 일반 작업창에서 인스톨판에 정식 반영하고, `npm run check`, Android APK 빌드, 실기기 확인, 문서, 커밋을 진행한다.

## 이번 인스톨판 확인 상태

- Android SQLite 설치판에 개발앱 백업 102일 이관 성공.
- 가져오기 전후 안전 스냅샷은 앱 내부 저장으로 변경했다. 공유 취소는 더 이상 이관을 중단시키면 안 된다.
- 이관 뒤에는 과거 첫 날짜가 아니라 오늘의 빈 업무 시작 화면으로 복귀한다.
- 앱 상단은 `배송마스터 v28`, Android 뒤로가기는 앱 종료, 런처 아이콘은 택배 트럭이다.
- 이 항목의 정식 Git 기록은 이번 마무리 커밋에서 고정한다.

---
# 배송마스터 개발앱 핫픽스 대화창 인수인계

이 문서는 새 Codex 대화창에서 바로 이어가기 위한 한방 문서다.
새 대화창 첫 메시지에 이 파일 경로를 먼저 알려주고, 아래 기준을 그대로 적용한다.

```text
C:\Codex55Workspace\delivery-master\delivery-master-install-deploy\HOTFIX_HANDOFF.md
```

## 0. 최우선 주의

- 현재 핫픽스 대상은 **개발 인스톨 앱**이다.
- Season2 PWA는 보관/원본 백업 앱이며, 현재 핫픽스 대상이 아니다.
- `C:\Codex55Workspace\delivery-master\season2`는 건드리지 않는다.
- `SEASON2_SAFETY_PLAN.md`, `season2/README.md`는 잘못 수정됐다가 복구 완료된 상태다.
- 현재 기준 배포 버전은 **v25**이다.
- live `sw.js`에서 `delivery-master-install-v25` 반영 여부를 먼저 확인한다.
- v26 `repeat-alt-zones`는 로컬 수정/검수 대상이며, 사용자 업무 종료 전 푸시/배포하지 않는다.

## 0-1. 핫픽스 채널 운영 목적

- 이 채널은 핸드폰 현장 접속 안정성을 위한 초경량 핫픽스 채널이다.
- 긴 기획, 회고, 구조 정리, 대규모 설계는 일반 작업창에서 처리한다.
- 이 채널은 `HOTFIX_HANDOFF.md` 기준으로 현재 버전, 작업 폴더, 금지 폴더, 최신 반영 상태만 빠르게 확인하고 움직인다.
- 현장 장애 시에는 `짧은 원인 확인 -> 최소 수정 -> 검사/빌드 -> 배포 확인 -> 현장 확인 요청` 순서로 진행한다.
- 사용자가 이 채널에서 현장 긴급 수정이라고 요청하면 현장에서 막힌 부분을 임시로 틀어막는 최소 수정, 검사, 빌드, 배포까지 전량 승인된 것으로 간주하고 즉시 처리한다.
- 핫픽스는 정식 설계 완료가 아니다. 막은 내용과 남은 정식 수정 항목을 이 문서에 짧게 남기고, 퇴근 후 일반 작업창에서 정식 수정한다.
- 대화량을 늘리는 긴 설명, 전체 로그 덤프, 반복 질문은 피한다.
- 새 핫픽스 결과는 이 문서에 짧게 갱신해 다음 핫픽스 창도 같은 기준으로 시작하게 한다.
- 최신 업데이트 기록은 최대 5개만 유지한다.
- 6개째 업데이트를 추가할 때는 가장 오래된 업데이트 항목을 삭제하고 최신 5개만 남긴다.
- 핫픽스 채널은 가벼워야 하므로 오래된 회고, 긴 로그, 세부 검수 출력은 `progress.md`와 `changelog.md`에 남긴다.
- 핫픽스 채널용 별도 칸반은 만들지 않는다.
- 핫픽스 채널과 일반 작업창은 같은 작업 보드(`todo.md`, `progress.md`, `unresolved.md`, `changelog.md`)를 사용한다.
- 작업 보드에는 기록자/채널을 남긴다. 예: `기록자: 핫픽스 채널`, `채널: hotfix`.
- 핫픽스 채널은 이 문서에 최신 5개 요약만 유지하고, 실제 할 일/진행/완료/보류 관리는 같은 작업 보드에 기록한다.

## 0-2. 최근 핫픽스 업데이트: 최신 5개만 유지

1. 2026-09-05 `hils-handling-minutes` (로컬 완료, 미배포)
   - 인스톨판 힐스 별도 소요분 기본30/직접입력, 기록 갱신·취소0·로그 재수정.
   - 정리 시간에 추가 차감, 전체경과/수량 유지. 순서가 바뀌거나 다른 힐스ID여도 구역별 한 건.
   - 공유 보드에 결과/잔여 기록. APK 배포는 아직 하지 않았다.
2. v26 `repeat-alt-zones` (과거 기록)
   - 첫 구역이 대체배송이고 하루 안에 대체배송을 여러 번 뛰는 케이스 대응.
   - 다음 기본 구역 시작 전 `대체배송 계속 추가`를 현장 주동선으로 노출.
   - 추가한 대체배송은 현재 다음 구역 앞에 끼워 넣고 바로 시작.
   - 검수 추가: `대체배송 1 -> 대체배송 2 -> 대체배송 3 -> 미주`.
   - 가혹 검수 추가: `대체배송/미주/힐스/대체배송/대체배송` 순서 조합 3개 통과.
   - 사용자 업무 종료 전 푸시/배포 금지.
3. v25 `cache-refresh`
   - 폰에서 v24 배포 후에도 상단 표시가 v23에 머무는 서비스워커 캐시 문제 대응.
   - 서비스워커 fetch를 캐시 우선에서 네트워크 우선 + 실패 시 캐시로 변경.
   - 앱/캐시: `0.2.24-cache-refresh`, `delivery-master-install-v25`.
   - 검수: `npm run check`, `npm run build`, dist/루트 게시 파일 해시 일치.
4. v24 `alt-zone-priority`
   - v23에서 `대체배송 먼저 추가`를 눌러도 미주 화면에 머물던 문제 수정.
   - 이미 생성된 진행 중 대체배송은 기본 구역보다 우선 표시.
   - 새 대체배송은 다음 미시작 구역 앞에 확실히 삽입.
   - 앱/캐시: `0.2.23-alt-zone-priority`, `delivery-master-install-v24`.
   - 검수: `npm run check`, `npm run build`, dist/루트 게시 파일 해시 일치.
5. v23 `multiple-alt-zones`
   - 첫 구역을 대체배송으로 시작해 완료한 뒤에도 다음 기본 구역 시작 전 `대체배송 먼저 추가`를 눌러 추가 대체배송을 이어서 진행 가능.
   - 진행 중 추가한 대체배송은 현재 미시작 구역 앞에 삽입하고 즉시 시작한다.
   - 앱/캐시: `0.2.22-multiple-alt-zones`, `delivery-master-install-v23`.
   - 검수: `npm run check`, `npm run build`, dist/루트 게시 파일 해시 일치.

## 1. 현재 실제 배포 앱 위치

실제 GitHub Pages 배포 repo이자 앞으로의 단일 원본 작업 폴더는 아래다.

```text
C:\Codex55Workspace\delivery-master\delivery-master-install-deploy
```

현재 게시 파일:

```text
index.html
styles.css
sw.js
manifest.webmanifest
assets\app.js
assets\app.js.map
```

중요:

- 실제 앱은 `index.html`에서 `assets/app.js`를 불러온다.
- 이전 원본은 `C:\#WORKSPACE\AI_HUB\AI_WORKSPACE\PROJECTS\delivery-master-install`에 있었다.
- 이전 원본의 `src`, 설정, 문서를 이 repo로 이관해 이 폴더를 source-of-truth로 고정한다.
- 핫픽스는 `assets/app.js` 직접 수정이 아니라 이관된 `src` 원본에 반영하고 빌드한다.
- `current-source`를 그대로 배포하면 다른 앱 구조가 올라갈 수 있다.
- 빌드 후에는 `dist` 산출물을 루트 게시 파일(`assets/app.js`, `assets/app.js.map`, `sw.js` 등)에 반영해야 실제 핸드폰 앱이 바뀐다.

## 2. current-source의 역할

아래 폴더는 섞여 있던 루트 PWA 파일과 문서를 분리해 둔 참고 스냅샷이다.

```text
C:\Codex55Workspace\delivery-master\delivery-master-install-deploy\current-source
```

여기에는 다음이 들어 있다.

```text
current-source\index.html
current-source\css\
current-source\js\
current-source\sw.js
current-source\manifest.json
current-source\docs\install-app\
current-source\docs\hotfixes\
```

주의:

- `current-source`는 현재 실제 배포 루트가 아니다.
- `current-source` 안의 구현 상태는 최신 반영 여부를 판단하는 기준이 아니다.
- 최신 반영 여부는 이 repo의 `src`, `assets/app.js`, `sw.js`, git 커밋, live `sw.js` 기준으로 판단한다.
- 새 대화창에서는 `current-source`를 원본으로 삼지 않는다.
- 이 폴더는 이관 정리 전까지 남겨 두는 격리 참고자료이며, 배포 대상이 아니다.

## 3. 현재 v19 기준 핵심 기능

### 3-1. 구역 순서 기준 수량 계산

배송지 이름 기준이 아니라 실제 작업 순서 기준이어야 한다.

- 1구역: 입력 수량 그대로 해당 구역 수량
- 2구역 이후: 당일 전체 수량 입력 시 이전 완료 수량을 자동 차감
- 차감 대상에는 도우미 배송 무료/유료 수량도 포함
- 미주, 힐스테이트, 대체배송, 추가구역 이름과 무관하게 적용
- 미주 이름에 붙는 특수 로직은 1동/2동/3동/나머지 상세 계산뿐이다.
- 상태: v19 기준 반영 완료. 이후 필드 테스트에서 재검증한다.

### 3-2. 도우미 배송 타입

- 도우미 배송 무료:
  - 총 배송 수량에는 포함
  - 효율 계산에서는 제외
- 도우미 배송 유료:
  - 총 배송 수량에 포함
  - 효율 계산에도 포함
- 도움 제공/무보수:
  - 수량/효율 제외
  - 시간 기록 중심
- 구역 위치에서 기록한 무료/유료 도우미:
  - 해당 구역 총량 안의 동행/기여 기록
  - 수량을 입력해도 총 배송 수량과 효율 분자에 다시 더하지 않음
  - 수량을 비워도 구역 동행으로 저장 가능
- 상태: v20 기준 반영 완료. 이후 필드 테스트에서 재검증한다.

### 3-3. 기록 정정

완료 후에는 로그/리포트만 보이므로 별도 정정 화면이 필요하다.

권장 위치:

- 로그 화면: 보기 전용 유지
- 설정/백업설정 화면: `기록 정정` 관리 섹션

필요 기능:

- 날짜 선택
- 완료 구역 목록 불러오기
- 구역명/타입/수량/시간 수정
- 대체배송/추가구역 -> 도우미 무료/유료 전환
- 수정 전 자동 스냅샷
- 수정 후 리포트/통계 재계산
- 과거 날짜 기록 정정
- 누락 도우미 배송 추가
- 상태: v19 기준 반영 완료. 완료 구역의 구역명/타입/수량/시간 일반 수정과 도우미 무료/유료 전환/재수정/구역 복구를 반복 수정할 수 있고, 지난 날짜 기록도 불러와 수정할 수 있다.

### 3-4. 개발앱 백업 복구

- 백업설정에 `개발앱 백업 복구`가 있다.
- 코기가 정상화한 개발앱 백업 JSON을 기존 날짜에 덮어쓸 수 있다.
- 기존 날짜가 있으면 `확인=덮어쓰기`, `취소=복사본`이다.
- 복구 전후 전체 백업 파일을 자동 내보내기한다.
- `현장앱 백업 가져오기`는 기존 날짜 보호/복사본 정책을 유지한다.

### 3-5. 검수 기준

- `npm run check`
- `npm run build`
- 브라우저 스모크 검수 411x762 / DPR 2.63
- 긴급 수정 후 live `sw.js`의 `delivery-master-install-v21` 또는 새 배포 버전 확인

## 5. 새 대화창에서 첫 번째로 할 일

1. 이 문서를 읽는다.
2. 아래 폴더를 실제 작업 폴더로 잡는다.

```text
C:\Codex55Workspace\delivery-master\delivery-master-install-deploy
```

3. 이 폴더의 `src` 원본과 빌드 설정을 확인한다.
4. 이전 원본 폴더 `C:\#WORKSPACE\AI_HUB\AI_WORKSPACE\PROJECTS\delivery-master-install`는 참고/비상 확인용일 뿐, 새 작업 기준으로 쓰지 않는다.
5. 새 핫픽스는 이관된 `src`에 반영하고 빌드한다.
6. 빌드 결과를 루트 게시 파일에 반영하기 전 결과를 보고한다.
7. 절대 `current-source`를 실제 배포 앱으로 덮어쓰지 않는다.

## 6. 새 대화창 첫 메시지 추천

```text
C:\Codex55Workspace\delivery-master\delivery-master-install-deploy\HOTFIX_HANDOFF.md 먼저 읽고 이어서 하자.

핵심:
- 실제 작업/배포 기준은 delivery-master-install-deploy 하나로 고정한다.
- 이전 원본 폴더의 src는 이 폴더로 이관된 기준으로 작업한다.
- current-source는 참고 스냅샷이지 원본이나 배포 대상이 아니다.
- Season2는 보관용 원본이라 건드리지 않는다.
- v21에는 위험 수량 복구 패널, 구역 순서 수량 계산, 구역 동행 도우미 중복 합산 방지, 도우미 배송 무료/유료, 백업설정 선택형 반복 기록 정정, 지난 날짜 기록 정정, 개발앱 백업 복구가 이미 반영되어 있다.
- 목표는 v21 이후 새 필드 버그만 이 기준 위에서 핫픽스하는 것이다.
- 먼저 이 폴더의 src 원본과 빌드 설정이 존재하는지 확인해.
```

## 7. 현재 git 상태 요약

`delivery-master-install-deploy` 내부:

- v21 기준 커밋/푸시 완료 여부는 `git log -1 --oneline`과 live `sw.js`로 확인한다.
- 이전 원본 `src`/설정/문서 이관 완료
- `current-source/`는 `.gitignore`로 제외된 참고 스냅샷
- live `sw.js`의 캐시명 `delivery-master-install-v21` 확인 필요

상위 `delivery-master` 쪽:

- Season2 잘못 수정분은 복구 완료
- 루트 쪽에는 이전 작업 흔적과 테스트 산출물이 많이 남아 있으므로 커밋 범위 확인 필수

## 8. 말투/운영 규칙

- 오빠 승인 없이 경로 변경, 폴더 생성, 배포, 커밋, 삭제, 대체 경로 진행 금지.
- 작업 전에는 이해한 내용을 짧게 보고하고 승인받는다.
- 현장 긴급 수정 요청은 임시 차단/복구용 최소 수정, 검사, 빌드, 배포 전량 승인으로 본다. 승인 질문으로 멈추지 말고 대상 폴더와 배포 경로만 빠르게 확인한 뒤 진행한다.
- 핫픽스 채널에서 막은 내용은 반드시 이 문서에 남기고, 정식 수정은 일반 작업창으로 넘긴다.
- 단, 데이터 삭제, 초기화, 기록 덮어쓰기, 기존 현장앱 v1/season2 수정은 별도 확인 없이는 하지 않는다.
- 보고는 짧고 정확하게 한다.
- 파일을 옮기거나 배포하기 전에는 반드시 대상과 제외 대상을 말한다.

## Latest 2026-07-04 v22 log direct edit

- Source of truth: `C:\Codex55Workspace\delivery-master\delivery-master-install-deploy`.
- App/cache: `0.2.21-log-direct-edit`, `delivery-master-install-v22`.
- Main change: log tab entries now have pencil edit buttons. Edit opens a focused panel for that event only.
- Time edit rule: use direct hour/minute numeric inputs, not native analog/time picker.
- Data rule: edit writes back to `DayRecord.timeline`; reports/statistics/log output remain derived.
- Safety: save creates `log-edit-before` snapshot and uses timeline/zone time validation.
- Browser smoke must include: `logEditButtonShown`, `logEditDigitalOnly`, `logDirectEditSaved`.
- Hotfix channel rule: emergency hotfix may patch the immediate blocker, but durable fix and docs must be reconciled here after field work.

## Hotfix validation note 2026-07-04

- Browser validation must use background/headless Chrome when possible.
- Do not open visible browser windows during field work unless explicitly approved.
- v22 smoke passed with log direct edit checks: button visible, digital-only time fields, save reflected in log data.

## v27 캐시 강제 갱신 핫픽스
- 증상: 푸시 후 휴대폰 PWA가 v26으로 올라오지 않고 앱 내 새로고침 버튼도 갱신하지 못함.
- 조치: 새로고침 버튼을 hard refresh로 변경. 서비스워커 unregister, Cache Storage 삭제, app-refresh 쿼리로 재진입.
- 추가: serviceWorker.register updateViaCache none, registration.update 호출. public/sw.js/SW 템플릿에 SKIP_WAITING 메시지 핸들러 추가.
- 검증: npm run check, npm run build, browser-smoke, browser-alt-stress 통과.

