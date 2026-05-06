from langchain.tools import tool
from langgraph.prebuilt import ToolNode

def retrieval_node(state):
    """
    retrive the similar top 3 documents and return the state

    Args:
    - state: Rag subgraph state

    Return:
    - state
    """
    query = state["query"]
    db = state["db"]
    llm = state["llm"]

    @tool
    def retrieve(query:str)->list:
        """
        database to retrive the information about invoices
        """
        documents=db.similarity_search(query,k=5)

        return documents

    tools = [retrieve]

    llm_with_tools = llm.bind_tools(tools)
    prompt = f"""
    You are a database retrieval agent, your goal is to retrive the content from the database if the query is about to invoice details, if the database retrival is not requred then respond with ##"This is a generic query, please answer polite" ##

    you need to call the retrieve function if the query needs retrieval

    ## query : {query}
    """
    tool_res = llm_with_tools.invoke(prompt)
    # print(tool_res)
    tool_node = ToolNode(tools, handle_tool_errors=True)

    documents = tool_node.invoke({"messages" : [tool_res]})
    # data=""
    # for doc in documents:
    #     data += "\n\n" + str(doc.metadata)+ "\n" + doc.page_content
    # print(len(documents["messages"]))
    # print(documents)
    if len(documents["messages"]) > 0:
        res = documents.get("messages")[0].content
    else:
        res = "This is a generic query, please answer polite"
        
    state["content"] = res

    return state