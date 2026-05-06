import re
import json
from graph_utils.llm_gateway import LLM_Gateway

def reporting(state):
    print("[INFO] Generating Report")
    system,human=ReportingAgent(state["invoice_json"],state["rules"])
    state["system_report"]=system
    state["human_report"]=human
    if "manual review" in system['recommendation'].lower():  
        state['status']="Manual Review"
        state["remarks"]="" 
    else:
        state['status']="Not Required"
        state["remarks"]="Not Required"
    result=state['invoice_json']
    result["file_name"]=state["file_name"]
    result.update(state['metadata'])
    result.update(state['system_report'])
    result.update({"status":state['status'] if "status" in state else ""})
    result.update({"remarks":state['remarks']if "remarks" in state else ""})
    result.update({'human_report':state['human_report']})
    with open(f"outputs/reports/RE_{state['file_name']}.json", "w", encoding="utf-8") as f:
        json.dump(result,f)

    return state



llm=LLM_Gateway('reason')


def generate_system_report(content,validation_policies,reporting):

    prompt=f"""
    Role: You are a Invoice Report Validating Agent.
    Task1: validate the given content according to validation_policies and return the final output

    content: {content}
    validation_policies: {validation_policies}

    No salutations only provide a json ouput nothing else,
    output: {{"recomendation": "Approve"|"Manual Review"|"Reject"}}
    """
    response=llm.invoke(prompt)
    try:
        match=re.search(r"\{.*\}",response,re.S)
        json_s=match.group(0) if match else ""
        system_report=json.loads(json_s)
        return system_report
    except Exception as e:
        raise ValueError("Error while generating system report ")
    
    
def generate_human_readable_report(content,system_report):
    prompt=f"""
    Role: You are a report generating agent. You generate reports in natural language.
    Task: Generate a precise and descriptive 2 or 3 line report from {content} and {system_report} in human readable format

    No Salutations,
    output: 
    """
    response=llm.invoke(prompt)
    return response

def ReportingAgent(content,rules):
    validation_policies=rules['validation_policies']
    reporting=rules['reporting']
    system_report=generate_system_report(content,validation_policies,reporting)
    human_readable_report=generate_human_readable_report(content,system_report)
    return system_report,human_readable_report


