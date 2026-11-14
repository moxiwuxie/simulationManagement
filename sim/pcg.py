"""程序化内容生成（PCG）：每日天气、行情、供给与突发事件。

同一天同一种子必定得到同一份行情，方便做「固定种子回放」与 A/B 对比。
"""
from __future__ import annotations

import random
from dataclasses import dataclass

# (名称, 权重, 客流系数, 进价系数)
WEATHERS = (
    ("晴", 0.42, 1.00, 0.96),
    ("多云", 0.28, 0.90, 1.00),
    ("小雨", 0.16, 0.76, 1.06),
    ("暴雨", 0.06, 0.50, 1.18),
    ("闷热", 0.08, 1.06, 1.02),
)

# (名称, 描述, 权重, 客流系数, 进价系数, 受益品类, 该类供给系数)
EVENTS = (
    ("无", "", 0.44, 1.00, 1.00, None, 1.00),
    ("丰收季", "本地蔬菜集中上市，进价走低", 0.10, 1.00, 0.88, "叶菜", 1.35),
    ("运输受阻", "道路管制，外地货到货减少", 0.08, 0.95, 1.15, None, 0.60),
    ("周末集市", "周末集市人流增加", 0.12, 1.30, 1.00, None, 1.00),
    ("社区团购", "隔壁小区团购分流客流", 0.08, 0.82, 0.97, None, 1.00),
    ("网红探店", "有博主发帖推荐了你的摊位", 0.06, 1.50, 1.00, None, 1.00),
    ("水果季", "应季水果大量到货", 0.07, 1.05, 0.90, "水果", 1.40),
    ("冷空气", "降温，叶菜需求上升", 0.05, 1.00, 1.06, "叶菜", 0.85),
)


@dataclass(frozen=True)
class DayState:
    day: int
    weather: str
    traffic_mult: float
    market_mult: float
    event: str
    event_desc: str
    supply: dict[str, int]
    weekend: bool


def _weighted(pool, rng: random.Random):
    total = sum(item[0] for item in pool)
    roll = rng.random() * total
    acc = 0.0
    for item in pool:
        acc += item[0]
        if roll <= acc:
            return item[1]
    return pool[-1][1]


def generate_day(seed: int, day: int, goods) -> DayState:
    rng = random.Random(f"{seed}:day:{day}")

    weather_name, _, w_traffic, w_market = _weighted_weather(rng)
    event = _weighted_event(rng)

    weekend = day % 7 in (6, 0)
    traffic_mult = w_traffic * event[3] * (1.25 if weekend else 1.0)
    market_mult = w_market * event[4]

    name, desc, _, _, _, category, cat_supply = event
    if weekend and name == "无":
        name, desc = "周末集市", "周末客流自然上涨"

    supply: dict[str, int] = {}
    for g in goods:
        base = 55.0
        if category is not None and g.category == category:
            base *= cat_supply
        supply[g.gid] = int(base * rng.uniform(0.70, 1.30))

    return DayState(
        day=day,
        weather=weather_name,
        traffic_mult=round(traffic_mult, 4),
        market_mult=round(market_mult, 4),
        event=name,
        event_desc=desc,
        supply=supply,
        weekend=weekend,
    )


def _weighted_weather(rng: random.Random):
    pool = [(w[1], w) for w in WEATHERS]
    return _weighted(pool, rng)


def _weighted_event(rng: random.Random):
    pool = [(e[2], e) for e in EVENTS]
    return _weighted(pool, rng)
