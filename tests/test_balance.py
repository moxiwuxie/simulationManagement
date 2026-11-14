"""平衡回归：参考种子下，关键手感指标应落在可解释区间。

与 test_invariants 的分工：
- 不变量测试保证「账平、不造钱」；
- 平衡测试保证「不冷不热」——亏损日、损耗、成交率、口碑没有跑偏。
"""
from tools.balance_report import aggregate, check_bands, run_sweep


def test_reference_seeds_stay_in_balance_bands():
    results = run_sweep([7, 42], days=90)

    assert check_bands(aggregate(results), results) == []


def test_metrics_cover_every_report():
    results = run_sweep([2024], days=30)

    row = results[0]
    assert row["days"] == 30
    assert row["violations"] == 0
    assert 0.0 <= row["loss_day_ratio"] <= 1.0
    assert 0.0 <= row["served_rate"] <= 1.0
    assert 1.0 <= row["reputation"] <= 5.0
