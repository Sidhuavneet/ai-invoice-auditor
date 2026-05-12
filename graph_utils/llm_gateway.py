import os
import re
import time
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
        max_attempts = 5
        for attempt in range(max_attempts):
            try:
                response = self.client.invoke([HumanMessage(content=text)])
                return response.content
            except Exception as e:
                msg = str(e)
                is_rate = "429" in msg or "rate_limit" in msg.lower() or "rate limit" in msg.lower()
                if not is_rate or attempt == max_attempts - 1:
                    raise
                wait = self._parse_retry_after(msg)
                if wait is None:
                    wait = min(2 ** attempt, 30)
                print(f"[LLM] rate limited, sleeping {wait:.1f}s (attempt {attempt+1}/{max_attempts})")
                time.sleep(wait)

    @staticmethod
    def _parse_retry_after(msg: str):
        m = re.search(r"try again in ([0-9.]+)\s*(ms|s)", msg)
        if not m:
            return None
        val = float(m.group(1))
        if m.group(2) == "ms":
            val = val / 1000.0
        return max(val + 0.2, 0.5)
