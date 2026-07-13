# delivery-master-install

> **현재 효력 규칙:** `OPERATING_RULES.md`가 이 문서의 과거 PWA·GitHub Pages 설명보다 우선합니다. 정식 제품은 Android 인스톨 앱이며, 일반 배포는 GitHub APK 다운로드·업데이트 설치만 사용합니다.

## 00. Operating Rule: Report Before Action

All coding, file creation, folder creation, document updates, GitHub upload, commit, push, deployment, and fallback-path decisions must be reported to the user first and executed only after approval.

- Do not create substitute folders or alternate paths when the intended path is missing.
- If a folder, repository, or permission is missing, stop and ask the user to create or approve it.
- Keep this rule above normal status notes so it is read before implementation details.

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
