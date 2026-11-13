"""End-to-end check: the full report for data/orders.csv must not change.

This is the "old test" a refactor is measured against. It pins today's output
exactly, quirks included (see README "Known quirks"), so a refactor that changes
behaviour fails here. Fixing a quirk is a feature change: update the golden
file in its own commit, never inside a refactor.
"""
import contextlib
import io
from pathlib import Path

import shop

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = Path(__file__).resolve().parent / "golden" / "report.txt"


def run_report():
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = shop.main([str(ROOT / "data" / "orders.csv")])
    return code, out.getvalue()


def test_the_report_for_the_sample_orders_is_unchanged():
    code, text = run_report()
    assert code == 0
    assert text == GOLDEN.read_text(encoding="utf-8")


def test_running_twice_gives_the_same_report():
    assert run_report() == run_report()
