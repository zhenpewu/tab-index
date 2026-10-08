# Tab Index

Search, switch, and close duplicate tabs in Firefox.

Tab Index is a Firefox Manifest V3 extension. Version 1 is designed for manual
duplicate review: tabs are closed only after an explicit user action.

## Development

Requires Node.js 24.15 or newer on the Node 24 line, or Node.js 26 or newer.
Node.js 25 is not supported.

```bash
npm install
npm run check
npm run package
```

The production extension is built into `dist/`. Packaged ZIP files are written
to `web-ext-artifacts/`.

## License

Tab Index is licensed under GPL-3.0. See `LICENSE` and
`THIRD_PARTY_NOTICES.md`.
