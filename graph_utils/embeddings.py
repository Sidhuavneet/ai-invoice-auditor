import os
from langchain_huggingface import HuggingFaceEmbeddings

_embedding_model = None


def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        model_name = os.environ.get(
            "EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
        )
        _embedding_model = HuggingFaceEmbeddings(model_name=model_name)
    return _embedding_model
