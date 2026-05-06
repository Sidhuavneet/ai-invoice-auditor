from graph_utils.llm_gateway import LLM_Gateway
import json

def translate(state):
    print("[INFO] Translating extracted data")
    transres=translation(state["invoice_json"]["line_item"])
    state["invoice_json"]["line_item"]=transres["translation"]
    state["invoice_json"]["translation_confidence"]=transres["translation_confidence"]
    return state

def translation(text:dict)->str:
    """
    Translates the invoice text to English language.
    """

    prompt = f"""
    You are a professional Financial Document Translation system. 
    Translate the following Invoice dict into English.

    Rules:
    1. Preserve numbers, currency symbols, and formatting.
    2. Translate all remaining text.
    3. Do not hallucinate or add/remove content.
    4. The output must be valid JSON format, using double quotes (").

    Invoice text:
    {text}

    Output: a JSON object or a list of JSON objects representing the translated invoice exactly as above.
    """


    llm = LLM_Gateway("AA")
    res = llm.invoke(prompt)
    res_dict = {}
    res_dict["translation"]=json.loads(res)

    
    prompt2 = f"""
    just give float nothing else
    Based on the translation you did give a confidence score from 0 to 1.
    if the orinal text is already in english give 1.
    No salutation
    Original Text 
    {text}
    Translated text
    {res} 
    """
    result = llm.invoke(prompt2)
    try:
        confidence_score = float(result.strip()) 
        res_dict['translation_confidence'] = confidence_score
    except Exception as e:
        raise ValueError(f"The translation confidence was not a float {e}")
    return res_dict