"""Measure the sample app so a refactor, a test run or a graph rebuild can be compared before/after.

    python3 tools/measure.py before                    # writes measure/before.json
    python3 tools/measure.py after --graph PATH         # also counts a graph-kit graph.json
    python3 tools/measure.py --compare before after     # prints a table of what changed

Standard library only. It never edits the app: it reads the source, runs the
tests once, and replays the golden report.
"""
import ast
import contextlib
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "measure"
SKIP = {"tests", "tools", "measure", "out", ".git", ".pytest_cache", "__pycache__", "llm-ide-checks", "node_modules"}
WINDOW = 4  # lines per duplicate-block window
# A private bytecode cache: a quick same-size edit must never be measured from a stale __pycache__.
PYCACHE = tempfile.mkdtemp(prefix="measure-pycache-")
LONG_FUNCTION = 40
BIG_FILE = 300


def source_files():
    return sorted(p for p in ROOT.rglob("*.py") if not SKIP.intersection(p.relative_to(ROOT).parts))


def module_name(path):
    rel = path.relative_to(ROOT).with_suffix("")
    return ".".join(rel.parts[:-1] if rel.name == "__init__" else rel.parts)


def local_imports(tree, modules):
    found = set()
    for node in ast.walk(tree):
        names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""] if isinstance(node, ast.ImportFrom) else []
        for name in names:
            for candidate in (name, name.rsplit(".", 1)[0]):
                if candidate in modules:
                    found.add(candidate)
    return found


def cycles(graph):
    """Strongly connected groups of more than one module, or a module importing itself."""
    index, low, stack, on, out, counter = {}, {}, [], set(), [], [0]

    def visit(v):
        index[v] = low[v] = counter[0]
        counter[0] += 1
        stack.append(v)
        on.add(v)
        for w in graph.get(v, ()):
            if w not in index:
                visit(w)
                low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            group = []
            while True:
                w = stack.pop()
                on.discard(w)
                group.append(w)
                if w == v:
                    break
            if len(group) > 1 or v in graph.get(v, ()):
                out.append(sorted(group))

    for v in sorted(graph):
        if v not in index:
            visit(v)
    return sorted(out)


def duplicate_blocks(files):
    counts = Counter()
    for path in files:
        lines = [l.strip() for l in path.read_text(encoding="utf-8").splitlines()]
        lines = [l for l in lines if l and not l.startswith("#")]
        for i in range(len(lines) - WINDOW + 1):
            counts[hashlib.sha1("\n".join(lines[i:i + WINDOW]).encode()).hexdigest()] += 1
    return sum(n - 1 for n in counts.values() if n > 1)


def code_metrics():
    files = source_files()
    modules = {module_name(p): p for p in files}
    graph, functions, globals_used, per_file = {}, [], 0, {}
    for name, path in modules.items():
        text = path.read_text(encoding="utf-8")
        tree = ast.parse(text)
        graph[name] = sorted(local_imports(tree, modules) - {name})
        per_file[str(path.relative_to(ROOT))] = len(text.splitlines())
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                functions.append({"name": f"{name}.{node.name}", "lines": node.end_lineno - node.lineno + 1})
            elif isinstance(node, ast.Global):
                globals_used += 1
    imported = {m for deps in graph.values() for m in deps}
    test_imports = set()
    for path in (ROOT / "tests").rglob("*.py"):
        test_imports |= local_imports(ast.parse(path.read_text(encoding="utf-8")), modules)
    longest = max(functions, key=lambda f: f["lines"], default={"name": "-", "lines": 0})
    return {
        "files": len(files),
        "lines": sum(per_file.values()),
        "largest_file_lines": max(per_file.values(), default=0),
        "files_over_%d_lines" % BIG_FILE: sum(1 for n in per_file.values() if n > BIG_FILE),
        "functions": len(functions),
        "longest_function": f"{longest['name']} ({longest['lines']} lines)",
        "functions_over_%d_lines" % LONG_FUNCTION: sum(1 for f in functions if f["lines"] > LONG_FUNCTION),
        "duplicate_%d_line_blocks" % WINDOW: duplicate_blocks(files),
        "global_statements": globals_used,
        "import_cycles": cycles(graph),
        "unused_modules": sorted(m for m in modules if m not in imported and m not in test_imports and m != "shop"),
        "per_file_lines": per_file,
    }


def test_metrics():
    files = list((ROOT / "tests").rglob("test_*.py"))
    count = sum(1 for p in files for n in ast.walk(ast.parse(p.read_text(encoding="utf-8")))
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name.startswith("test"))
    env = {**os.environ, "PYTHONPYCACHEPREFIX": PYCACHE}
    run = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider"], cwd=ROOT, capture_output=True, text=True, env=env)
    last = (run.stdout.strip().splitlines() or [""])[-1]
    return {"test_files": len(files), "test_functions": count, "tests_green": run.returncode == 0, "pytest": last}


def golden_metrics():
    sys.path.insert(0, str(ROOT))
    sys.pycache_prefix = PYCACHE
    try:
        import shop  # noqa: E402  (the app under measurement)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            shop.main([str(ROOT / "data" / "orders.csv")])
        same = out.getvalue() == (ROOT / "tests" / "golden" / "report.txt").read_text(encoding="utf-8")
    except Exception as e:  # a refactor may break the entry point itself
        return {"behaviour_unchanged": False, "golden_error": f"{type(e).__name__}: {e}"}
    return {"behaviour_unchanged": same}


def graph_metrics(path):
    g = json.loads(Path(path).read_text(encoding="utf-8"))
    kinds = Counter(e.get("kind", "?") for e in g.get("edges", []))
    py = [n for n in g.get("nodes", []) if str(n.get("metadata", {}).get("path", "")).endswith(".py")]
    return {"graph_nodes": len(g.get("nodes", [])), "graph_edges": len(g.get("edges", [])), "graph_python_nodes": len(py),
            **{f"graph_{k}_edges": v for k, v in sorted(kinds.items())}}


def compare(a, b):
    before = json.loads((OUT / f"{a}.json").read_text(encoding="utf-8"))
    after = json.loads((OUT / f"{b}.json").read_text(encoding="utf-8"))
    print(f"| metric | {a} | {b} | change |")
    print("|---|---|---|---|")
    for key in [k for k in before if k != "per_file_lines"] + [k for k in after if k not in before and k != "per_file_lines"]:
        x, y = before.get(key, "-"), after.get(key, "-")
        delta = f"{y - x:+d}" if isinstance(x, int) and isinstance(y, int) and not isinstance(x, bool) else ("" if x == y else "changed")
        print(f"| {key} | {x} | {y} | {delta} |")
    files = sorted(set(before.get("per_file_lines", {})) | set(after.get("per_file_lines", {})))
    print("\n| file | lines before | lines after |\n|---|---|---|")
    for f in files:
        print(f"| {f} | {before.get('per_file_lines', {}).get(f, '-')} | {after.get('per_file_lines', {}).get(f, '-')} |")


def main(argv):
    if len(argv) == 3 and argv[0] == "--compare":
        compare(argv[1], argv[2])
        return 0
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 2
    label = argv[0]
    data = {**code_metrics(), **test_metrics(), **golden_metrics()}
    if "--graph" in argv:
        data.update(graph_metrics(argv[argv.index("--graph") + 1]))
    OUT.mkdir(exist_ok=True)
    (OUT / f"{label}.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    for k, v in data.items():
        if k != "per_file_lines":
            print(f"{k}: {v}")
    print(f"saved measure/{label}.json")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
