# delivery-master-install

## 00. Operating Rule: Report Before Action

All coding, file creation, folder creation, document updates, GitHub upload, commit, push, deployment, and fallback-path decisions must be reported to the user first and executed only after approval.

- Do not create substitute folders or alternate paths when the intended path is missing.
- If a folder, repository, or permission is missing, stop and ask the user to create or approve it.
- Keep this rule above normal status notes so it is read before implementation details.

## Current Folder Role

This folder is the single source-of-truth and GitHub Pages deploy repository for the Delivery Master install/development app line inside:

`C:\Codex55Workspace\delivery-master\delivery-master-install-deploy`

The previous source folder was:

`C:\#WORKSPACE\AI_HUB\AI_WORKSPACE\PROJECTS\delivery-master-install`

That previous folder is only the migration source. Future coding work must happen in this repository after the source files are migrated here.

## Source And Deploy Layout

Expected source files in this repository:

- `src/`
- `scripts/`
- `test/`
- `public/`
- `package.json`
- `tsconfig.json`
- project rule and tracking markdown files

Current GitHub Pages publish files:

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
