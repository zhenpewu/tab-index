# Tab Index

Search, switch, and close duplicate tabs in Firefox.

Tab Index is a Firefox-only Manifest V3 extension with a compact, Firefox-style
popup.

## Features

- Search open tabs across normal Firefox windows and switch to a result.
- Review duplicate groups, with the retained tab clearly marked.
- Close one tab, one duplicate group, or all reviewed duplicate groups.
- Filter pinned tabs separately.
- Match duplicates by URL, title, Firefox container, window, and configurable
  normalization rules.

Duplicate cleanup is manual: Tab Index never closes tabs automatically. Every
close starts with an explicit button or keyboard action.

## Install locally

Build the extension, then open `about:debugging#/runtime/this-firefox` in
Firefox, choose **Load Temporary Add-on**, and select `dist/manifest.json`.
Temporary installations are removed when Firefox exits.

The toolbar button opens Duplicates mode. On macOS,
`Command+Shift+Y` opens All Tabs search and focuses the search field. The
shortcut can be changed from Firefox's **Manage Extension Shortcuts** page.

## Settings

The settings page controls:

- Comfortable, Compact, or Dense layout.
- Current-window or all-window duplicate scope.
- Within-container or across-container matching.
- URL normalization, title matching, whitelist, and advanced pattern rules.
- Which tab to keep based on pinned, active, HTTPS, age, and active-window
  priorities.

The popup and settings page follow Firefox's light or dark appearance
automatically. The interface uses neutral colors with Firefox-blue focus and
selection states.

## Permissions

- `tabs`: read tab titles and URLs, switch tabs, and close tabs you select.
- `storage`: save settings and the one-shot popup mode used by the shortcut.
- `contextualIdentities`: distinguish Firefox containers when matching tabs.

Tab Index performs its work locally and declares that it does not collect data.

## Development

Requires Node.js 24.15 or newer on the Node 24 line, or Node.js 26 or newer.
Node.js 25 is not supported.

```bash
npm install
npm run check
npm run package
```

The production extension is built into `dist/`. `npm run package` writes the
installable ZIP and its version-matched source archive to
`web-ext-artifacts/`. To launch the current build in a disposable Firefox
profile, run:

```bash
npx web-ext run --source-dir dist --firefox /Applications/Firefox.app/Contents/MacOS/firefox
```

## License and attribution

Tab Index is licensed under GPL-3.0. See `LICENSE` and
`THIRD_PARTY_NOTICES.md`. Duplicate matching and retained-tab behavior are
adapted from Duplicate Tabs Closer by Peuj (GPL-3.0). Search behavior is
informed by Tab Search by reblws (MIT).
