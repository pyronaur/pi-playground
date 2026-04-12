# pi-playground

- Purpose: `pi-playground` is both quick experiment playground and utility package for inspecting/debugging Pi itself.
- Scope: keep tools focused on Pi runtime inspection, request debugging, session inspection, and other dev-only utilities.
- Packaging: treat public exports as explicit API. If another extension should import helper, export it intentionally from `package.json` and document it in `README.md`.
- Packaging: keep `package.json` `exports`, `README.md` `Public surface`, and real reusable modules aligned. `knip` already reads package exports; use `knip.json` only for extra non-export entrypoints.
- Packaging: keep README sections current for `Public surface`, `Internal-only files`, and `Storage policy`.
- Runtime: extension entry stays minimal. Reusable debug helpers live in separate modules and are imported by the entry.
- Storage: keep debug traces out of LLM context. Prefer session-adjacent sidecar files for large wire payloads.
- Before handoff: run package checks that exist for this repo.