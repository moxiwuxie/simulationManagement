"""AI 顾客短对话模板。

模板 + 状态槽位生成，零外部依赖、完全可复现；
后续接入 LLM 时只需保持这些函数签名不变。
"""
from __future__ import annotations

import random


def yuan(cents: int) -> str:
    return f"{cents / 100:.2f}".rstrip("0").rstrip(".")


_GREETINGS: dict[str, list[str]] = {
    "家庭主妇": [
        "老板，今天的菜新鲜不？",
        "给我称点菜，家里等着做饭呢。",
        "又来啦，今天有什么好的？",
    ],
    "上班族": [
        "老板快点，我赶时间。",
        "有什么能直接拿走的？",
        "随便装一点，我上班要迟到了。",
    ],
    "学生": [
        "老板好，我看看有什么便宜的。",
        "这个多少钱呀？",
        "有没有打折的？",
    ],
    "老顾客": [
        "老样子，还是你这儿靠谱。",
        "又来了，给我留点好的。",
        "老板，今天进的什么货？",
    ],
    "美食博主": [
        "听说你家菜不错，我来拍一下。",
        "老板，有适合做沙拉的食材吗？",
        "这颜色真好看，可以拍吗？",
    ],
    "健身达人": [
        "有高蛋白低热量的吗？",
        "给我来点能生吃的。",
        "今天想配个健身餐。",
    ],
}

_STOCKOUT = [
    "{name}怎么卖完啦？",
    "想买点{name}，没了？",
    "下次多进点{name}呗。",
]

_TOO_EXPENSIVE = [
    "{name}卖{price}？有点贵了。",
    "{price}一份？我再逛逛。",
    "{name}这个价，买不下手啊。",
]

_BARGAIN = [
    "{name}卖{price}？{offer}卖不卖？",
    "老板，{name}便宜到{offer}行不行？",
    "{price}太贵了，{offer}我多拿几份。",
]

_BARGAIN_OK = [
    "行，{name}给我来点。",
    "成交，老板爽快。",
    "那就这么定了，{name}来两份。",
]

_BARGAIN_NO = [
    "那算了，我再看看。",
    "还是有点贵，下次吧。",
    "不行啊，那我先不买了。",
]

_THANKS = [
    "谢谢老板，下次还来。",
    "好嘞，走了啊。",
    "老板人不错。",
    "扫码付了，收好啦。",
]

_REVIEWS = {
    "bad": [
        "不太满意，价格和新鲜度都一般。",
        "体验一般，可能不会常来。",
        "有点失望，东西不全。",
    ],
    "mid": [
        "还行吧，中规中矩。",
        "价格可以接受，下次再看。",
        "就那样，没什么特别的。",
    ],
    "good": [
        "菜挺新鲜的，价格也公道。",
        "老板会做生意，下次还来。",
        "买得挺舒服，推荐。",
    ],
    "great": [
        "太满意了！新鲜又便宜，五星好评。",
        "这家摊子我认了，闭眼买。",
        "老板人好货也好，必须推荐给朋友。",
    ],
}


def greeting(customer, rng: random.Random) -> str:
    return rng.choice(_GREETINGS[customer.archetype])


def stockout(good_name: str, rng: random.Random) -> str:
    return rng.choice(_STOCKOUT).format(name=good_name)


def too_expensive(customer, good_name: str, price: int, rng: random.Random) -> str:
    line = rng.choice(_TOO_EXPENSIVE)
    return line.format(name=good_name, price=yuan(price))


def bargain(customer, good_name: str, price: int, offer: int, rng: random.Random) -> str:
    line = rng.choice(_BARGAIN)
    return line.format(name=good_name, price=yuan(price), offer=yuan(offer))


def bargain_ok(customer, good_name: str, rng: random.Random) -> str:
    return rng.choice(_BARGAIN_OK).format(name=good_name)


def bargain_no(customer, good_name: str, rng: random.Random) -> str:
    return rng.choice(_BARGAIN_NO).format(name=good_name)


def thanks(customer, rng: random.Random) -> str:
    return rng.choice(_THANKS)


def review(customer, rating: float, rng: random.Random) -> str:
    if rating < 2.5:
        bucket = "bad"
    elif rating < 3.5:
        bucket = "mid"
    elif rating < 4.5:
        bucket = "good"
    else:
        bucket = "great"
    return rng.choice(_REVIEWS[bucket])
