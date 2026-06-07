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
- 현재 기준 배포 버전은 **v14**다.
- 최신 커밋은 `650be6a Restore install source and fix helper zone totals`이다.
- live `sw.js`에서 `delivery-master-install-v14` 반영까지 확인됐다.

## 0-1. 핫픽스 채널 운영 목적

- 이 채널은 핸드폰 현장 접속 안정성을 위한 초경량 핫픽스 채널이다.
- 긴 기획, 회고, 구조 정리, 대규모 설계는 일반 작업창에서 처리한다.
- 이 채널은 `HOTFIX_HANDOFF.md` 기준으로 현재 버전, 작업 폴더, 금지 폴더, 최신 반영 상태만 빠르게 확인하고 움직인다.
- 현장 장애 시에는 `짧은 원인 확인 -> 최소 수정 -> 검사/빌드 -> 배포 확인 -> 현장 확인 요청` 순서로 진행한다.
- 대화량을 늘리는 긴 설명, 전체 로그 덤프, 반복 질문은 피한다.
- 새 핫픽스 결과는 이 문서에 짧게 갱신해 다음 핫픽스 창도 같은 기준으로 시작하게 한다.

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
- `current-source` 안의 구현 상태는 최신 v14 반영 여부를 판단하는 기준이 아니다.
- 최신 반영 여부는 이 repo의 `src`, `assets/app.js`, `sw.js`, git 커밋, live `sw.js` 기준으로 판단한다.
- 새 대화창에서는 `current-source`를 원본으로 삼지 않는다.
- 이 폴더는 이관 정리 전까지 남겨 두는 격리 참고자료이며, 배포 대상이 아니다.

## 3. v14에 실제 반영된 최신 수정

### 3-1. 기록 정정

목적:

- 업무 종료 후 대체배송/추가구역으로 잘못 완료한 기록을 도우미 배송으로 바꿀 수 있게 한다.
- 로그 화면은 보기 전용으로 유지하고 지저분하게 만들지 않는다.
- 수정 기능은 설정 화면의 별도 관리 섹션에서 처리한다.

v14 실제 배포 앱에 반영된 구현:

- `백업설정` 화면에 `기록 정정` 섹션 추가
- 완료 구역 목록 표시
- 완료 구역을 `도우미 배송 무료`로 전환
- 완료 구역을 `도우미 배송 유료`로 전환
- 전환 전 안전 스냅샷 다운로드 시도
- 전환 후 리포트/통계 재계산
- 로그 화면은 수정 버튼 없이 보기 전용 유지
- 로그에는 도우미 전환 결과만 자연어로 표시

### 3-2. 구역 순서 기준 수량 계산

v14 실제 배포 앱에 반영된 계산 원칙:

- 배송지 이름에 수식을 붙이지 않는다.
- 실제 작업 순서인 `1구역`, `2구역`, `3구역` 기준으로 수식을 붙인다.
- 1구역: 입력 수량 그대로 해당 구역 수량
- 2구역 이후: 사용자가 당일 전체 수량을 입력하면 이전 완료 수량을 자동 차감한다.
- 차감 대상에는 이전 구역 수량과 도우미 배송 무료/유료 수량이 포함된다.
- 미주가 2구역 이후로 밀려도 먼저 구역 순서 기준 수량을 계산한 뒤, 그 구역 수량 안에서 1/2/3동/나머지를 분해한다.
- 미주 이름에 붙는 특수 로직은 1동/2동/3동/나머지 계산뿐이다.

### 3-3. 도우미 배송 무료/유료

v14 실제 배포 앱에 반영된 계산 원칙:

- 도우미 배송 무료:
  - 총 배송 수량에는 포함
  - 효율 계산에서는 제외
- 도우미 배송 유료:
  - 총 배송 수량에 포함
  - 효율 계산에도 포함
- 도움 제공/무보수:
  - 수량/효율 제외
  - 시간 기록 중심

### 3-4. 검수 완료 항목

- `npm run check`: 48/48 통과
- `npm run build`: 통과
- `assets/app.js`, `assets/app.js.map`, `sw.js`가 `dist` 산출물과 해시 일치
- live `sw.js`: `const CACHE_NAME = "delivery-master-install-v14";` 확인

## 4. 오늘 확인된 필드 버그/요구사항

### 4-1. 구역 순서 기준 수량 계산

배송지 이름 기준이 아니라 실제 작업 순서 기준이어야 한다.

- 1구역: 입력 수량 그대로 해당 구역 수량
- 2구역 이후: 당일 전체 수량 입력 시 이전 완료 수량을 자동 차감
- 차감 대상에는 도우미 배송 무료/유료 수량도 포함
- 미주, 힐스테이트, 대체배송, 추가구역 이름과 무관하게 적용
- 상태: v14 반영 완료. 이후 필드 테스트에서 재검증한다.

### 4-2. 도우미 배송 타입

- 도우미 배송 무료:
  - 총 배송 수량에는 포함
  - 효율 계산에서는 제외
- 도우미 배송 유료:
  - 총 배송 수량에 포함
  - 효율 계산에도 포함
- 도움 제공/무보수:
  - 수량/효율 제외
  - 시간 기록 중심
- 상태: v14 반영 완료. 이후 필드 테스트에서 재검증한다.

### 4-3. 완료 후 수정

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
- 상태: 도우미 무료/유료 전환은 v14 반영 완료. 구역명/타입/수량/시간 일반 수정 확장은 후속 검토 대상이다.

## 5. 새 대화창에서 첫 번째로 할 일

1. 이 문서를 읽는다.
2. 아래 폴더를 실제 작업 폴더로 잡는다.

```text
C:\Codex55Workspace\delivery-master\delivery-master-install-deploy
```

3. 이 폴더의 `src` 원본과 빌드 설정을 확인한다.
4. 이전 원본 폴더 `C:\#WORKSPACE\AI_HUB\AI_WORKSPACE\PROJECTS\delivery-master-install`는 참고/비상 확인용일 뿐, 새 작업 기준으로 쓰지 않는다.
5. v14 이후 새 핫픽스는 이관된 `src`에 반영하고 빌드한다.
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
- v14에는 구역 순서 수량 계산, 도우미 배송 무료/유료, 백업설정 기록 정정이 이미 반영되어 있다.
- 목표는 v14 이후 새 필드 버그만 이 기준 위에서 핫픽스하는 것이다.
- 먼저 이 폴더의 src 원본과 빌드 설정이 존재하는지 확인해.
```

## 7. 현재 git 상태 요약

`delivery-master-install-deploy` 내부:

- v14 기준 커밋/푸시 완료
- 최신 커밋: `650be6a Restore install source and fix helper zone totals`
- 이전 원본 `src`/설정/문서 이관 완료
- `current-source/`는 `.gitignore`로 제외된 참고 스냅샷
- live `sw.js`의 캐시명 `delivery-master-install-v14` 확인 완료

상위 `delivery-master` 쪽:

- Season2 잘못 수정분은 복구 완료
- 루트 쪽에는 이전 작업 흔적과 테스트 산출물이 많이 남아 있으므로 커밋 범위 확인 필수

## 8. 말투/운영 규칙

- 오빠 승인 없이 경로 변경, 폴더 생성, 배포, 커밋, 삭제, 대체 경로 진행 금지.
- 작업 전에는 이해한 내용을 짧게 보고하고 승인받는다.
- 현장 장애는 핫픽스 우선이지만, 그래도 대상 폴더와 배포 경로는 먼저 확인한다.
- 보고는 짧고 정확하게 한다.
- 파일을 옮기거나 배포하기 전에는 반드시 대상과 제외 대상을 말한다.
