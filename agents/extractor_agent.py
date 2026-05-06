from graph_utils.readcontent import read_invoice
from graph_utils.llm_gateway import LLM_Gateway
import re 
import json



def extractor(state):
    print(f"[INFO]- extracting from {state['file_path']}")
    text=read_invoice(state["file_path"])
    with open(state["metadata_path"],"r",encoding="utf-8") as file:
        state["metadata"]=json.load(file)
    state["invoice_json"]=structure_content(text)
    return state

def structure_content(text):

    llm=LLM_Gateway('reason')
    structured_prompt=f"""
    You are helpfull Ai Agent.
    You retrieve header(vendor_name, invoice_number, invoice_date, po_reference, currency, total_amount), 
    line_item(item code,description,quantity,unit,total) from invoice into a python dictionary.Only if they exist.

    invoice: {text}

    No salutaions. 
    only return a dictionary object and nothing else  
    if some values are missing keep them empty.
    don't halucinate.
    return the invoice data only.                                             
    output structure:     dict(
                    "header": dict(
                        "invoice_no": invoice_number,
                        "invoice_date": invoice_date,
                        "vendor_id": vendor_name,
                        "currency": currency,
                        "po_reference":po_reference,
                        "total_amount":total_amount
                    ),
                    "line_item" : list[dict(
                                    "item_code": item code,
                                    "description": description,
                                    "qty": quantity,
                                    "unit_price": unit,
                                    "total": total      
                                                   )]                                                                                                              
    """
    response=llm.invoke(structured_prompt)
    try:
        match=re.search(r"\{.*\}",response,re.S)
        json_s=match.group(0) if match else ""
        structured_data=json.loads(json_s)
        return structured_data
    except Exception as e:
        raise ValueError(f"Error in structure node \n{e}")