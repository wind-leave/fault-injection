def process(socket02=0.0):
    """机柜1：单通道透明转发。"""
    return {
        "outputs": {
            "socket03": float(socket02),
        },
    }
