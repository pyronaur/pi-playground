# pi-playground

- Purpose: `pi-playground` is both quick experiment playground and utility package for inspecting/debugging Pi itself.
- Scope: keep tools focused on Pi runtime inspection, request debugging, session inspection, and other dev-only utilities.
- Packaging: treat public exports as explicit API. If another extension should import helper, export it intentionally from `package.json` and document it in `README.md`.
- Packaging: keep `package.json` `exports`, `README.md` `Public surface`, and real reusable modules aligned. `knip` already reads package exports; use `knip.json` only for extra non-export entrypoints.
- Packaging: keep README sections current for `Public surface`, `Internal-only files`, and `Storage policy`.
- Layout: `src/play/*` is JS-only scratch space. No tests, no types, no lint pressure. Keep it dirty and disposable.
- Layout: `src/modules/*` is TypeScript-only reusable utilities. Each module owns one clean interaction surface.
- Layout: `src/app/*` is TypeScript-only Pi and UI wiring. Compose modules there.
- Layout: `src/index.ts` is boot-only. No feature logic there.
- Runtime: extension entry stays minimal. Reusable debug helpers live in separate modules and are imported by the entry.
- Storage: keep debug traces out of LLM context. Prefer session-adjacent sidecar files for large wire payloads.
- Completion workflow lives in `.gatefile.json5`.