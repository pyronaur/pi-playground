# pi-playground

`pi-playground` is a local Pi utility package with two jobs:

- quick place to try small Pi experiments
- collection of Pi inspection/debug utilities

## Current shape

Current runtime shape is package-style TypeScript:

- `src/index.ts` - boot only
- `src/app/*` - Pi and UI wiring
- `src/modules/*` - reusable TypeScript utilities with clean public surfaces
- `src/play/*` - JS-only scratchpad for dirty experiments, excluded from lint and type gates

Current modules:

- `src/app/register-playground.ts` - extension event and leader wiring
- `src/app/pi-leader-event.ts` - local shared-event type guard for `pi-leader`
- `src/app/widget.ts` - persistent widget above the editor
- `src/models/playground-session-state.ts` - session-owned playground state model
- `src/modules/request-debugger.ts` - reusable provider request debug helper

This repo is now a package-style TypeScript base so other local Pi extensions can import selected helpers through normal npm `devDependencies` wiring.

## Public surface policy

Only documented exports are public.

When a helper becomes reusable across extensions:

1. add an explicit `package.json` export
2. document it here under `Public surface`
3. add a `knip.json` entry only if it is a real entrypoint and not already covered by package metadata

If a module is not documented as public, treat it as internal and keep it out of `exports`.

## Public surface

- `pi-playground/request-debugger` - exports `RequestDebugger` for other Pi extensions that want full pre-send provider request capture

## Internal-only files

- `src/index.ts`
- `src/app/*`

## Storage policy

Large debug payloads are debug artifacts, not session state.

- keep request payload capture out of LLM context
- prefer session-adjacent sidecar files for full wire/request dumps
- use session JSONL custom entries only for compact extension state that Pi should carry with the session

`RequestDebugger` writes full provider payloads next to the active Pi session file as `<session>.requests.jsonl`.
If Pi is running without a persisted session file, it falls back to `.pi/playground/*.requests.jsonl` under the current project.

## Current utilities

- `leader` then `g` activates playground for current session
- once active, `leader` then `g` then `r` toggles provider request debugging
- `Playground` widget stays above the input box on the left while playground is active
- request logging captures full pre-send provider payloads for Pi inspection

All playground actions are leader-initiated. No slash commands.

## Architecture rules

- `src/play/*` is JS-only scratch space. No tests, no types, no lint pressure.
- `src/modules/*` is TypeScript-only reusable utilities. Keep one clean interaction surface per module.
- `src/app/*` is TypeScript-only Pi and UI wiring. Compose modules there.
- `src/index.ts` is boot-only. Keep feature logic out.

## Gate protection rules

- `src/play/*` stays out of automatic commit flow. Gate requires `--allow-play` after manual review.
- Markdown files are protected except `README.md`. Gate requires `--allow-protected-markdown` after manual review.
