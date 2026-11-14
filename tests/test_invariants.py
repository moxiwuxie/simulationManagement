"""长周期不变量测试：任何一天都不允许出现负库存、资金溢出、凭空造钱。"""
import pytest

from sim import config
from sim.engine import Simulation


@pytest.mark.parametrize("seed", [1, 7, 42, 99, 2024])
def test_365_days_clean(seed):
    sim = Simulation(seed=seed, keep_dialogue=False)
    report = sim.run(365)

    assert report.violations == [], report.violations[:5]
    assert sim.stall.cash >= 0
    assert 1.0 <= sim.stall.reputation <= 5.0
    for day in report.day_reports:
        assert day.profit == day.revenue - day.cogs - day.spoilage - day.rent_paid
        assert day.sold_qty >= 0 and day.revenue >= 0
        assert 1.0 <= day.avg_rating <= 5.0


def test_3000_days_no_overflow():
    sim = Simulation(seed=5, keep_dialogue=False)
    report = sim.run(3000)

    assert report.violations == [], report.violations[:5]
    assert sim.stall.cash <= config.MAX_CASH_CENTS
    assert sim.stall.total_qty() <= config.MAX_QTY * len(sim.goods)
    assert all(price <= config.MAX_PRICE_CENTS for price in sim.stall.prices.values())


def test_wealth_identity_holds_end_to_end():
    sim = Simulation(seed=11, initial_cash=123_456, keep_dialogue=False)
    report = sim.run(200)

    expected = (
        sim.initial_cash
        + report.totals["revenue"]
        - report.totals["cogs"]
        - report.totals["spoilage"]
        - report.totals["rent"]
    )
    assert sim.stall.cash + sim.stall.book_value() == expected


def test_dialogue_and_reviews_are_generated():
    sim = Simulation(seed=3)
    report = sim.run(60)

    assert sim.dialogue_log
    assert report.totals["customers"] > 0
    assert report.totals["bargains"] > 0
    assert any("老板" in line or "谢谢" in line for line in sim.dialogue_log)


def test_balance_has_real_pressure():
    sim = Simulation(seed=2024, keep_dialogue=False)
    report = sim.run(365)

    # 租金必须逐日入账
    assert report.totals["rent"] == 365 * config.DAILY_RENT_CENTS
    # 一年经营不该毫无压力：必须出现亏损日
    assert sum(1 for day in report.day_reports if day.profit < 0) >= 10
    # 也不该指数爆炸（初始资金的 30 倍以内）
    assert report.final_wealth < sim.initial_cash * 30
