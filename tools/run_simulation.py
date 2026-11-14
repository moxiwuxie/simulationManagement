"""N 天经营压测 CLI。

用法：
    python -m tools.run_simulation --days 365 --seed 7
    python -m tools.run_simulation --days 3000 --seed 42 --json reports/soak.json
    python -m tools.run_simulation --days 90 --notify   # 需要 FEISHU_WEBHOOK

存在违规时退出码为 1，可直接接入 CI。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sim.engine import Simulation, summarize  # noqa: E402
from sim.llm import LLMConfig, LLMDialogueWriter  # noqa: E402
from tools.notify import send_feishu  # noqa: E402

HEADER = (
    f"{'天':>4} {'天气':<4} {'事件':<8} {'顾客':>4} {'成交':>4} "
    f"{'营收':>9} {'净利':>9} {'现金':>11} {'资产':>11} {'口碑':>4} {'!':>3}"
)


def money(cents: int) -> str:
    return f"{cents / 100:,.2f}"


def row(report) -> str:
    return (
        f"{report.day:>4} {report.weather:<4} {report.event:<8} {report.customers:>4} "
        f"{report.served:>4} {money(report.revenue):>9} {money(report.profit):>9} "
        f"{money(report.cash):>11} {money(report.wealth):>11} {report.reputation:>4} "
        f"{len(report.violations):>3}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="小店模拟器 · N 天自动化经营压测")
    parser.add_argument("--days", type=int, default=365, help="模拟天数")
    parser.add_argument("--seed", type=int, default=7, help="随机种子")
    parser.add_argument("--every", type=int, default=0, help="每 N 天打印一行（0=自动）")
    parser.add_argument("--json", type=str, default="", help="输出 JSON 报告路径")
    parser.add_argument("--dialogue", action="store_true", help="打印部分顾客对话样本")
    parser.add_argument("--notify", action="store_true", help="压测结束后推送飞书通知")
    parser.add_argument("--llm", action="store_true", help="启用 LLM 生成顾客对话（需 LLM_API_KEY）")
    parser.add_argument("--llm-budget", type=int, default=30, help="本次运行最多调用 LLM 的天数")
    args = parser.parse_args()

    llm_writer = None
    if args.llm:
        llm_config = LLMConfig.from_env()
        if llm_config is None:
            print("[提示] 未检测到 LLM_API_KEY / OPENAI_API_KEY，继续使用模板对话。")
        else:
            llm_writer = LLMDialogueWriter(llm_config, budget=args.llm_budget)
            print(f"[LLM] 已启用 {llm_config.model} @ {llm_config.base_url}，"
                  f"预算 {args.llm_budget} 次，失败自动回退模板。")

    sim = Simulation(seed=args.seed, llm_writer=llm_writer)
    report = sim.run(args.days)

    print(f"小店模拟器 · PCG + AI 顾客 + 自动化压测")
    print(f"种子 {args.seed} | 周期 {args.days} 天 | 初始资金 {money(sim.initial_cash)} 元")
    print(HEADER)
    every = args.every or max(1, args.days // 15)
    for day_report in report.day_reports:
        if day_report.day == 1 or day_report.day % every == 0 or day_report.day == args.days:
            print(row(day_report))

    print("-" * len(HEADER))
    print(summarize(report))

    if report.violations:
        print(f"\n发现 {len(report.violations)} 条违规（前 10 条）：")
        for item in report.violations[:10]:
            print(f"  - {item}")
    else:
        print("\n[PASS] 全周期无违规：无负库存、无资金溢出、无凭空造钱。")

    if args.dialogue:
        print("\n对话样本：")
        for line in sim.dialogue_log[:12]:
            print(f"  {line}")

    if args.json:
        path = Path(args.json)
        if not path.is_absolute():
            path = ROOT / path
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "seed": report.seed,
            "days": report.days,
            "totals": report.totals,
            "final_cash": report.final_cash,
            "final_wealth": report.final_wealth,
            "final_reputation": report.final_reputation,
            "violations": report.violations,
            "daily": [d.__dict__ for d in report.day_reports],
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nJSON 报告已写入: {path}")

    summary_text = (
        f"小店模拟器压测完成\\n{summarize(report)}\\n"
        f"结论: {'PASS 无违规' if not report.violations else 'FAIL 存在违规'}"
    )
    if args.notify:
        ok, message = send_feishu(summary_text)
        print(f"\n飞书通知: {'已发送' if ok else '未发送'} ({message})")

    return 1 if report.violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
