"""Repeat one scalar input in a seven-element vector on one output port."""


def process(input=0.0):
    return {"output_vector": [float(input)] * 7}
