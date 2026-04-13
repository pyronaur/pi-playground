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
- `src/models/piux-look-store.ts` - `piux` look artifact numbering and storage
- `src/modules/piux-tool.ts` - playground-only `piux_client` tool for tmux look/do actions
- `src/modules/prompt-navigator.ts` - user-only overlay for inspecting effective prompt and active tools
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
- prefer dedicated debug artifact directories for external live-observation captures
- use session JSONL custom entries only for compact extension state that Pi should carry with the session

`RequestDebugger` writes full provider payloads next to the active Pi session file as `<session>.requests.jsonl`.
If Pi is running without a persisted session file, it falls back to `.pi/playground/*.requests.jsonl` under the current project.

`PiuxTool` writes one full tmux output snapshot per `look` call to `/tmp/piux/.playground/look-*.txt`.
`look screen`, `look diff`, `look full_output`, and `look last` all share that same saved full-output snapshot.

Docs naming split:

- `piux` - user-only shell alias/function that starts or attaches the clean test base
- `piux_client` - actual playground custom tool name when this extension is loaded and playground is active

## Current utilities

- `leader` then `g` activates playground for current session
- once active, `leader` then `g` then `p` opens prompt navigator overlay
- once active, `leader` then `g` then `r` toggles provider request debugging
- slash fallbacks mirror leader actions when `pi-leader` is absent: `/playground-activate`, `/system-view`, `/system-prompt`, `/playground-toggle-request-logging`
- prompt navigator tabs: `System Prompt` shows the actual last sent prompt from provider payload capture when available, then the full live runtime prompt, then the source breakdown items; `Tools` shows active tool metadata
- prompt navigator keys: `c` copies current text, `e` opens current text in the editor via `/tmp/pi-system/*.md`, `s` opens the source file in the editor when present, `o` reveals the source in Finder
- once active, `piux_client` tool becomes available to the agent
- `piux_client` `look` supports `diff` (default), `screen`, `full_output`, and `last`
- every `look` captures full tmux output once, saves that full snapshot, then returns a projection:
- `screen` returns visible pane-height lines from the latest full snapshot
- `full_output` returns complete tmux scrollback/output
- `diff` compares full snapshots after stripping the bottom input area
- `last` returns the last non-empty lines from the latest full snapshot
- `piux_client` `do` sends literal text, named tmux keys, and optional Enter to fixed target `piux:pi.0`
- `Playground` widget stays above the input box on the left while playground is active
- request logging captures full pre-send provider payloads for Pi inspection

Leader is primary. Slash fallbacks exist for the same playground actions when `pi-leader` is unavailable.

## Architecture rules

- `src/play/*` is JS-only scratch space. No tests, no types, no lint pressure.
- `src/modules/*` is TypeScript-only reusable utilities. Keep one clean interaction surface per module.
- `src/app/*` is TypeScript-only Pi and UI wiring. Compose modules there.
- `src/index.ts` is boot-only. Keep feature logic out.

## Gate protection rules

- `src/play/*` stays out of automatic commit flow. Gate requires `--allow-play` after manual review.
- Markdown files are protected except `README.md`. Gate requires `--allow-protected-markdown` after manual review.
