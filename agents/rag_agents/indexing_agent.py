from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

def indexing_node(state):
    document_content = state["content"]
    metadata = state["metadata"]
    db = state["db"]

    doc = Document(page_content=document_content, metadata=metadata)

    splitter = RecursiveCharacterTextSplitter(
        chunk_size = 1000,
        chunk_overlap = 200
    )

    chunks = splitter.split_documents([doc])
    db.add_documents(chunks)