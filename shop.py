# shop.py - order processing for the shop
# reads orders csv, checks them, computes prices, prints the report
# TODO: clean this up some day

import sys
import os
import json
import math
import utils

# ---------------------------------------------------------------------------
# global state (everything writes here)
# ---------------------------------------------------------------------------
ORDERS = {}
ERRORS = []
STATS = {"lines": 0, "bad": 0, "orders": 0}
SAVE = False
OUT_DIR = "out"

CATALOG = {
    "BK-001": {"name": "Python Basics", "price": 24.0, "weight": 0.6, "cat": "book"},
    "BK-002": {"name": "Clean Code Notes", "price": 32.5, "weight": 0.8, "cat": "book"},
    "BK-003": {"name": "Graph Theory Primer", "price": 41.0, "weight": 1.1, "cat": "book"},
    "TY-001": {"name": "Wooden Train", "price": 18.0, "weight": 1.5, "cat": "toy"},
    "TY-002": {"name": "Puzzle Cube", "price": 9.5, "weight": 0.2, "cat": "toy"},
    "TY-003": {"name": "Robot Kit", "price": 79.0, "weight": 2.4, "cat": "toy"},
    "EL-001": {"name": "USB Cable", "price": 6.0, "weight": 0.1, "cat": "electronics"},
    "EL-002": {"name": "Headphones", "price": 59.0, "weight": 0.4, "cat": "electronics"},
    "EL-003": {"name": "Desk Lamp", "price": 35.0, "weight": 1.9, "cat": "electronics"},
}

TAX_RATES = {"JP": 0.10, "EU": 0.20, "US": 0.07}


# ---------------------------------------------------------------------------
# reading
# ---------------------------------------------------------------------------
def read_file(path):
    f = open(path)
    text = f.read()
    f.close()
    rows = []
    lines = text.split("\n")
    header = None
    for l in lines:
        l = l.strip()
        if l == "":
            continue
        if l.startswith("#"):
            continue
        parts = l.split(",")
        if header is None:
            header = parts
            continue
        row = {}
        i = 0
        for h in header:
            if i < len(parts):
                row[h.strip()] = parts[i].strip()
            else:
                row[h.strip()] = ""
            i = i + 1
        rows.append(row)
    return rows


def check_row(row, n):
    # returns True if row ok, else adds error and returns False
    if row.get("order_id", "") == "":
        ERRORS.append("line %d: missing order_id" % n)
        STATS["bad"] = STATS["bad"] + 1
        return False
    if row.get("customer", "") == "":
        ERRORS.append("line %d: missing customer" % n)
        STATS["bad"] = STATS["bad"] + 1
        return False
    if row.get("sku", "") not in CATALOG:
        ERRORS.append("line %d: unknown sku %s" % (n, row.get("sku", "")))
        STATS["bad"] = STATS["bad"] + 1
        return False
    try:
        q = int(row.get("qty", "0"))
    except ValueError:
        ERRORS.append("line %d: qty is not a number" % n)
        STATS["bad"] = STATS["bad"] + 1
        return False
    if q <= 0:
        ERRORS.append("line %d: qty must be positive" % n)
        STATS["bad"] = STATS["bad"] + 1
        return False
    if q > 100:
        ERRORS.append("line %d: qty too large" % n)
        STATS["bad"] = STATS["bad"] + 1
        return False
    r = row.get("region", "")
    if r not in ("JP", "EU", "US", "OTHER"):
        ERRORS.append("line %d: bad region %s" % (n, r))
        STATS["bad"] = STATS["bad"] + 1
        return False
    m = row.get("member", "")
    if m not in ("", "silver", "gold"):
        ERRORS.append("line %d: bad member level %s" % (n, m))
        STATS["bad"] = STATS["bad"] + 1
        return False
    return True


# ---------------------------------------------------------------------------
# the big one
# ---------------------------------------------------------------------------
def process_everything(rows):
    n = 1
    for row in rows:
        n = n + 1
        STATS["lines"] = STATS["lines"] + 1
        if not check_row(row, n):
            continue
        oid = row["order_id"]
        if oid not in ORDERS:
            ORDERS[oid] = {
                "id": oid,
                "customer": row["customer"],
                "region": row["region"],
                "member": row["member"],
                "coupon": row.get("coupon", ""),
                "lines": [],
            }
            STATS["orders"] = STATS["orders"] + 1
        else:
            o = ORDERS[oid]
            if o["customer"] != row["customer"]:
                ERRORS.append("line %d: order %s has two customers" % (n, oid))
                STATS["bad"] = STATS["bad"] + 1
                continue
            if o["coupon"] == "" and row.get("coupon", "") != "":
                o["coupon"] = row.get("coupon", "")
        item = CATALOG[row["sku"]]
        q = int(row["qty"])
        line_total = item["price"] * q
        # category discounts
        if item["cat"] == "book":
            if q >= 3:
                line_total = line_total - line_total * 0.05
        elif item["cat"] == "toy":
            if q >= 5:
                line_total = line_total - line_total * 0.10
        elif item["cat"] == "electronics":
            if q >= 10:
                line_total = line_total - line_total * 0.03
        ORDERS[oid]["lines"].append({
            "sku": row["sku"],
            "name": item["name"],
            "qty": q,
            "price": item["price"],
            "weight": item["weight"] * q,
            "total": line_total,
        })

    # now compute every order
    for oid in sorted(ORDERS.keys()):
        o = ORDERS[oid]
        sub = 0.0
        w = 0.0
        for li in o["lines"]:
            sub = sub + li["total"]
            w = w + li["weight"]
        o["subtotal"] = sub
        # coupon
        c = o["coupon"]
        after = sub
        if c == "SAVE10":
            after = sub - sub * 0.10
        elif c == "FLAT5":
            if sub >= 50:
                after = sub - 5
        elif c == "VIP":
            if o["member"] == "gold":
                after = sub - sub * 0.15
            else:
                ERRORS.append("order %s: VIP coupon needs gold member" % oid)
        elif c != "":
            ERRORS.append("order %s: unknown coupon %s" % (oid, c))
        # member discount
        if o["member"] == "silver":
            after = after - after * 0.02
        elif o["member"] == "gold":
            after = after - after * 0.05
        o["discounted"] = after
        # shipping
        if after >= 100:
            ship = 0.0
        else:
            if w <= 1:
                ship = 5.0
            elif w <= 5:
                ship = 10.0
            else:
                ship = 20.0
        if o["region"] == "EU":
            ship = ship + 3.0
        o["shipping"] = ship
        # tax (on goods + shipping)
        rate = 0
        if o["region"] == "JP":
            rate = 0.10
        elif o["region"] == "EU":
            rate = 0.20
        elif o["region"] == "US":
            rate = 0.07
        else:
            rate = 0
        o["tax"] = (after + ship) * rate
        o["total"] = round(after + ship + o["tax"], 2)
        # points
        if o["member"] == "gold":
            o["points"] = int(math.floor(o["total"] / 10)) * 2
        else:
            o["points"] = int(math.floor(o["total"] / 10))
        o["weight"] = w


# ---------------------------------------------------------------------------
# tax helpers (used by the reports)
# ---------------------------------------------------------------------------
def calc_tax_for_order(o):
    rate = 0
    if o["region"] == "JP":
        rate = 0.10
    elif o["region"] == "EU":
        rate = 0.20
    elif o["region"] == "US":
        rate = 0.07
    else:
        rate = 0
    return (o["discounted"] + o["shipping"]) * rate


def tax_for_region_report(region, amount):
    rate = 0
    if region == "JP":
        rate = 0.10
    elif region == "EU":
        rate = 0.20
    elif region == "US":
        rate = 0.07
    else:
        rate = 0
    return amount * rate


# ---------------------------------------------------------------------------
# reports
# ---------------------------------------------------------------------------
def print_order(o):
    print("Order %s  customer=%s  region=%s  member=%s" % (o["id"], o["customer"], o["region"], o["member"] or "-"))
    for li in o["lines"]:
        print("  %-22s x%3d  %s" % (li["name"], li["qty"], utils.money(li["total"])))
    print("  %-27s %s" % ("subtotal", utils.money(o["subtotal"])))
    if o["coupon"] != "":
        print("  %-27s %s" % ("coupon " + o["coupon"], utils.money(o["discounted"] - o["subtotal"])))
    print("  %-27s %s" % ("shipping", utils.money(o["shipping"])))
    print("  %-27s %s" % ("tax", utils.money(calc_tax_for_order(o))))
    print("  %-27s %s" % ("TOTAL", utils.money(o["total"])))
    print("  points: %d" % o["points"])
    print("")


def print_regions():
    regions = {}
    for oid in ORDERS:
        o = ORDERS[oid]
        r = o["region"]
        if r not in regions:
            regions[r] = {"orders": 0, "goods": 0.0, "tax": 0.0, "total": 0.0}
        regions[r]["orders"] = regions[r]["orders"] + 1
        regions[r]["goods"] = regions[r]["goods"] + o["discounted"]
        regions[r]["tax"] = regions[r]["tax"] + tax_for_region_report(r, o["discounted"] + o["shipping"])
        regions[r]["total"] = regions[r]["total"] + o["total"]
    print("By region")
    print(utils.line(44))
    print("%-8s %6s %10s %8s %10s" % ("region", "orders", "goods", "tax", "total"))
    for r in sorted(regions.keys()):
        x = regions[r]
        print("%-8s %6d %10s %8s %10s" % (r, x["orders"], utils.money(x["goods"]), utils.money(x["tax"]), utils.money(x["total"])))
    print("")


def print_customers():
    cust = {}
    for oid in ORDERS:
        o = ORDERS[oid]
        if o["customer"] not in cust:
            cust[o["customer"]] = {"orders": 0, "total": 0.0, "points": 0}
        cust[o["customer"]]["orders"] = cust[o["customer"]]["orders"] + 1
        cust[o["customer"]]["total"] = cust[o["customer"]]["total"] + o["total"]
        cust[o["customer"]]["points"] = cust[o["customer"]]["points"] + o["points"]
    best = None
    best_total = -1
    for c in sorted(cust.keys()):
        if cust[c]["total"] > best_total:
            best = c
            best_total = cust[c]["total"]
    print("By customer")
    print(utils.line(44))
    for c in sorted(cust.keys()):
        print("%-12s orders=%d total=%s points=%d" % (c, cust[c]["orders"], utils.money(cust[c]["total"]), cust[c]["points"]))
    if best is not None:
        print("top customer: %s (%s)" % (best, utils.money(best_total)))
    print("")


def print_errors():
    if len(ERRORS) == 0:
        print("No errors")
        return
    print("Errors (%d)" % len(ERRORS))
    print(utils.line(44))
    for e in ERRORS:
        print("  - " + e)


def print_stats():
    print(utils.line(44))
    print("lines read: %d, bad lines: %d, orders: %d" % (STATS["lines"], STATS["bad"], STATS["orders"]))
    grand = 0.0
    for oid in ORDERS:
        grand = grand + ORDERS[oid]["total"]
    print("grand total: %s" % utils.money(grand))


# ---------------------------------------------------------------------------
# saving
# ---------------------------------------------------------------------------
def save_summary():
    if not os.path.exists(OUT_DIR):
        os.makedirs(OUT_DIR)
    data = {"orders": [], "errors": ERRORS, "stats": STATS}
    for oid in sorted(ORDERS.keys()):
        o = ORDERS[oid]
        rate = 0
        if o["region"] == "JP":
            rate = 0.10
        elif o["region"] == "EU":
            rate = 0.20
        elif o["region"] == "US":
            rate = 0.07
        else:
            rate = 0
        data["orders"].append({
            "id": o["id"],
            "customer": o["customer"],
            "region": o["region"],
            "tax_rate": rate,
            "total": o["total"],
            "points": o["points"],
        })
    f = open(os.path.join(OUT_DIR, "summary.json"), "w")
    f.write(json.dumps(data, indent=2, sort_keys=True))
    f.close()
    print("saved %s" % os.path.join(OUT_DIR, "summary.json"))


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def reset():
    global SAVE
    ORDERS.clear()
    del ERRORS[:]
    STATS["lines"] = 0
    STATS["bad"] = 0
    STATS["orders"] = 0
    SAVE = False


def main(argv):
    global SAVE
    reset()
    if len(argv) < 1:
        print("usage: python3 shop.py ORDERS.csv [--save]")
        return 2
    path = argv[0]
    if "--save" in argv:
        SAVE = True
    if not os.path.exists(path):
        print("no such file: " + path)
        return 1
    rows = read_file(path)
    process_everything(rows)
    print(utils.title("SHOP REPORT"))
    for oid in sorted(ORDERS.keys()):
        print_order(ORDERS[oid])
    print_regions()
    print_customers()
    print_errors()
    print_stats()
    if SAVE:
        save_summary()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
