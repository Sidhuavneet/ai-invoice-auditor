from langgraph.graph import StateGraph, START, END
from typing import TypedDict
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.vectorstores import VectorStore
from .generation_agent import generate_node
from .reflection_agent import reflection_node
from .retrieval_agent import retrieval_node


class RAGState(TypedDict):
    llm: BaseChatModel    # llm from langchian BaseChatModel
    db: VectorStore
    query: str    # user query
    content: str    # content from vector db
    response: str    # llm final response
    reviewed_response: dict    # after reflection agent

graph = StateGraph(RAGState)

graph.add_node("retrive", retrieval_node)
graph.add_node("generate", generate_node)
graph.add_node("reflection", reflection_node)

graph.set_entry_point("retrive")
graph.add_edge("retrive", "generate")
graph.add_edge("generate", "reflection")
graph.set_finish_point("reflection")

app = graph.compile()

def rag_chat(query:str, llm: BaseChatModel, db: VectorStore):
    """
    to communicate with the rag agent
    """
    return app.invoke({"query" : query, "llm": llm, "db":db})
    