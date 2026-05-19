# pi-playground

`pi-playground` is a local Pi utility package with two jobs:

- quick place to try small Pi experiments
- collection of Pi inspection/debug utilities

## Workflow intent

Playground is primarily a temporary experiment area for Pi-specific runtime work. Use it to try uncertain extension ideas, inspect Pi behavior, and stabilize useful pieces before either keeping them as documented playground utilities or extracting them into another extension/package.

This is guidance, not a hard routing rule. A request to "experiment" does not automatically belong in playground; ask when the target location is ambiguous.

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
- `src/models/pp-look-store.ts` - `pp` look artifact numbering and storage
- `src/modules/pp-tool.ts` - playground-only `pp` tool for cmux look/do actions
- `src/modules/prompt-navigator.ts` - user-only overlay for inspecting effective prompt and active tools
- `src/modules/prompt-trace.ts` - session-adjacent prompt trace artifacts for effective prompt, wire prompt, source manifest, and provider response metadata
- `src/modules/request-debugger.ts` - reusable provider request debug helper

This repo is now a package-style TypeScript base so other local Pi extensions can import selected helpers through normal `devDependencies` wiring.

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

`prompt-trace` writes agent-readable prompt artifacts next to the active Pi session file:

- `<session>.system-prompt.txt` - actual sent prompt captured from `before_provider_request`
- `<session>.effective-system-prompt.txt` - current runtime prompt from `ctx.getSystemPrompt()` at send time
- `<session>.prompt-sources.json` - discoverable prompt inputs and active tool manifest
- `<session>.provider-response.json` - latest `after_provider_response` status and headers

If Pi is running without a persisted session file, it falls back to `.pi/playground/` under the current project.

`PpTool` writes one full cmux output snapshot per `look` call to `.pi/playground/pp/look-*.txt`.
`look screen`, `look diff`, `look full_output`, and `look last` all share that same saved full-output snapshot.

Docs naming split:

- `Playground Mode` - active debugging mode in this extension
- `pp` - actual playground custom tool name when this extension is loaded and Playground Mode is active

## Current utilities

- `leader` then `g` activates playground for current session
- once active, `leader` then `g` then `p` opens prompt navigator overlay
- once active, `leader` then `g` then `r` toggles provider request debugging
- slash fallbacks mirror leader actions when `pi-leader` is absent: `/playground`, `/system-view`, `/system-prompt`, `/playground-toggle-request-logging`
- prompt navigator tabs: `System Prompt` shows the actual last sent prompt from provider payload capture when available, then the full live runtime prompt, then the source breakdown items; `Tools` shows active tool metadata
- prompt navigator keys: `c` copies current text, `e` opens current text in the editor via `/tmp/pi-system/*.md`, `s` opens the source file in the editor when present, `o` reveals the source in Finder
- once active, `pp` tool becomes available to the agent
- `pp` creates one cmux split from the origin Pi surface on first use, then reuses the attached surface
- `pp` `look` supports `diff` (default), `screen`, `full_output`, and `last`
- every `look` captures full cmux output once, saves that full snapshot, then returns a projection:
- `screen` returns the visible viewport of the attached surface
- `full_output` returns complete cmux scrollback/output
- `diff` compares full snapshots after stripping the bottom input area
- `last` returns the last non-empty lines from the latest full snapshot
- `pp` `do` sends literal text, named cmux keys, and optional Enter to the attached playground pane
- `Playground` widget stays above the input box on the left while playground is active
- request logging captures full pre-send provider payloads for Pi inspection
- prompt tracing persists agent-readable prompt artifacts so the agent can inspect effective prompt, sent prompt, source inputs, and response metadata by reading files instead of relying on UI

Leader is primary. Slash fallbacks exist for the same playground actions when `pi-leader` is unavailable.

## Architecture rules

- `src/play/*` is JS-only scratch space. No tests, no types, no lint pressure.
- `src/modules/*` is TypeScript-only reusable utilities. Keep one clean interaction surface per module.
- `src/app/*` is TypeScript-only Pi and UI wiring. Compose modules there.
- `src/index.ts` is boot-only. Keep feature logic out.

## Gate protection rules

- Markdown files are protected except `README.md`. Gate requires `--allow-protected-markdown` after manual review.
