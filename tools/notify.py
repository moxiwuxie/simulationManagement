"""可选飞书通知，仅依赖环境变量 FEISHU_WEBHOOK，不引入第三方库。"""
from __future__ import annotations

import json
import os
import urllib.request


def send_feishu(text: str) -> tuple[bool, str]:
    url = os.environ.get("FEISHU_WEBHOOK", "").strip()
    if not url:
        return False, "未设置环境变量 FEISHU_WEBHOOK"

    payload = json.dumps({"msg_type": "text", "content": {"text": text}}).encode("utf-8")
    request = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            body = response.read().decode("utf-8", errors="replace")
        return True, body[:200]
    except Exception as exc:  # 通知失败不应影响压测结果
        return False, f"{type(exc).__name__}: {exc}"
