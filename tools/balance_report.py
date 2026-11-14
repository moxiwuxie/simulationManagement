"""多随机种子经营平衡回归。

用途：
    python -m tools.balance_report --days 180
    python -m tools.balance_report --days 365 --seeds 1 7 42 99 2024 --json reports/balance.json
    python -m tools.balance_report --check          # 指标越界时退出码 1，可接入 CI

压测（run_simulation）回答「账有没有平」，平衡回归回答「数值有没有跑偏」：
同一套参数在多个种子下的资产倍数、亏损天数、损耗率、成交率、缺货率、口碑
应落在可解释的区间内。任何一项越界都说明最近的改动可能破坏了经济手感。
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sim.engine import Simulation  # noqa: E402

DEFAULT_SEEDS = (1, 7, 42, 99, 2024)

# 平衡区间：低于下限说明经济过冷 / 数值失效，高于上限说明过暖 / 失控。
# 区间基于参考种子在 180 天上的中位数校准，留出约 30% 波动余量。
BALANCE_BANDS = {
    "wealth_multiple": (0.20, 12.0),
    "loss_day_ratio": (0.01, 0.55),
    "net_margin": (-0.20, 0.45),
    "spoilage_ratio": (0.002, 0.30),
    "served_rate": (0.40, 0.99),
    "stockout_rate": (0.0, 0.90),
    "bargain_rate": (0.0, 0.85),
    "reputation": (1.8, 5.0),
}

# 中位数可能掩盖单个极端种子，这些指标要求每个种子都落在更宽的区间内。
SEED_BANDS = {
    "loss_day_ratio": (0.0, 0.80),
    "net_margin": (-0.45, 0.60),
}


def metrics(report, initial_cash: int) -> dict:
    totals = report.totals
    days = max(1, report.days)
    customers = max(1, totals["customers"])
    revenue = totals["revenue"]
    goods_cost = totals["cogs"] + totals["spoilage"]
    return {
        "seed": report.seed,
        "days": report.days,
        "final_wealth": report.final_wealth,
        "wealth_multiple": round(report.final_wealth / max(1, initial_cash), 3),
        "loss_day_ratio": round(
            sum(1 for day in report.day_reports if day.profit < 0) / days, 3
        ),
        "net_margin": round(totals["profit"] / revenue, 3) if revenue else 0.0,
        "spoilage_ratio": round(totals["spoilage"] / goods_cost, 3) if goods_cost else 0.0,
        "served_rate": round(totals["served"] / customers, 3),
        "stockout_rate": round(totals["stockouts"] / customers, 3),
        "bargain_rate": round(totals["bargains"] / max(1, totals["served"]), 3),
        "reputation": report.final_reputation,
        "violations": len(report.violations),
    }


def run_sweep(seeds, days: int = 180) -> list[dict]:
    results = []
    for seed in seeds:
        sim = Simulation(seed=seed, keep_dialogue=False)
        report = sim.run(days)
        results.append(metrics(report, sim.initial_cash))
    return results


def aggregate(results: list[dict]) -> dict:
    keys = (
        "wealth_multiple", "loss_day_ratio", "net_margin", "spoilage_ratio",
        "served_rate", "stockout_rate", "bargain_rate", "reputation",
    )
    summary = {"runs": len(results), "violations": sum(r["violations"] for r in results)}
    for key in keys:
        values = [r[key] for r in results]
        summary[key] = {
            "min": round(min(values), 3),
            "median": round(statistics.median(values), 3),
            "max": round(max(values), 3),
        }
    return summary


def check_bands(summary: dict, results: list[dict] | None = None) -> list[str]:
    failures: list[str] = []
    if summary["violations"]:
        failures.append(f"违规 {summary['violations']} 条")
    for key, (low, high) in BALANCE_BANDS.items():
        median = summary[key]["median"]
        if not (low <= median <= high):
            failures.append(f"{key} 中位数 {median} 超出 [{low}, {high}]")
    for key, (low, high) in SEED_BANDS.items():
        for row in results or []:
            if not (low <= row[key] <= high):
                failures.append(f"seed {row['seed']} 的 {key} = {row[key]} 超出 [{low}, {high}]")
    return failures


def curve(runs: list[tuple[int, list]], buckets: int = 6) -> list[dict]:
    """把每个种子的资产倍数按时间分桶，取中位数，观察增长曲线形状。"""
    if not runs:
        return []
    days = len(runs[0][1])
    buckets = max(1, min(buckets, days))
    rows = []
    for index in range(buckets):
        start = index * days // buckets
        end = (index + 1) * days // buckets
        multiples = []
        margins = []
        for initial_cash, day_reports in runs:
            window = day_reports[start:end]
            if not window:
                continue
            multiples.append(window[-1].wealth / max(1, initial_cash))
            revenue = sum(day.revenue for day in window)
            profit = sum(day.profit for day in window)
            margins.append(profit / revenue if revenue else 0.0)
        rows.append({
            "range": f"D{start + 1}-D{end}",
            "wealth_multiple": round(statistics.median(multiples), 2),
            "net_margin": round(statistics.median(margins), 3),
        })
    return rows


def print_table(results: list[dict], summary: dict, buckets: list[dict]) -> None:
    print("小店模拟器 · 多随机种子平衡回归")
    print(
        f"{'seed':>5} {'资产倍数':>8} {'亏损天占比':>10} {'净利率':>8} "
        f"{'损耗率':>7} {'成交率':>7} {'缺货率':>7} {'议价率':>7} {'口碑':>5} {'!':>2}"
    )
    for row in results:
        print(
            f"{row['seed']:>5} {row['wealth_multiple']:>10} {row['loss_day_ratio']:>10} "
            f"{row['net_margin']:>8} {row['spoilage_ratio']:>7} {row['served_rate']:>7} "
            f"{row['stockout_rate']:>7} {row['bargain_rate']:>7} {row['reputation']:>5} "
            f"{row['violations']:>2}"
        )
    print("-" * 84)
    print(
        f"{'中位':>5} {summary['wealth_multiple']['median']:>10} "
        f"{summary['loss_day_ratio']['median']:>10} {summary['net_margin']['median']:>8} "
        f"{summary['spoilage_ratio']['median']:>7} {summary['served_rate']['median']:>7} "
        f"{summary['stockout_rate']['median']:>7} {summary['bargain_rate']['median']:>7} "
        f"{summary['reputation']['median']:>5} {summary['violations']:>2}"
    )
    if buckets:
        print("\n增长曲线（各种子中位数）：")
        print(f"{'区间':>10} {'资产倍数':>9} {'净利率':>8}")
        for row in buckets:
            print(f"{row['range']:>10} {row['wealth_multiple']:>9} {row['net_margin']:>8}")


def main() -> int:
    parser = argparse.ArgumentParser(description="小店模拟器 · 平衡回归")
    parser.add_argument("--days", type=int, default=180, help="每个种子的模拟天数")
    parser.add_argument("--seeds", type=int, nargs="+", default=list(DEFAULT_SEEDS), help="随机种子列表")
    parser.add_argument("--buckets", type=int, default=6, help="增长曲线分桶数")
    parser.add_argument("--json", type=str, default="", help="输出 JSON 报告路径")
    parser.add_argument("--check", action="store_true", help="指标越界时退出码 1")
    args = parser.parse_args()

    results = []
    runs = []
    for seed in args.seeds:
        sim = Simulation(seed=seed, keep_dialogue=False)
        report = sim.run(args.days)
        results.append(metrics(report, sim.initial_cash))
        runs.append((sim.initial_cash, report.day_reports))

    summary = aggregate(results)
    buckets = curve(runs, args.buckets)
    print_table(results, summary, buckets)

    failures = check_bands(summary, results)
    if failures:
        print("\n[FAIL] 平衡指标越界：")
        for item in failures:
            print(f"  - {item}")
    elif args.check:
        print("\n[PASS] 平衡指标全部落在区间内。")

    if args.json:
        path = Path(args.json)
        if not path.is_absolute():
            path = ROOT / path
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "days": args.days,
            "runs": results,
            "summary": summary,
            "curve": buckets,
            "bands": BALANCE_BANDS,
            "seed_bands": SEED_BANDS,
            "failures": failures,
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nJSON 报告已写入: {path}")

    return 1 if failures and args.check else 0


if __name__ == "__main__":
    raise SystemExit(main())
