# `src/compat/` — temporary pi-API shims (bootstrap layer)

> Delete as tools migrate to native DSH calls. New capability belongs in
> `src/dsh/`, never here.

Each file in this directory carries a `TEMPORARY` header. The shims exist for
one reason (DECISIONS A3): probe the DSH API assumptions (B1–B8) with the
least code while the native layer (`src/dsh/`) takes over tool by tool.

Rules for this directory:

1. Adapt **narrow shapes only** (`ExecApi`, cwd strings, arg normalization).
2. No `ExtensionAPI` re-implementation, no event re-dispatch, no TUI.
3. Every export names its native replacement in its docstring.
4. When the last importer migrates, delete the file — do not deprecate it.
