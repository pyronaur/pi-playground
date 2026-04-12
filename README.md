# pi-playground

`pi-playground` is a local Pi utility package with two jobs:

- quick place to try small Pi experiments
- collection of Pi inspection/debug utilities

## Current shape

Current runtime shape is package-style TypeScript:

- `src/index.ts` - extension entry
- `src/request-debugger.ts` - reusable provider request debug helper

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

## Storage policy

Large debug payloads are debug artifacts, not session state.

- keep request payload capture out of LLM context
- prefer session-adjacent sidecar files for full wire/request dumps
- use session JSONL custom entries only for compact extension state that Pi should carry with the session

`RequestDebugger` writes full provider payloads next to the active Pi session file as `<session>.requests.jsonl`.
If Pi is running without a persisted session file, it falls back to `.pi/playground/*.requests.jsonl` under the current project.

## Current utilities

- `/debug-playground` toggles provider request debugging
- `Playground` overlay badge marks that request debugging is enabled
- request logging captures full pre-send provider payloads for Pi inspection