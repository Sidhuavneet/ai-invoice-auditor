from graph_utils.llm_gateway import LLM_Gateway
import json
import re

def translate(state):
    print("[INFO] Translating extracted data")
    invoice = state.setdefault("invoice_json", {})
    line_items = invoice.get("line_item") or []
    if not line_items:
        invoice["line_item"] = []
        invoice["translation_confidence"] = 1.0
        return state
    transres = translation(line_items)
    invoice["line_item"] = transres["translation"]
    invoice["translation_confidence"] = transres["translation_confidence"]
    return state

def translation(text)->dict:
    """
    Translates the invoice line items to English.
    """

    prompt = f"""
    You are a professional Financial Document Translation system.
    Translate the following Invoice list into English.

    Rules:
    1. Preserve numbers, currency symbols, and formatting.
    2. Translate all remaining text.
    3. Do not hallucinate or add/remove content.
    4. The output must be valid JSON, using double quotes (").

    Invoice text:
    {text}

    Output: a JSON array of objects representing the translated line items.
    """


    llm = LLM_Gateway("AA")
    res = llm.invoke(prompt)
    res_dict = {}
    try:
        match = re.search(r"\[.*\]|\{.*\}", res, re.S)
        json_s = match.group(0) if match else res
        res_dict["translation"] = json.loads(json_s)
    except Exception:
        res_dict["translation"] = text


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
        m = re.search(r"[0-9]*\.?[0-9]+", result)
        confidence_score = float(m.group(0)) if m else 1.0
        res_dict['translation_confidence'] = confidence_score
    except Exception:
        res_dict['translation_confidence'] = 1.0
    return res_dict
