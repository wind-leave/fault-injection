"""Copy this file to add a component; keep moduleId unique."""

COMPONENT = {
    "moduleId": "auto_linear_transform",
    "name": "线性变换（自动发现）",
    "category": "自动发现组件",
    "description": "输出 = 输入 × 增益 + 偏置",
    "icon": "算",
    "inputs": [{"varName": "signal", "name": "输入信号"}],
    "outputs": [{"varName": "result", "name": "输出信号"}],
    "parameters": {
        "gain": {"name": "增益", "default": 2.0, "min": -100, "max": 100},
        "offset": {"name": "偏置", "default": 0.0, "min": -1000, "max": 1000},
    },
}


def process(signal=0.0, gain=2.0, offset=0.0):
    return {"outputs": {"result": signal * gain + offset}}
