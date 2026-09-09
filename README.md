> 2026-09-09: 현재 작업 기준은 `instruction.md`이다. 이 문서의 과거 승인·작업 절차·모델·배포 규정은 강제하지 않는다. 기능 및 작업 이력은 참고용으로 보존하며, 수정 대상은 Android 인스톨판뿐이다.

# delivery-master-install

v39 최종 수정본의 폰 USB 설치와 기존 자료 보존을 확인했습니다. GitHub APK 공개 작업 중이며 [VERIFICATION_v39.md](VERIFICATION_v39.md)에 결과를 기록합니다. 상세 검수 범위는 [버튼 간격 검수](VERIFICATION_spacing_2026-09-09.md)와 [기본 검수](VERIFICATION_basics_2026-09-09.md)를 확인합니다. PWA 원본은 변경하지 않습니다.

## Current Folder Role

This folder is the Android install app source-of-truth and GitHub APK distribution repository for the Delivery Master app line inside:

`C:\Codex55Workspace\delivery-master\delivery-master-install-deploy`

The previous source folder was:

`C:\#WORKSPACE\AI_HUB\AI_WORKSPACE\PROJECTS\delivery-master-install`

That previous folder is only the migration source. Future coding work must happen in this repository after the source files are migrated here.

## Source And Build Layout

Expected source files in this repository:

- `src/`
- `scripts/`
- `test/`
- `public/`
- `package.json`
- `tsconfig.json`
- project rule and tracking markdown files

Legacy web/PWA publish files (not the formal app update target):

- `index.html`
- `styles.css`
- `sw.js`
- `manifest.webmanifest`
- `assets/app.js`
- `assets/app.js.map`

Build output is generated from the source and then reflected into the publish files.

## Quarantined Snapshot

`current-source/`

`current-source/` is not the real source and is not a deploy target. It is a quarantined snapshot copied from an older mixed workspace while the folder structure was being untangled.

It may contain older PWA files:

- `current-source/index.html`
- `current-source/css/`
- `current-source/js/`
- `current-source/sw.js`
- `current-source/manifest.json`
- `current-source/docs/install-app/`

Do not copy `current-source/` over the publish root.

The old Season2 PWA folder is not part of this install app source and must not be touched unless the user explicitly requests it.

## Android Install Direction

- The Android install app source in this repository is the formal source-of-truth.
- Android installation builds use the domain, UI, and app source in this repository.
- Capacitor 8 and a SQLite-backed `DayStore` are implemented behind runtime platform selection.
- PWA IndexedDB data moves through one verified full-backup import and is not assumed to transfer automatically.
- The Android project and APK use package ID `io.github.owenyu9292.deliverymaster`; formal updates are published through GitHub APK download/install.
