import os
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage


class LLM_Gateway:
    def __init__(self, method: str):
        self.method = method
        self.model = self.choose_model(method)
        self.client = ChatGroq(
            model=self.model,
            temperature=0.5,
            api_key=os.environ["GROQ_API_KEY"],
        )

    def choose_model(self, method: str = "base") -> str:
        if method == "reason":
            return os.environ.get("GROQ_REASON_MODEL", "llama-3.3-70b-versatile")
        return os.environ.get("GROQ_BASE_MODEL", "llama-3.1-8b-instant")

    def invoke(self, text: str) -> str:
        response = self.client.invoke([HumanMessage(content=text)])
        return response.content
