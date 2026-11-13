# Rules for agents working on this repo

This repo is a test target: its mess is deliberate, and the files below are the
measuring stick for any change.

- **Never edit** `tests/golden/`, `data/`, `tools/` or `measure/`. They prove whether behaviour held.
- **Never edit** `llm-ide-checks/`: it is a separate JavaScript suite that tests LLM-IDE itself, not part of this app.
- A refactor must keep `python3 -m pytest -q` green and the report byte-identical to `tests/golden/report.txt`.
  The quirks listed in README.md "Known quirks" are pinned behaviour: keep them.
- Python 3.9 compatible (no `match`, no `X | Y` type unions). Standard library only.
- New tests go under `tests/` as `test_*.py`, call public functions, and assert outputs.
