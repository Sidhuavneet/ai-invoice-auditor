from fastapi import FastAPI
import json

app=FastAPI()
po=[]
vendors=[]

with open("data/PO Records.json","r") as file:
    po= json.load(file)
with open("data/vendors.json","r") as file:
    vendors=json.load(file)

@app.get("/po/{po_number}")
def get_po_by_number(po_number:str):
    for item in po:
        if item["po_number"]==po_number:
            return item
    return None

@app.get("/vendor/{vendor_id}")
def get_po_by_number(vendor_id:str):
    for item in vendors:
        if item["vendor_id"]==vendor_id:
            return item
    return None


@app.post("/chat")
def invoke_rag(query:str):
    pass