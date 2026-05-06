import sqlite3
from langgraph.types import interrupt, Command
from langgraph.checkpoint.sqlite import SqliteSaver
from agents.extractor_agent import extractor
from agents.reporting_agent import reporting
from agents.saver_agent import final_saver
from agents.translator import translate
from agents.validation import validation


db_url="state_memory.db"
conn=sqlite3.connect(db_url,check_same_thread=False)



# db_url="state_memory.db"
# conn=sqlite3.connect(db_url,check_same_thread=False)




def human_review(state):
    decision=interrupt({
        "type":"human review"
    })
    return decision
    # if decision['status']=="Approved":
    #     return {
    #         "status":"Approved",
    #         "Remarks":decisoin['Remarks']
    #     }
    # else:
    #     return {
    #         "status":"Not Required",
    #         "Remarks":"Not Required"
    #     }




def router(state):
    recommendation=state['system_report']['recommendation'].lower()
    return recommendation

from typing import TypedDict
class State(TypedDict):
    file_name:str
    file_path:str
    metadata_path:str
    metadata:dict
    invoice_json:dict
    rules:dict
    system_report:dict
    human_report:str
    status: str
    remarks: str

from langgraph.graph import StateGraph,START,END
graph=StateGraph(State)
graph.add_node("extractor",extractor)
graph.add_node("translate",translate)
graph.add_node("validation",validation)
graph.add_node("reporting",reporting)
graph.add_node("human",human_review)
graph.add_node("final",final_saver)

graph.add_edge(START,"extractor")
graph.add_edge("extractor","translate")
graph.add_edge("translate","validation")
graph.add_edge("validation","reporting")
graph.add_conditional_edges("reporting",router,{
    "manual review":"human",
    "approve": "final",
    "reject": "final"
})

graph.add_edge("human","final")
graph.add_edge("final",END)

app=graph.compile(checkpointer=SqliteSaver(conn))


def resumer(name: str, status: str,remarks:str):
    resumed=app.invoke(Command(resume={"status":status,"remarks":remarks}),config={"configurable":{"thread_id":name}})
    return resumed