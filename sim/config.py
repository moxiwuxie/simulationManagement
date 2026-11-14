"""全局配置与安全边界。

金额统一使用「分」为整数单位，避免浮点误差导致的账务漂移。
"""

# 资金上限（分）：10 亿分 = 1000 万元，超过即视为数值溢出
MAX_CASH_CENTS = 10 ** 11
# 单日资金净增长上限（分）：超过视为「无限刷钱」嫌疑
MAX_DAY_CASH_GAIN = 5_000_000
# 单个货品库存上限
MAX_QTY = 10_000
# 单价上限（分）
MAX_PRICE_CENTS = 10 ** 7
# 初始资金：800 元
INITIAL_CASH_CENTS = 80_000
# 每日固定租金（分）：120 元/天，构成经营压力
DAILY_RENT_CENTS = 12_000
# 基础客流（人/天）
BASE_TRAFFIC = 16
# 每个商品的目标库存
TARGET_STOCK = 16
# 每日顾客数硬上限，防止异常行情把内存打爆
MAX_CUSTOMERS_PER_DAY = 200
