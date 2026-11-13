# legacy.py - old pricing code, kept "just in case"
# Nothing imports this file.

def old_price(price, qty):
    total = price * qty
    if qty > 10:
        total = total * 0.9
    return total


def old_tax(region, amount):
    if region == "JP":
        return amount * 0.08
    if region == "EU":
        return amount * 0.19
    return 0


def old_shipping(weight):
    if weight < 2:
        return 4
    return 12
