def process(
    rotor_1_thrust=0.0,
    rotor_2_thrust=0.0,
    rotor_3_thrust=0.0,
    rotor_4_thrust=0.0,
    rotor_5_thrust=0.0,
    rotor_6_thrust=0.0,
    rotor_7_thrust=0.0,
    rotor_8_thrust=0.0,
):
    values = [
        float(rotor_1_thrust),
        float(rotor_2_thrust),
        float(rotor_3_thrust),
        float(rotor_4_thrust),
        float(rotor_5_thrust),
        float(rotor_6_thrust),
        float(rotor_7_thrust),
        float(rotor_8_thrust),
    ]
    total_force = sum(values)
    total_moment = sum((index - 3.5) * value for index, value in enumerate(values)) / 8.0
    return {
        "outputs": {
            "total_force": total_force,
            "total_moment": total_moment,
        },
        "state": {},
        "middleVars": {"aero_balance": total_moment},
    }
