# llm-ide_test

Everything for checking LLM-IDE in one repo:

- **The repo root** is a small shop-order app in Python that is **unstructured on purpose**. Point
  LLM-IDE's desktop app at this repo and see clearly whether the graph, the Test loop, the
  Refactoring loop and the Factory do their job.
- **[`llm-ide-checks/`](llm-ide-checks/README.md)** is a JavaScript suite that tests LLM-IDE's own
  code (graph, Loop, refactor gates, Factory, issues, Gantt) against an llm-ide checkout:
  `cd llm-ide-checks && npm test`.

The root has no `package.json` on purpose: the desktop Loop then detects `pytest` (from
`pyproject.toml`) as this repo's test command.

```bash
python3 shop.py data/orders.csv          # the report (add --save to write out/summary.json)
python3 -m pytest -q                     # the one end-to-end golden test
python3 tools/measure.py before          # record the "before" numbers
python3 tools/measure.py --compare before after
```

Python 3.9+ and `pytest` on the PATH (the Loop runs `pytest`, detected from `pyproject.toml`).

## What is wrong on purpose

Every problem has a number in `tools/measure.py`, so a fix shows up as a change.

| Problem | Where | `measure.py` metric (before) |
|---|---|---|
| One god file: reading, validation, pricing, reports, saving, CLI | `shop.py` (403 lines) | `largest_file_lines` 403, `files_over_300_lines` 1 |
| One 109-line function that does everything | `shop.process_everything` | `longest_function`, `functions_over_40_lines` 1 |
| The tax table is copied five times | `process_everything`, `calc_tax_for_order`, `tax_for_region_report`, `save_summary`, `TAX_RATES` | `duplicate_4_line_blocks` 12 |
| Error handling repeated in every branch | `check_row` | part of `duplicate_4_line_blocks` |
| Global mutable state | `ORDERS`, `ERRORS`, `STATS`, `SAVE` | `global_statements` 2 |
| Import cycle | `shop` imports `utils`, `utils` imports `shop` | `import_cycles` [shop, utils] |
| Dead module | `legacy.py`, imported by nothing | `unused_modules` [legacy] |
| Almost no tests | only the golden end-to-end test | `test_functions` 2 |

## Known quirks (pinned, do not "fix" in a refactor)

The golden test (`tests/golden/report.txt`) pins today's output exactly. A
refactor must keep it; fixing one of these is a behaviour change and belongs in
its own commit that also updates the golden file.

- Order A106: the `coupon VIP` line shows `-$0.82`, which is really the silver
  member discount. The VIP coupon itself was refused.
- Error messages say `line N`, but N counts data rows, not file lines (comments are skipped).
- Order A100 is reported with customer `aiko`; the later `zed` row is rejected.

## Testing the desktop app with it

1. **Add the repo** in Settings → Repositories (`dnsmalla/llm-ide_test`) and clone it into the project.
2. **Before:** generate the graph, then from the clone run
   `python3 tools/measure.py before --graph <project>/system/graph/<repo>/graph-code.json`
   (with only one repo under `code/`, the graph is `<project>/system/graph/graph-code.json`).
3. **Graph:** it should show 3 Python files, the `shop` ↔ `utils` import cycle, and `legacy.py` with no incoming import.
4. **Test loop:** it should add unit tests (for example tax, discounts, shipping, CSV checks) through public calls.
   Then run `python3 tools/measure.py after-test` and compare. Expect `test_functions` to rise, with
   `tests_green` and `behaviour_unchanged` both `True`, and no source line changed.
5. **Refactoring loop** (turn on "Open an issue per run and comment each step on it" to follow it on GitHub):
   run `python3 tools/measure.py after-refactor --graph …` and compare with `before`.

### What "working correctly" looks like after a refactor

| Must hold | Should improve |
|---|---|
| `behaviour_unchanged` is `True` (the golden report is byte-identical) | `largest_file_lines` and `functions_over_40_lines` fall |
| `tests_green` is `True` | `duplicate_4_line_blocks` falls (one tax table) |
| `tests/golden/report.txt` and `data/` are untouched | `import_cycles` becomes `[]` |
| | `unused_modules` becomes `[]` (`legacy.py` removed) |
| | `global_statements` falls |
| | the graph shows more, smaller files and no cycle |

If `behaviour_unchanged` turns `False`, the refactor changed behaviour. That is
the clearest signal that something is wrong.
