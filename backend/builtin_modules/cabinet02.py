def process(socket02=0.0, socket03=0.0):
    """机柜2：按 60%/40% 融合两路输入。"""
    return {
        "outputs": {
            "socket04": 0.6 * float(socket02) + 0.4 * float(socket03),
        },
    }
