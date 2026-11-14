"""核心数据结构：商品、库存批次、摊位、流水。"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Goods:
    gid: str
    name: str
    category: str
    base_cost: int      # 基准进价（分）
    base_price: int     # 基准售价（分）
    shelf_life: int     # 保质期（天）


GOODS: tuple[Goods, ...] = (
    Goods("tomato", "番茄", "果蔬", 380, 620, 4),
    Goods("cucumber", "黄瓜", "果蔬", 350, 580, 3),
    Goods("cabbage", "小白菜", "叶菜", 260, 430, 5),
    Goods("spinach", "菠菜", "叶菜", 320, 540, 3),
    Goods("carrot", "胡萝卜", "根茎", 300, 500, 12),
    Goods("potato", "土豆", "根茎", 220, 390, 14),
    Goods("apple", "苹果", "水果", 550, 900, 12),
    Goods("strawberry", "草莓", "水果", 900, 1580, 2),
)


@dataclass
class Lot:
    """一次进货形成的库存批次，先进先出，到期整批报废。"""

    gid: str
    qty: int
    unit_cost: int
    day_in: int
    shelf_life: int

    @property
    def expire_day(self) -> int:
        return self.day_in + self.shelf_life

    def freshness(self, day: int) -> float:
        """当前剩余新鲜度（0~1）：越接近保质期越低，用于顾客选购偏好。"""
        remain = self.expire_day - day
        if remain <= 0:
            return 0.0
        return min(1.0, remain / self.shelf_life)


@dataclass
class Stall:
    cash: int
    prices: dict[str, int] = field(default_factory=dict)
    inventory: dict[str, list[Lot]] = field(default_factory=dict)
    reputation: float = 3.2

    def stock(self, gid: str) -> int:
        return sum(lot.qty for lot in self.inventory.get(gid, []))

    def total_qty(self) -> int:
        return sum(lot.qty for lots in self.inventory.values() for lot in lots)

    def book_value(self) -> int:
        """库存账面价值（按进货成本计）。"""
        return sum(lot.qty * lot.unit_cost for lots in self.inventory.values() for lot in lots)

    def avg_unit_cost(self, gid: str) -> float:
        lots = self.inventory.get(gid, [])
        qty = sum(lot.qty for lot in lots)
        if qty <= 0:
            return 0.0
        return sum(lot.qty * lot.unit_cost for lot in lots) / qty


@dataclass
class Txn:
    """资金/库存流水，用于对账审计。"""

    day: int
    kind: str            # buy / sell
    gid: str
    qty: int
    unit_price: int
    cash_delta: int
    cogs: int = 0
