import json
from langchain_text_splitters import RecursiveCharacterTextSplitter, RecursiveJsonSplitter
from langchain_core.documents import Document

from langchain_community.vectorstores.faiss import FAISS
import os
from langchain_core.documents import Document
from typing import List
from graph_utils.embeddings import get_embedding_model
embedding_model = get_embedding_model()


def final_saver(state):
    print("[INFO] Saving to Vector DB")
    result=state['invoice_json']
    result["file_name"]=state["file_name"]
    result.update(state['metadata'])
    result.update(state['system_report'])
    result.update({'human_report':state['human_report']})
    result.update({"status":state['status']})
    result.update({"remarks":state['remarks']})
    with open(f"outputs/reports/RE_{state['file_name']}.json", "w", encoding="utf-8") as f:
        json.dump(result,f)

    #vector store 
    splitter=RecursiveJsonSplitter(max_chunk_size=1999)
    chunks=splitter.split_json(result)
    docs: List[Document]=[]
    for chunk in chunks:
        doc=Document(page_content=str(chunk),metadata=state['metadata'])
        docs.append(doc)
    index_file=os.path.join("docDB/","index.faiss")
    if os.path.exists(index_file):
        db=FAISS.load_local(
            folder_path="docDB/",
            embeddings=embedding_model,
            allow_dangerous_deserialization=True
        )
        db.add_documents(docs)
    else:
        db=FAISS.from_documents(docs,embedding=embedding_model)
    db.save_local(folder_path="docDB/")
    
    return state
