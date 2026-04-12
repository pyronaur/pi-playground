# pi-playground

`pi-playground` is a local Pi utility package with two jobs:

- quick place to try small Pi experiments
- collection of Pi inspection/debug utilities

## Current shape

Current runtime entrypoints are plain JS files at repo root:

- `index.js` - extension entry
- `request-debugger.js` - provider request debug helper

This repo will move to package-style TypeScript so other local Pi extensions can import selected helpers through normal npm `devDependencies` wiring.

## Public surface policy

Only documented exports are public.

When a helper becomes reusable across extensions:

1. add an explicit `package.json` export
2. document it here under `Public surface`
3. add that file to `knip.json` `entry`

If a module is not documented as public, treat it as internal and keep it out of `exports`.

## Public surface

Nothing documented yet.

## Internal-only files

- `index.js`
- `request-debugger.js`

## Storage policy

Large debug payloads are debug artifacts, not session state.

- keep request payload capture out of LLM context
- prefer session-adjacent sidecar files for full wire/request dumps
- use session JSONL custom entries only for compact extension state that Pi should carry with the session

## Current utilities

- `/debug-playground` toggles provider request debugging
- `Playground` overlay badge marks that request debugging is enabled
- request logging captures full pre-send provider payloads for Pi inspection