# utils.py - small helpers for the shop report
# (imports shop back for the tax table: an import cycle, on purpose)

import shop


def money(x):
    if x < 0:
        return "-$%.2f" % (-x)
    return "$%.2f" % x


def line(n):
    return "-" * n


def title(t):
    return line(44) + "\n" + t.center(44) + "\n" + line(44)


def tax_rate(region):
    # same table as shop.TAX_RATES, read through the cycle
    return shop.TAX_RATES.get(region, 0)


def percent(x):
    return "%d%%" % int(round(x * 100))
