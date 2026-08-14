from backend.simulation_functions import amplify_rf_final_power_2


def _vector4(value, name):
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError(f"{name} ")
    return[float(item) for item in value]



def process(
        a = None,
        b = None,
    ):


    MJFL_L = amplify_rf_final_power_2(
        small_signal_inputs=[a,b],
        
    )




    return{
        "outputs":{
            "MJGF_L": MJFL_L,
        },
    }