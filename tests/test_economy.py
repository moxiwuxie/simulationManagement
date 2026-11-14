"""PCG 与经营动作的单元测试。"""
from sim.economy import restock, set_prices, sell
from sim.engine import Simulation
from sim.models import GOODS, Lot, Stall
from sim.pcg import generate_day


def test_pcg_is_reproducible():
    a = generate_day(7, 3, GOODS)
    b = generate_day(7, 3, GOODS)
    c = generate_day(8, 3, GOODS)

    assert a == b
    assert (a.weather, a.supply) != (c.weather, c.supply)


def test_pcg_bounds():
    for day in range(1, 60):
        state = generate_day(2024, day, GOODS)
        assert 0.3 <= state.traffic_mult <= 2.0
        assert 0.5 <= state.market_mult <= 1.5
        assert all(qty >= 0 for qty in state.supply.values())
        assert state.weekend == (day % 7 in (6, 0))


def test_restock_respects_cash_and_supply():
    stall = Stall(cash=1_000)
    goods_map = {g.gid: g for g in GOODS}
    supply = {g.gid: 100 for g in GOODS}

    txns = restock(stall, goods_map, {"tomato": 10}, day=1, supply=supply, market_mult=1.0)

    assert len(txns) == 1
    assert txns[0].qty == 2          # 1000 分 / 380 分 = 2 份
    assert stall.cash == 1_000 - 2 * 380
    assert stall.stock("tomato") == 2


def test_prices_never_below_cost():
    stall = Stall(cash=10_000)
    goods_map = {g.gid: g for g in GOODS}
    for g in GOODS:
        stall.inventory[g.gid] = [Lot(g.gid, 5, 500, 1, g.shelf_life)]
    set_prices(stall, goods_map, {}, market_mult=1.0)

    for g in GOODS:
        assert stall.prices[g.gid] >= 500 * 1.10


def test_spoilage_removes_expired_lots():
    sim = Simulation(seed=1, keep_dialogue=False)
    sim.stall.inventory["apple"] = [Lot("apple", 5, 500, 0, 3)]

    loss, qty = sim._apply_spoilage(3)

    assert (loss, qty) == (2_500, 5)
    assert sim.stall.stock("apple") == 0


def test_lot_freshness_decays_toward_expiry():
    lot = Lot("tomato", 5, 380, 1, 4)  # day_in=1, shelf_life=4 → expire_day=5

    assert lot.freshness(1) == 1.0
    assert lot.freshness(3) == 0.5
    assert lot.freshness(4) == 0.25
    assert lot.freshness(5) == 0.0
    assert lot.freshness(6) == 0.0


def test_sell_invalid_arguments():
    import pytest

    from sim.economy import InventoryError

    stall = Stall(cash=1_000)
    stall.inventory["tomato"] = [Lot("tomato", 5, 380, 1, 4)]
    goods_map = {g.gid: g for g in GOODS}

    with pytest.raises(InventoryError):
        sell(stall, goods_map, "tomato", 0, 500, 2)
    with pytest.raises(InventoryError):
        sell(stall, goods_map, "tomato", 1, 0, 2)
