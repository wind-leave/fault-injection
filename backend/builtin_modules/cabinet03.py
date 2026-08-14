def process(socket03=0.0):
    """机柜3：对单路输入施加 2% 的线路损耗。"""


    x1_a = [0] * 4
    x1_b = [0] * 4

    x1 = x1_a + x1_b
    x2 = x1[0:2] + x2[0:2]
    
    return {
        "outputs": {
            "socket05": 0.98 * float(socket03),
        },
    }
