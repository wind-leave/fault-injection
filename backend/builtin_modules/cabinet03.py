def process(socket03=0.0):
    """机柜3：对单路输入施加 2% 的线路损耗。"""
    return {
        "outputs": {
            "socket05": 0.98 * float(socket03),
        },
    }
