"""检测器自测：故意注入 BUG，验证压测脚本真的能抓到。

这组测试保证「检测器本身不是摆设」。
"""
import pytest

import sim.engine as engine_mod
from sim import config
from sim.engine import Simulation
from sim.economy import InventoryError, sell
from sim.models import GOODS, Lot


def test_negative_stock_is_detected():
    sim = Simulation(seed=1, keep_dialogue=False)
    sim.step()
    sim.stall.inventory["tomato"] = [Lot("tomato", -5, 380, sim.day, 4)]

    codes = [code for code, _ in sim._check_state()]
    assert "NEGATIVE_STOCK" in codes


def test_cash_overflow_is_detected():
    sim = Simulation(seed=1, keep_dialogue=False)
    sim.step()
    sim.stall.cash = config.MAX_CASH_CENTS + 1

    codes = [code for code, _ in sim._check_state()]
    assert "CASH_OVERFLOW" in codes


def test_phantom_money_is_detected():
    sim = Simulation(seed=4, keep_dialogue=False)
    sim.step()

    cash_open = sim.stall.cash
    qty_open = sim.stall.total_qty()
    wealth_open = cash_open + sim.stall.book_value()
    sim.stall.cash += 10_000_000  # 注入一笔没有流水来源的钱

    issues = sim._audit_day(
        day=sim.day,
        cash_open=cash_open,
        wealth_open=wealth_open,
        wealth_close=sim.stall.cash + sim.stall.book_value(),
        spoiled_value=0,
        rent_paid=0,
        gross_margin=0,
        qty_open=qty_open,
        purchased_qty=0,
        sold_qty=0,
        spoiled_qty=0,
        qty_close=sim.stall.total_qty(),
        purchase_cost=0,
        revenue=0,
    )
    codes = [code for code, _ in issues]
    assert "LEAK" in codes
    assert "LEDGER_MISMATCH" in codes
    assert "CASH_SPIKE" in codes


def test_sell_beyond_stock_raises():
    sim = Simulation(seed=2, keep_dialogue=False)
    sim.step()
    with pytest.raises(InventoryError):
        sell(sim.stall, sim.goods_map, "tomato", 10 ** 6, 100, sim.day)


def test_engine_records_oversold_instead_of_crashing(monkeypatch):
    def buggy_shop(customer, stall, goods_map, day, rng):
        sell(stall, goods_map, "tomato", 9_999, 100, day)

    monkeypatch.setattr(engine_mod, "shop", buggy_shop)
    sim = Simulation(seed=6, keep_dialogue=False)
    report = sim.run(2)

    assert any("OVERSOLD" in item for item in report.violations)


def test_cash_spike_threshold_triggers(monkeypatch):
    monkeypatch.setattr(engine_mod, "MAX_DAY_CASH_GAIN", 1)
    sim = Simulation(seed=8, keep_dialogue=False)
    report = sim.run(20)

    assert any("CASH_SPIKE" in item for item in report.violations)


def test_fifo_and_money_consistency():
    from sim.models import Stall

    stall = Stall(cash=10_000)
    stall.inventory["tomato"] = [
        Lot("tomato", 3, 100, 1, 10),
        Lot("tomato", 3, 200, 1, 10),
    ]
    revenue, cogs = sell(stall, {"tomato": GOODS[0]}, "tomato", 4, 500, 2)

    assert revenue == 2_000
    assert cogs == 3 * 100 + 1 * 200
    assert stall.stock("tomato") == 2
    assert stall.cash == 12_000
