from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import PromptTemplate

def print_response(x):
    # print(x)
    return x

def reflection_node(state):
    query = state["query"]
    content = state["content"]
    response = state["response"]
    
    llm = state["llm"]

    template = """
    You are an helpful ai assistant, your goal is to find the confidence score, groundness score and content relevence score for the given query and content with the answer

    use the bellow information to generate the scores and give the scores in between 0 and 1
 ## query : {query}
 ## content :{content}
 ## response:{response}

strictly return the output in json format and follow the bellow output json template only
{{
"confidence_score" : 0 to 1,
"groundness_score" : 0 to 1,
"content_relevence" : 0 to 1
}}
 """
    prompt = PromptTemplate.from_template(template= template)
    chain=prompt | llm  | (lambda x: print_response(x)) | JsonOutputParser()
    res = chain.invoke({"query": query, "content": content, "response":response})
    try:
        confidence = res.get("confidence_score", None)
        ground = res.get("groundness_score", None)
        content = res.get("content_relevence", None)
        if confidence and ground and content:
            state["reviewed_response"] = res
        else:
            raise ValueError("LLM not able to generate the Json response for confidence, groundness and content relevence")
    except Exception as e:
        dummy_res = {
            "confidence_score" : 0.3,
            "groundness_score" : 0.3,
            "content_relevence" : 0.3
        }
        state["reviewed_response"] = dummy_res
    return state