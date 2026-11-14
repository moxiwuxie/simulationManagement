"""LLM 对话接入测试：不访问真实网络，全部通过注入 transport 完成。"""
import json

from sim.engine import Simulation
from sim.llm import LLMConfig, LLMDialogueWriter


def make_writer(transport, budget=5):
    return LLMDialogueWriter(LLMConfig(api_key="test-key"), budget=budget, transport=transport)


def test_parses_valid_json_and_filters_ids():
    def transport(messages):
        assert "顾客台词编剧" in messages[0]["content"]
        return json.dumps({
            "101": ["老板，番茄真新鲜。", "来两斤。"],
            "999": ["不属于本次请求"],
            "bad": ["忽略"],
            "102": "太贵了",
        }, ensure_ascii=False)

    writer = make_writer(transport)
    result = writer.rewrite_day(1, [{"id": 101}, {"id": 102}], {"weather": "晴"})

    assert result[101] == ["老板，番茄真新鲜。", "来两斤。"]
    assert result[102] == ["太贵了"]
    assert 999 not in result


def test_json_code_fence_is_tolerated():
    writer = make_writer(lambda messages: '```json\n{"7": ["好嘞"]}\n```')
    assert writer.rewrite_day(1, [{"id": 7}], {}) == {7: ["好嘞"]}


def test_bad_payload_falls_back():
    writer = make_writer(lambda messages: "抱歉，我无法完成。")
    assert writer.rewrite_day(1, [{"id": 7}], {}) == {}


def test_transport_error_falls_back():
    def boom(messages):
        raise TimeoutError("network down")

    writer = make_writer(boom)
    assert writer.rewrite_day(1, [{"id": 7}], {}) == {}


def test_budget_limits_calls():
    calls = {"n": 0}

    def transport(messages):
        calls["n"] += 1
        return json.dumps({"1": ["你好"]})

    writer = make_writer(transport, budget=1)
    assert writer.rewrite_day(1, [{"id": 1}], {}) == {1: ["你好"]}
    assert writer.rewrite_day(2, [{"id": 1}], {}) == {}
    assert calls["n"] == 1


def test_engine_applies_llm_lines():
    class StubWriter:
        def __init__(self):
            self.calls = 0

        def rewrite_day(self, day, visits, context):
            self.calls += 1
            return {visits[0]["id"]: ["AI 生成：今天的番茄真不错。"]}

    writer = StubWriter()
    sim = Simulation(seed=3, llm_writer=writer)
    sim.run(1)

    assert writer.calls == 1
    assert any("AI 生成" in line for line in sim.dialogue_log)


def test_engine_survives_writer_exception():
    class BrokenWriter:
        def rewrite_day(self, day, visits, context):
            raise RuntimeError("service exploded")

    sim = Simulation(seed=3, llm_writer=BrokenWriter())
    report = sim.run(3)

    assert report.violations == []
    assert sim.dialogue_log
