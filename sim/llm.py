"""真实 LLM 顾客对话接入（OpenAI 兼容 /chat/completions）。

设计原则：
- 默认关闭：没有配置 API Key 时零网络请求，完全走模板；
- 按天批量：一天一次请求，单次最多改写 8 位顾客，控制成本；
- 软失败：超时、限流、返回格式异常都会回退模板，绝不影响模拟与压测；
- 可测试：transport 可注入，单元测试不打真实网络。
"""
from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass


@dataclass
class LLMConfig:
    api_key: str
    base_url: str = "https://api.openai.com/v1"
    model: str = "gpt-4o-mini"
    timeout: float = 20.0

    @classmethod
    def from_env(cls) -> "LLMConfig | None":
        api_key = os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
        if not api_key.strip():
            return None
        return cls(
            api_key=api_key.strip(),
            base_url=os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1"),
            model=os.environ.get("LLM_MODEL", "gpt-4o-mini"),
        )


SYSTEM_PROMPT = (
    "你是《小店模拟器》的顾客台词编剧。根据顾客人设和当天购物经历，"
    "为每位顾客写 1-2 句口语化中文短句（每句不超过 20 字），要有生活气息，"
    "可以提价格、新鲜度、缺货或议价。只输出 JSON，格式为 "
    '{"顾客id": ["台词1", "台词2"]}，不要任何解释。'
)


class LLMDialogueWriter:
    def __init__(self, config: LLMConfig, budget: int = 30, transport=None):
        self.config = config
        self.budget = budget
        self.calls = 0
        self._transport = transport or self._post

    @property
    def enabled(self) -> bool:
        return self.calls < self.budget

    def rewrite_day(self, day: int, visits: list[dict], context: dict) -> dict[int, list[str]]:
        """返回 {顾客id: [台词...]}；任何异常都返回空结果，调用方回退模板。"""
        if not self.enabled or not visits:
            return {}
        self.calls += 1

        user_prompt = json.dumps(
            {
                "day": day,
                "weather": context.get("weather", ""),
                "event": context.get("event", ""),
                "reputation": context.get("reputation", 0),
                "customers": visits[:8],
            },
            ensure_ascii=False,
        )
        try:
            content = self._transport(
                [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ]
            )
        except Exception:
            return {}
        allowed = {int(item["id"]) for item in visits if "id" in item}
        return self._parse(content, allowed)

    def _parse(self, content: str, allowed: set[int] | None = None) -> dict[int, list[str]]:
        text = (content or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
        try:
            data = json.loads(text)
        except (ValueError, TypeError):
            return {}
        if not isinstance(data, dict):
            return {}

        result: dict[int, list[str]] = {}
        for key, value in data.items():
            try:
                cid = int(key)
            except (ValueError, TypeError):
                continue
            if allowed is not None and cid not in allowed:
                continue
            if isinstance(value, str):
                value = [value]
            if isinstance(value, list) and value:
                lines = [str(item).strip()[:60] for item in value[:2] if str(item).strip()]
                if lines:
                    result[cid] = lines
        return result

    def _post(self, messages: list[dict]) -> str:
        url = self.config.base_url.rstrip("/") + "/chat/completions"
        body = json.dumps(
            {
                "model": self.config.model,
                "messages": messages,
                "temperature": 0.8,
                "max_tokens": 800,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.config.api_key}",
            },
        )
        with urllib.request.urlopen(request, timeout=self.config.timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return payload["choices"][0]["message"]["content"]
