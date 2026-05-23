import os
from typing import TypedDict

from langgraph.types import interrupt, Command
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import StateGraph, START, END

from agents.extractor_agent import extractor
from agents.reporting_agent import reporting
from agents.saver_agent import final_saver
from agents.translator import translate
from agents.validation import validation


# LangGraph checkpoints live in Supabase Postgres so pipeline state survives
# redeploys. PostgresSaver creates its own tables on first .setup() call.
_DB_URL = os.environ.get("SUPABASE_DB_URL")
if not _DB_URL:
    raise RuntimeError(
        "SUPABASE_DB_URL is required for the LangGraph Postgres checkpointer. "
        "Copy .env.example to .env and fill in Supabase credentials."
    )

_checkpoint_cm = PostgresSaver.from_conn_string(_DB_URL)
checkpointer = _checkpoint_cm.__enter__()  # held for the process lifetime
checkpointer.setup()


def human_review(state):
    decision = interrupt({"type": "human review"})
    return decision


def router(state):
    rec = ((state.get("system_report") or {}).get("recommendation") or "manual_review")
    rec = str(rec).lower().strip().replace(" ", "_")
    if rec in {"approve", "approved", "accept"}:
        return "approve"
    if rec in {"reject", "rejected"}:
        return "reject"
    return "manual_review"


class State(TypedDict):
    file_name: str
    file_path: str
    metadata_path: str
    metadata: dict
    invoice_json: dict
    rules: dict
    system_report: dict
    human_report: str
    status: str
    remarks: str


graph = StateGraph(State)
graph.add_node("extractor", extractor)
graph.add_node("translate", translate)
graph.add_node("validation", validation)
graph.add_node("reporting", reporting)
graph.add_node("human", human_review)
graph.add_node("final", final_saver)

graph.add_edge(START, "extractor")
graph.add_edge("extractor", "translate")
graph.add_edge("translate", "validation")
graph.add_edge("validation", "reporting")
graph.add_conditional_edges("reporting", router, {
    "manual_review": "human",
    "approve": "final",
    "reject": "final",
})
graph.add_edge("human", "final")
graph.add_edge("final", END)

app = graph.compile(checkpointer=checkpointer)


def resumer(name: str, status: str, remarks: str):
    resumed = app.invoke(
        Command(resume={"status": status, "remarks": remarks}),
        config={"configurable": {"thread_id": name}},
    )
    return resumed
