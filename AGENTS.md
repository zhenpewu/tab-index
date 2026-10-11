# Repository Guidelines

## Project Structure & Module Organization

Tab Index is a Firefox-only Manifest V3 extension built with TypeScript and Preact.

- `src/background/`: browser actions, tab snapshots, and message handling.
- `src/domain/`: side-effect-free search, duplicate matching, settings, and URL/title rules.
- `src/popup/`: popup UI, state hook, tab lists, and styles.
- `src/options/`: settings page UI and styles.
- `src/shared/`: browser adapters, shared messages, and theme CSS.
- `tests/`: Vitest unit and Preact interaction tests.
- `icons/`, `licenses/`, and root metadata files are copied into release builds.
- `dist/` and `web-ext-artifacts/` are generated outputs; do not edit them directly.

## Build, Test, and Development Commands

Use a supported Node version (`^24.15.0` or `>=26.0.0`) and install dependencies with `npm install`.

- `npm run test:watch`: run Vitest interactively while developing.
- `npm test`: run the complete test suite once.
- `npm run typecheck`: validate strict TypeScript without emitting files.
- `npm run lint`: run ESLint across the repository.
- `npm run build`: create the production extension in `dist/`.
- `npm run check`: run typechecking, linting, tests, build, and `web-ext` validation.
- `npm run package`: produce installable and source archives in `web-ext-artifacts/`.

For manual testing, build first, then load `dist/manifest.json` from Firefox’s `about:debugging#/runtime/this-firefox`.

## Coding Style & Naming Conventions

Follow existing TypeScript: two-space indentation, double quotes, semicolons, trailing commas, and explicit types at module boundaries. Use `PascalCase` for Preact components and types, `camelCase` for functions and variables, and descriptive kebab-case CSS classes. Keep domain modules deterministic and free of browser API calls; isolate Firefox integration in background or shared adapters. ESLint and strict TypeScript are the authoritative style checks.

## Testing Guidelines

Place tests in `tests/` as `<feature>.test.ts` or `<feature>.test.tsx`. Use Vitest; use Testing Library for user-visible Preact behavior. Add focused regression tests for bug fixes and use synthetic URLs rather than private or internal addresses. No numeric coverage threshold is configured, but changed behavior should be exercised. Run `npm run check` before submission.

## Commit & Pull Request Guidelines

History uses Conventional Commit prefixes such as `feat:`, `fix:`, `style:`, `build:`, and `chore:`. Keep commits focused and written in the imperative mood. Pull requests should explain the user-visible change, note verification performed, link relevant issues, and include before/after screenshots for popup, options, or icon changes. Permission or manifest changes require an explicit rationale.
