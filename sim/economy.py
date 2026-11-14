"""经营动作：进货、定价、成交。

所有涉及资金的函数都直接改 Stall，并返回流水，便于引擎逐日对账。
"""
from __future__ import annotations

from sim.config import MAX_QTY
from sim.models import Lot, Stall, Txn


class InventoryError(RuntimeError):
    """库存/参数非法。引擎捕获后会记为违规，避免压测直接崩溃。"""


def sell(stall: Stall, goods_map, gid: str, qty: int, price: int, day: int) -> tuple[int, int]:
    """按先进先出卖出 qty 份，返回 (收入, 成本)。"""
    if qty <= 0:
        raise InventoryError(f"{gid} 卖出数量非法: {qty}")
    if price <= 0:
        raise InventoryError(f"{gid} 卖出单价非法: {price}")
    stock = stall.stock(gid)
    if stock < qty:
        raise InventoryError(f"{gid} 库存不足: 需要 {qty}, 实有 {stock}")

    revenue = qty * price
    remaining = qty
    cogs = 0
    kept: list[Lot] = []
    for lot in stall.inventory.get(gid, []):
        if remaining > 0 and lot.qty > 0:
            take = min(lot.qty, remaining)
            lot.qty -= take
            remaining -= take
            cogs += take * lot.unit_cost
        if lot.qty > 0:
            kept.append(lot)
    stall.inventory[gid] = kept
    stall.cash += revenue
    return revenue, cogs


def restock(stall: Stall, goods_map, needs: dict[str, int], day: int,
            supply: dict[str, int], market_mult: float) -> list[Txn]:
    """按缺口补货，受当日供给、资金与上限约束。"""
    txns: list[Txn] = []
    for gid, need in needs.items():
        if need <= 0 or gid not in goods_map:
            continue
        goods = goods_map[gid]
        unit_cost = max(1, int(round(goods.base_cost * market_mult)))
        available = supply.get(gid, 0)
        if available <= 0:
            continue
        affordable = stall.cash // unit_cost
        qty = min(need, available, affordable, MAX_QTY)
        if qty <= 0:
            continue
        cost = qty * unit_cost
        stall.cash -= cost
        stall.inventory.setdefault(gid, []).append(
            Lot(gid=gid, qty=qty, unit_cost=unit_cost, day_in=day, shelf_life=goods.shelf_life)
        )
        txns.append(Txn(day=day, kind="buy", gid=gid, qty=qty,
                        unit_price=unit_cost, cash_delta=-cost))
    return txns


def set_prices(stall: Stall, goods_map, last_day: dict[str, tuple[int, int]],
               market_mult: float) -> None:
    """自适应定价：行情、昨日售罄率、库存成本共同决定。

    last_day: {gid: (昨日销量, 昨日开摊库存)}
    """
    for gid, goods in goods_map.items():
        sold, open_stock = last_day.get(gid, (0, 0))
        sellthrough = sold / open_stock if open_stock > 0 else 0.5

        avg_cost = stall.avg_unit_cost(gid) or goods.base_cost * market_mult
        target = goods.base_price * (0.86 + 0.12 * market_mult)
        target *= 1.0 + 0.28 * (sellthrough - 0.55)

        floor = int(avg_cost * 1.10) + 10
        cap = goods.base_price * 1.9
        price = int(round(min(max(target, floor), cap)))
        stall.prices[gid] = max(1, price)
