"""经营引擎：逐日循环 + 账务/库存审计 + 违规收集。

设计要点：
- 金额、库存全部用整数，账务每日做恒等式对账（现金 + 库存账面价值）；
- 任何异常都不让压测崩掉，而是记成违规，最后统一判定；
- 固定种子完全可复现，便于定位 BUG。
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from sim.config import (
    BASE_TRAFFIC,
    DAILY_RENT_CENTS,
    INITIAL_CASH_CENTS,
    MAX_CASH_CENTS,
    MAX_CUSTOMERS_PER_DAY,
    MAX_DAY_CASH_GAIN,
    MAX_PRICE_CENTS,
    MAX_QTY,
    TARGET_STOCK,
)
from sim.customers import spawn_customers, shop
from sim.economy import InventoryError, restock, set_prices
from sim.models import GOODS, Lot, Stall, Txn
from sim.pcg import DayState, generate_day


@dataclass
class DayReport:
    day: int
    weather: str
    event: str
    customers: int
    served: int
    sold_qty: int
    revenue: int
    cogs: int
    purchases: int
    rent_paid: int
    spoilage: int
    profit: int
    cash: int
    inventory_value: int
    wealth: int
    reputation: float
    avg_rating: float
    bargains: int
    stockouts: int
    violations: list[str] = field(default_factory=list)


@dataclass
class RunReport:
    seed: int
    days: int
    day_reports: list[DayReport]
    violations: list[str]
    totals: dict
    final_cash: int
    final_wealth: int
    final_reputation: float


class Simulation:
    def __init__(self, seed: int = 7, initial_cash: int = INITIAL_CASH_CENTS,
                 base_traffic: int = BASE_TRAFFIC, keep_dialogue: bool = True,
                 llm_writer=None):
        self.seed = seed
        self.base_traffic = base_traffic
        self.keep_dialogue = keep_dialogue
        self.llm_writer = llm_writer
        self.goods = GOODS
        self.goods_map = {g.gid: g for g in GOODS}
        self.stall = Stall(cash=initial_cash)
        self.initial_cash = initial_cash
        self.day = 0
        self.violations: list[str] = []
        self.dialogue_log: list[str] = []
        self.history: list[DayReport] = []
        self.last_day_stats: dict[str, tuple[int, int]] = {}
        self.totals = {
            "customers": 0,
            "served": 0,
            "sold_qty": 0,
            "revenue": 0,
            "cogs": 0,
            "purchases": 0,
            "rent": 0,
            "spoilage": 0,
            "profit": 0,
            "bargains": 0,
            "stockouts": 0,
        }
        for g in GOODS:
            self.stall.prices[g.gid] = g.base_price

    # ------------------------------------------------------------------ 主循环
    def step(self) -> DayReport:
        self.day += 1
        day = self.day
        pcg: DayState = generate_day(self.seed, day, self.goods)
        agent_rng = random.Random(f"{self.seed}:agents:{day}")

        cash_open = self.stall.cash
        qty_open = self.stall.total_qty()
        wealth_open = self.stall.cash + self.stall.book_value()
        open_stock = {g.gid: self.stall.stock(g.gid) for g in self.goods}

        rent_paid = min(self.stall.cash, DAILY_RENT_CENTS)
        self.stall.cash -= rent_paid
        if rent_paid < DAILY_RENT_CENTS:
            self.stall.reputation = max(1.0, self.stall.reputation - 0.3)

        spoiled_value, spoiled_qty = self._apply_spoilage(day)

        needs = {g.gid: max(0, TARGET_STOCK - self.stall.stock(g.gid)) for g in self.goods}
        purchase_txns = restock(
            self.stall, self.goods_map, needs, day, pcg.supply, pcg.market_mult
        )
        purchase_cost = -sum(t.cash_delta for t in purchase_txns)
        purchased_qty = sum(t.qty for t in purchase_txns)

        set_prices(self.stall, self.goods_map, self.last_day_stats, pcg.market_mult)

        traffic = self.base_traffic * pcg.traffic_mult * (0.45 + self.stall.reputation / 5 * 0.85)
        count = min(
            MAX_CUSTOMERS_PER_DAY,
            max(1, int(round(traffic * agent_rng.uniform(0.85, 1.15)))),
        )
        customers = spawn_customers(agent_rng, day, count)

        revenue = cogs = sold_qty = served = bargains = stockouts = 0
        ratings: list[float] = []
        sales_txns: list[Txn] = []
        sold_by_gid: dict[str, int] = {}
        visit_pairs: list[tuple] = []

        for customer in customers:
            try:
                visit = shop(customer, self.stall, self.goods_map, day, agent_rng)
            except InventoryError as exc:  # 防御：成交越界也只会记违规，不中断压测
                self._add_violation(day, "OVERSOLD", str(exc))
                continue

            revenue += visit.spent
            cogs += visit.cogs
            sold_qty += visit.bought_qty
            bargains += visit.bargains
            stockouts += visit.stockouts
            if visit.bought_qty:
                served += 1
            ratings.append(visit.rating)

            visit_pairs.append((customer, visit))

            for gid, qty, price, lot_cogs in visit.sales:
                sales_txns.append(
                    Txn(day=day, kind="sell", gid=gid, qty=qty,
                        unit_price=price, cash_delta=qty * price, cogs=lot_cogs)
                )
                sold_by_gid[gid] = sold_by_gid.get(gid, 0) + qty

        self._apply_llm_dialogue(day, visit_pairs, pcg)

        if self.keep_dialogue:
            for customer, visit in visit_pairs:
                if len(self.dialogue_log) >= 400:
                    break
                self.dialogue_log.extend(
                    f"D{day} {customer.name}({customer.archetype}): {line}"
                    for line in visit.dialogue
                )

        avg_rating = sum(ratings) / len(ratings) if ratings else self.stall.reputation
        self.stall.reputation = min(5.0, max(1.0, 0.85 * self.stall.reputation + 0.15 * avg_rating))

        gross_margin = revenue - cogs
        profit = gross_margin - spoiled_value - rent_paid
        wealth_close = self.stall.cash + self.stall.book_value()
        qty_close = self.stall.total_qty()

        day_violations = self._audit_day(
            day=day,
            cash_open=cash_open,
            wealth_open=wealth_open,
            wealth_close=wealth_close,
            spoiled_value=spoiled_value,
            rent_paid=rent_paid,
            gross_margin=gross_margin,
            qty_open=qty_open,
            purchased_qty=purchased_qty,
            sold_qty=sold_qty,
            spoiled_qty=spoiled_qty,
            qty_close=qty_close,
            purchase_cost=purchase_cost,
            revenue=revenue,
        )
        for code, detail in day_violations:
            self._add_violation(day, code, detail)

        self.last_day_stats = {
            g.gid: (sold_by_gid.get(g.gid, 0), open_stock[g.gid]) for g in self.goods
        }

        report = DayReport(
            day=day,
            weather=pcg.weather,
            event=pcg.event,
            customers=len(customers),
            served=served,
            sold_qty=sold_qty,
            revenue=revenue,
            cogs=cogs,
            purchases=purchase_cost,
            rent_paid=rent_paid,
            spoilage=spoiled_value,
            profit=profit,
            cash=self.stall.cash,
            inventory_value=self.stall.book_value(),
            wealth=wealth_close,
            reputation=round(self.stall.reputation, 2),
            avg_rating=round(avg_rating, 2),
            bargains=bargains,
            stockouts=stockouts,
            violations=[f"{code}: {detail}" for code, detail in day_violations],
        )
        self.history.append(report)

        for key in ("customers", "served", "sold_qty", "revenue", "cogs",
                    "purchases", "rent", "spoilage", "profit", "bargains", "stockouts"):
            value = report.rent_paid if key == "rent" else getattr(report, key)
            self.totals[key] += value
        return report

    def run(self, days: int) -> RunReport:
        for _ in range(days):
            self.step()
        return RunReport(
            seed=self.seed,
            days=days,
            day_reports=list(self.history),
            violations=list(self.violations),
            totals=dict(self.totals),
            final_cash=self.stall.cash,
            final_wealth=self.stall.cash + self.stall.book_value(),
            final_reputation=round(self.stall.reputation, 2),
        )

    # ------------------------------------------------------------------ 内部
    def _apply_llm_dialogue(self, day: int, visit_pairs: list, pcg: DayState) -> None:
        """用 LLM 改写当天部分顾客台词；失败则保留模板台词。"""
        if self.llm_writer is None or not visit_pairs:
            return
        brief = [
            {
                "id": customer.cid,
                "name": customer.name,
                "archetype": customer.archetype,
                "bought_qty": visit.bought_qty,
                "spent_yuan": round(visit.spent / 100, 2),
                "bargains": visit.bargains,
                "stockouts": visit.stockouts,
                "rating": visit.rating,
            }
            for customer, visit in visit_pairs[:8]
        ]
        try:
            rewritten = self.llm_writer.rewrite_day(
                day,
                brief,
                {
                    "weather": pcg.weather,
                    "event": pcg.event,
                    "reputation": round(self.stall.reputation, 2),
                },
            )
        except Exception:  # 对话服务异常绝不影响经营模拟
            return
        for customer, visit in visit_pairs:
            lines = rewritten.get(customer.cid)
            if lines:
                visit.dialogue = lines

    def _apply_spoilage(self, day: int) -> tuple[int, int]:
        loss = qty = 0
        for gid, lots in self.stall.inventory.items():
            kept: list[Lot] = []
            for lot in lots:
                if lot.expire_day <= day:
                    loss += lot.qty * lot.unit_cost
                    qty += lot.qty
                else:
                    kept.append(lot)
            self.stall.inventory[gid] = kept
        return loss, qty

    def _audit_day(self, *, day: int, cash_open: int, wealth_open: int, wealth_close: int,
                   spoiled_value: int, rent_paid: int, gross_margin: int, qty_open: int,
                   purchased_qty: int, sold_qty: int, spoiled_qty: int, qty_close: int,
                   purchase_cost: int, revenue: int) -> list[tuple[str, str]]:
        issues: list[tuple[str, str]] = []

        expected_wealth = wealth_open - spoiled_value - rent_paid + gross_margin
        if wealth_close != expected_wealth:
            issues.append((
                "LEAK",
                f"资产不平: 收盘 {wealth_close} != 期初 {wealth_open} - 损耗 {spoiled_value} "
                f"- 租金 {rent_paid} + 毛利 {gross_margin} = {expected_wealth}",
            ))

        expected_qty = qty_open + purchased_qty - sold_qty - spoiled_qty
        if qty_close != expected_qty:
            issues.append((
                "QTY_MISMATCH",
                f"库存不守恒: 收盘 {qty_close} != {qty_open} + 进货 {purchased_qty} "
                f"- 卖出 {sold_qty} - 损耗 {spoiled_qty} = {expected_qty}",
            ))

        expected_cash = cash_open - purchase_cost - rent_paid + revenue
        if self.stall.cash != expected_cash:
            issues.append((
                "LEDGER_MISMATCH",
                f"现金流水不平: 收盘 {self.stall.cash} != 期初 {cash_open} "
                f"- 进货 {purchase_cost} - 租金 {rent_paid} + 收入 {revenue} = {expected_cash}",
            ))

        day_gain = self.stall.cash - cash_open
        if day_gain > MAX_DAY_CASH_GAIN:
            issues.append((
                "CASH_SPIKE",
                f"单日资金增长 {day_gain} 分，超过安全阈值 {MAX_DAY_CASH_GAIN}，疑似无限刷钱",
            ))

        issues.extend(self._check_state())
        return issues

    def _check_state(self) -> list[tuple[str, str]]:
        """结构性不变量：任何时候都应成立。"""
        issues: list[tuple[str, str]] = []
        cash = self.stall.cash

        if cash < 0:
            issues.append(("CASH_NEGATIVE", f"现金为负: {cash}"))
        if cash > MAX_CASH_CENTS:
            issues.append(("CASH_OVERFLOW", f"现金溢出: {cash} > {MAX_CASH_CENTS}"))

        for gid, lots in self.stall.inventory.items():
            for lot in lots:
                if lot.qty < 0:
                    issues.append(("NEGATIVE_STOCK", f"{gid} 批次库存为负: {lot.qty}"))
                if lot.qty > MAX_QTY:
                    issues.append(("LOT_OVERFLOW", f"{gid} 批次库存溢出: {lot.qty}"))
                if lot.unit_cost <= 0:
                    issues.append(("INVALID_COST", f"{gid} 进货成本非法: {lot.unit_cost}"))

        for gid, price in self.stall.prices.items():
            if price <= 0 or price > MAX_PRICE_CENTS:
                issues.append(("PRICE_INVALID", f"{gid} 售价非法: {price}"))

        if not math.isfinite(self.stall.reputation) or not (1.0 <= self.stall.reputation <= 5.0):
            issues.append(("REP_INVALID", f"口碑越界: {self.stall.reputation}"))

        return issues

    def _add_violation(self, day: int, code: str, detail: str) -> None:
        self.violations.append(f"D{day} [{code}] {detail}")

    # ------------------------------------------------------------------ 展示
    @staticmethod
    def fmt_money(cents: int) -> str:
        return f"{cents / 100:,.2f}"


def summarize(report: RunReport) -> str:
    t = report.totals
    lines = [
        f"种子 {report.seed} | 周期 {report.days} 天",
        f"顾客 {t['customers']} 人 | 成交 {t['served']} 人 | 售出 {t['sold_qty']} 份",
        f"营收 {t['revenue'] / 100:,.2f} 元 | 毛利 {(t['revenue'] - t['cogs']) / 100:,.2f} 元"
        f" | 损耗 {t['spoilage'] / 100:,.2f} 元 | 租金 {t['rent'] / 100:,.2f} 元"
        f" | 净利 {t['profit'] / 100:,.2f} 元",
        f"期末现金 {report.final_cash / 100:,.2f} 元 | 期末资产 {report.final_wealth / 100:,.2f} 元"
        f" | 口碑 {report.final_reputation}",
        f"议价 {t['bargains']} 次 | 缺货 {t['stockouts']} 次 | 违规 {len(report.violations)} 条",
    ]
    return "\n".join(lines)
