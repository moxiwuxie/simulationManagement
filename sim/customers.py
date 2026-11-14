"""AI 顾客 Agent：偏好、预算、议价、评价与短对话。

每个顾客是独立决策体：
1. 按品类偏好 + 性价比给货架打分，最多逛 3 个货位；
2. 用「心理价位」判断是否购买，价格略高时可能议价；
3. 离店时给出一句评价，评价会影响摊位口碑与后续客流。
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

from sim import dialogue
from sim.economy import sell

ARCHETYPES = (
    {
        "name": "家庭主妇", "weight": 0.24, "budget": (2500, 6000),
        "sens": (0.55, 0.80), "patience": (0.50, 0.90), "sociability": (0.60, 0.95),
        "bulk": 0.55, "affinity": {"叶菜": 1.25, "根茎": 1.20, "果蔬": 1.10, "水果": 1.00},
    },
    {
        "name": "上班族", "weight": 0.20, "budget": (3000, 8000),
        "sens": (0.35, 0.65), "patience": (0.15, 0.45), "sociability": (0.25, 0.60),
        "bulk": 0.30, "affinity": {"果蔬": 1.15, "水果": 1.10},
    },
    {
        "name": "学生", "weight": 0.18, "budget": (1200, 3000),
        "sens": (0.70, 0.95), "patience": (0.50, 0.90), "sociability": (0.50, 0.95),
        "bulk": 0.35, "affinity": {"水果": 1.30, "果蔬": 1.00},
    },
    {
        "name": "老顾客", "weight": 0.16, "budget": (2500, 6000),
        "sens": (0.35, 0.60), "patience": (0.70, 1.00), "sociability": (0.70, 1.00),
        "bulk": 0.50, "affinity": {"叶菜": 1.30, "根茎": 1.25},
    },
    {
        "name": "美食博主", "weight": 0.10, "budget": (6000, 15000),
        "sens": (0.15, 0.40), "patience": (0.40, 0.80), "sociability": (0.85, 1.00),
        "bulk": 0.40, "affinity": {"水果": 1.35, "果蔬": 1.30},
    },
    {
        "name": "健身达人", "weight": 0.12, "budget": (3500, 9000),
        "sens": (0.30, 0.60), "patience": (0.50, 0.85), "sociability": (0.40, 0.75),
        "bulk": 0.50, "affinity": {"根茎": 1.30, "水果": 1.20, "叶菜": 1.15},
    },
)

NAME_POOL = (
    "阿珍", "小李", "王阿姨", "陈叔", "小林", "赵老师", "乐乐", "阿芳",
    "大刘", "楠楠", "周姐", "老许", "钱师傅", "小陶", "阿凯", "果果",
    "张姨", "孙哥", "苗苗", "何同学",
)


@dataclass
class Customer:
    cid: int
    name: str
    archetype: str
    budget: int
    sensitivity: float
    patience: float
    sociability: float
    bulk_bias: float
    affinity: dict[str, float] = field(default_factory=dict)

    def willing_mult(self) -> float:
        """价格敏感度映射为心理价位倍率：敏感的人只肯出 0.75 倍，不敏感的可到 1.17 倍。"""
        return 1.24 - 0.55 * self.sensitivity


@dataclass
class Visit:
    customer: Customer
    bought_qty: int
    spent: int
    cogs: int
    bargains: int
    stockouts: int
    rating: float
    dialogue: list[str]
    sales: list[tuple[str, int, int, int]] = field(default_factory=list)


def spawn_customers(rng: random.Random, day: int, count: int) -> list[Customer]:
    customers: list[Customer] = []
    for i in range(count):
        arch = _pick_archetype(rng)
        affinity = {}
        for cat in ("叶菜", "根茎", "果蔬", "水果"):
            base = arch["affinity"].get(cat, 1.0)
            affinity[cat] = round(base * rng.uniform(0.92, 1.10), 3)
        customers.append(
            Customer(
                cid=day * 1000 + i,
                name=rng.choice(NAME_POOL),
                archetype=arch["name"],
                budget=rng.randint(*arch["budget"]),
                sensitivity=rng.uniform(*arch["sens"]),
                patience=rng.uniform(*arch["patience"]),
                sociability=rng.uniform(*arch["sociability"]),
                bulk_bias=arch["bulk"],
                affinity=affinity,
            )
        )
    return customers


def shop(customer: Customer, stall, goods_map, day: int, rng: random.Random) -> Visit:
    lines: list[str] = []
    bought = spent = cogs = bargains = stockouts = declines = 0
    sales: list[tuple[str, int, int, int]] = []
    fairness: list[float] = []

    if rng.random() < customer.sociability:
        lines.append(dialogue.greeting(customer, rng))

    budget = customer.budget
    candidates: list[tuple[float, object]] = []
    reported_categories: set[str] = set()

    for goods in goods_map.values():
        if stall.stock(goods.gid) <= 0:
            if goods.category not in reported_categories and rng.random() < 0.45:
                reported_categories.add(goods.category)
                lines.append(dialogue.stockout(goods.name, rng))
                stockouts += 1
            continue
        price = stall.prices[goods.gid]
        affinity = customer.affinity.get(goods.category, 1.0)
        value = goods.base_price / max(1, price)
        # 新鲜度影响选购：最早售出的那批越新鲜越愿意买，临期货会被挑剩下
        lots = stall.inventory.get(goods.gid, [])
        freshness = lots[0].freshness(day) if lots else 1.0
        fresh_bonus = 0.75 + 0.25 * freshness
        score = affinity * (value ** 1.4) * fresh_bonus * rng.uniform(0.80, 1.20)
        candidates.append((score, goods))

    candidates.sort(key=lambda item: item[0], reverse=True)

    for _, goods in candidates[:3]:
        if budget <= 0:
            break
        price = stall.prices[goods.gid]
        affinity = customer.affinity.get(goods.category, 1.0)
        willing = max(1, int(round(goods.base_price * affinity * customer.willing_mult())))

        qty_wanted = 1 + int(rng.random() < customer.bulk_bias) + int(rng.random() < customer.bulk_bias * 0.6)
        qty_wanted = min(qty_wanted, stall.stock(goods.gid), budget // max(1, price))
        if qty_wanted <= 0:
            continue

        final_price = price
        if price > willing:
            may_bargain = price <= int(willing * 1.35) and customer.patience > 0.40
            if not may_bargain:
                lines.append(dialogue.too_expensive(customer, goods.name, price, rng))
                declines += 1
                continue
            offer = willing
            lines.append(dialogue.bargain(customer, goods.name, price, offer, rng))
            avg_cost = stall.avg_unit_cost(goods.gid) or goods.base_cost
            accept = offer >= avg_cost * 1.05 and rng.random() < 0.45 + 0.40 * customer.patience
            if not accept:
                lines.append(dialogue.bargain_no(customer, goods.name, rng))
                declines += 1
                continue
            final_price = offer
            bargains += 1
            lines.append(dialogue.bargain_ok(customer, goods.name, rng))

        revenue, lot_cogs = sell(stall, goods_map, goods.gid, qty_wanted, final_price, day)
        bought += qty_wanted
        spent += revenue
        cogs += lot_cogs
        budget -= revenue
        sales.append((goods.gid, qty_wanted, final_price, lot_cogs))
        fairness.append(willing / max(1, final_price))

    rating = 3.0
    if bought:
        rating += 0.35
    if fairness:
        avg_fair = sum(fairness) / len(fairness)
        rating += max(-0.90, min(0.50, 0.90 * (avg_fair - 1.0)))
    if bargains:
        rating += 0.15
    rating -= 0.45 * stockouts
    rating -= 0.25 * min(2, declines)
    rating = round(min(5.0, max(1.0, rating)), 2)

    if bought:
        lines.append(dialogue.thanks(customer, rng))
    lines.append(dialogue.review(customer, rating, rng))

    return Visit(
        customer=customer,
        bought_qty=bought,
        spent=spent,
        cogs=cogs,
        bargains=bargains,
        stockouts=stockouts,
        rating=rating,
        dialogue=lines,
        sales=sales,
    )


def _pick_archetype(rng: random.Random) -> dict:
    total = sum(a["weight"] for a in ARCHETYPES)
    roll = rng.random() * total
    acc = 0.0
    for arch in ARCHETYPES:
        acc += arch["weight"]
        if roll <= acc:
            return arch
    return ARCHETYPES[-1]
