"""仿真组件模板：将本文件复制到平台的自动组件目录后使用。"""

# 创建新组件时，修改模块标识、显示名称、端口和参数，再替换 process 的计算。
# COMPONENT 必须是字面量字典，自动发现会在不导入模块的情况下读取它。
COMPONENT = {
    # 后端执行时使用的模块 ID。应唯一，省略时使用文件名（不含 .py）。
    "moduleId": "simulation_component_template",
    # 前端组件库中的模板 ID。应唯一，省略时沿用 moduleId。
    "templateId": "simulation_component_template",
    # 组件库和新建画布节点的显示名称，必填。
    "name": "示例增益组件",
    # 组件用途及计算行为的简要说明。
    "description": "输出 = 输入 × 增益；可对增益注入参数偏置。",
    # 左侧组件库的一级分组。simulation 表示仿真组件，electrical 表示电气组件。
    "group": "simulation",
    # 左侧组件库的二级菜单 ID，对应 output/public/palette-menus.json 中的 id。
    "paletteMenu": "signal-processing",
    # 组件库图标上显示的短文字，默认使用「仿」。
    "icon": "增",
    # 后端每个仿真步调用的顶层 Python 函数名，默认是 process。
    "entryFunction": "process",
    # 可选。requiresPower 控制是否为组件配置供电输入，默认 False。
    # "requiresPower": False,
    # 输入端口列表，顺序对应模型连线的输入端口索引。复数包络写法见文件末尾。
    # 左右两侧分别从上到下编号，同侧的输入和输出共用位置编号。
    "inputs": [
        {
            "portId": "signal-in",  # 稳定的端口 ID，已被模型引用时应保留。
            "varName": "signal_in",  # 输入变量名，对应入口函数的同名形参。
            "name": "输入信号",  # 界面显示的端口名称。
            "side": "left",  # 画布侧边，可填 left（左侧）或 right（右侧）。输入默认在左侧。
            "sidePosition": 1,  # 同侧位置，1 表示最上方，依次向下编号。
            "type": "number",  # 标量用 number，向量用 vector 并填写 vectorLength。
            "elementNames": ["输入幅值"],  # 可选，单元素端口在属性面板中的元素名。单路用 elementNames，向量用 vectorElementNames。
        },
        {
            "portId": "signal-in",
            "varName": "signal_in",
            "name": "射频输入",
            "side": "left",
            "sidePosition": 2,
            "type": "number",  # 单元素端口。
            "dataType": "rf_complex_envelope",  # 复数包络形式。
            "elementNames": ["接收通道"],  # 单路只填一个元素名称。
        },
    ],
    # 输出端口列表，顺序对应模型连线的输出端口索引。
    "outputs": [
        {
            "portId": "signal-out",  # 稳定的端口 ID，已被模型引用时应保留。
            "varName": "signal_out",  # 输出变量名，对应返回值中 outputs 的同名键。
            "name": "输出信号",  # 界面显示的端口名称。
            "side": "right",  # 输出默认在右侧，也可填 left 放到左侧。
            "sidePosition": 1,  # 右侧第 1 位。
            "type": "number",  # 标量用 number，向量用 vector 并填写 vectorLength。
            "elementNames": ["输出幅值"],  # 可选，单元素端口在属性面板中的元素名。
        },
        {
            "portId": "signal-in",
            "varName": "signal_in",
            "name": "四路射频输入",
            "side": "right",
            "sidePosition": 2,
            "type": "vector",  # 向量端口，传入一个包络字典列表。
            "dataType": "rf_complex_envelope",  # 列表中的每项都是一路复数包络。
            "vectorLength": 4,  # 通道路数，须为正整数。
            "vectorElementNames": ["接收通道 1", "接收通道 2", "接收通道 3", "接收通道 4"],# 可选，向量端口在属性面板中的元素名列表，长度须与 vectorLength 相同。
        },
    ],
    # 属性面板中的可调参数。字典键对应入口函数的同名形参，也是参数故障的目标键。
    "parameters": {
        "gain": {
            "name": "增益",  # 属性面板中的参数名称。
            "type": "number",  # number 接受实数，integer 只接受整数。
            "default": 2.0,  # 模型未指定该参数时使用的值，必须在取值范围内。
            "min": -10.0,  # 可选，允许值的下限，包含端点。
            "max": 10.0,  # 可选，允许值的上限，包含端点。
        },
        # 模式选择示例。启用时，在 process 中增加同名参数 mode，并按 1 或 2 执行对应逻辑。
        # "mode": {
        #     "name": "工作模式",
        #     "type": "integer",
        #     "default": 1,  # 默认值必须是下方某个选项的 value。
        #     "control": "stepper",  # 显示为可点击的按钮。省略时显示下拉框。
        #     "options": [
        #         {"value": 1, "label": "直通"},  # value 传给 process，label 显示在界面上。
        #         {"value": 2, "label": "增益"},
        #     ],
        # },
    },
    # 自定义故障槽位列表，留空即可。
    "faultSlots": [],
}


def process(signal_in, gain):
    """计算一个仿真步；参数默认值由平台根据 COMPONENT 提供。"""
    signal_out = float(signal_in) * float(gain)
    return {
        "outputs": {"signal_out": signal_out},
        "middleVars": {"applied_gain": float(gain)},
    }

# 如果想要使用内置仿真函数库可以看内置仿真函数库说明，使用相关函数，方法类似下面
# from backend.simulation_functions import map_envelopes, with_iq
# 如果想要使用自己构建的函数库，在backend文件夹下创建相应的函数py文件，命名以 _ 开头，后续命名没有要求，引用时方式类似下面
# from ._my_helpers import scale_signal 其中_my_helpers是自己创建的函数库文件名，scale_signal是自己创建的函数名


# 复数包络信号示例为 {"i": 0.8, "q": -0.2, "referenceFrequencyHz": 2.4e9, "impedanceOhm": 50, "unit": "V"}。
