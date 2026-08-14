def process(pitch_command=0.0):
    value = float(pitch_command)
    shaped_command = max(min(value, 1.0), -1.0)
    return {"shaped_command": shaped_command}
