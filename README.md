# CPALE Tracker

Personal CPALE preparation tracker. Runs entirely in your browser; study data stays on your device.

## Deploy (GitHub Pages)
1. Upload all files from this folder to the repository root, keeping the folders (css, js, data, icons, tests) and the root files (index.html, sw.js, manifest.webmanifest).
2. Settings > Pages > Deploy from branch (main, /root). Open the Pages URL.

## Install and offline
- Open the live page once while online. Chrome and Edge then offer an install icon in the address bar; iPhone/iPad: Share > Add to Home Screen.
- Offline test: after the first load, turn off the connection (or DevTools > Network > Offline) and reload. The app and your data should work. Settings > App and offline shows the status.
- Updates: after you upload a new version, open the app. A banner offers "Reload to update". GitHub Pages can take a few minutes to publish.
- If the app looks stale or broken: Settings > Repair app files (clears only the app cache, never your data).

## Releasing a new version
Change the version in BOTH js/version.js and sw.js (they must match), and add any new file to the ASSETS list in sw.js. `node tests/model.test.mjs` checks all of this.

## Tests
`node tests/model.test.mjs` (Node 18+). Browser-only behavior needs manual checks (see WEEK_TEST_GUIDE.md).
