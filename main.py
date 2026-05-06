import streamlit as st
import os
import json
import pandas as pd
import time
from dotenv import load_dotenv

load_dotenv()

from agents.rag_agents.rag import rag_chat
from langchain_community.vectorstores.faiss import FAISS
from langchain_groq import ChatGroq
from graph_utils.embeddings import get_embedding_model
from graph_utils import mailbox_utils
from graph import resumer, app as graph_app

os.makedirs("outputs/reports", exist_ok=True)
os.makedirs("docDB", exist_ok=True)

llm = ChatGroq(
    model=os.environ.get("GROQ_REASON_MODEL", "llama-3.3-70b-versatile"),
    temperature=0.5,
    api_key=os.environ.get("GROQ_API_KEY"),
)
embedding_model = get_embedding_model()


def process_inbox():
    """Drain the inbox folder through the LangGraph workflow."""
    target = "inbox"
    processed = 0
    while True:
        paths = mailbox_utils.poll(target)
        if not paths or not paths.get("file"):
            break
        file_path = f"{target}/{paths['file']}"
        metadata_path = f"{target}/{paths['meta']}" if paths["meta"] else ""
        file_name = paths["file"][: paths["file"].rfind(".")]
        try:
            graph_app.invoke(
                {
                    "file_path": file_path,
                    "metadata_path": metadata_path,
                    "file_name": file_name,
                },
                config={"configurable": {"thread_id": file_name}},
            )
            processed += 1
        except Exception as e:
            st.error(f"Failed processing {paths['file']}: {e}")
            break
    return processed

def json_to_markdown(json_data):
    # Initialize the markdown string
    markdown = "\n#### Answer Relevency information: \n"
    
    # Loop through each key-value pair in the JSON data
    for key, value in json_data.items():
        markdown += f"###### {key.replace('_', ' ').title()}\n"
        markdown += f"Value: {value}\n\n"
    
    return markdown
    
# =============================
# Page Config
# =============================
st.set_page_config(
    page_title="AI Invoice Auditor Dashboard",
    page_icon="📊",
    layout="wide"
)

# =============================
# PDF LIST 
# =============================
def load_pdf_files(folder_path="outputs/reports"):
    return [
        f for f in os.listdir(folder_path)
        if f.lower().endswith(".json")
    ]
Showing_pdf = load_pdf_files()
# =============================
# Session State
# =============================

def init_session_state():
    if "review_submitted" not in st.session_state:
        st.session_state.review_submitted = False

    if "messages" not in st.session_state:
        st.session_state.messages = []

    if "active_section" not in st.session_state:
        st.session_state.active_section = "Summary Report"

    


init_session_state()

# =============================
# Utils
# =============================
def load_invoice_reports():
    reports_folder = "outputs/reports"
    reports = []
    for filename in os.listdir(reports_folder):
        if filename.endswith(".json"):
            reports.append(filename)
    return reports

def load_invoice_data(filename):
    with open(f"outputs/reports/{filename}", "r") as file:
        data = json.load(file)
    return data

# =============================
# Summary Report 
# =============================
def invoice_report_section():
    reports = load_invoice_reports()

    selected_report = st.selectbox(
        "Select Invoice Report to Review",
        reports,
    )

    if not selected_report and reports:
        selected_report = reports[0]

# -----------------------------
# Reset review state when invoice changes
# -----------------------------
    if "last_selected_report" not in st.session_state:
        st.session_state.last_selected_report = None

    if selected_report != st.session_state.last_selected_report:
        st.session_state.review_submitted = False
        st.session_state.last_selected_report = selected_report


    if selected_report:
        with st.spinner('Loading the data... Please wait for a few seconds'):
            time.sleep(2)
            invoice_data = load_invoice_data(selected_report)

        # Invoice Summary
        st.subheader("Invoice Summary")
        header = invoice_data.get("header", {})
        st.write(f"**Invoice Number:** {header.get('invoice_no')}")
        st.write(f"**Invoice Date:** {header.get('invoice_date')}")
        st.write(f"**Vendor Name:** {header.get('vendor_id')}")
        st.write(f"**PO Reference:** {header.get('po_reference')}")
        st.write(f"**Currency:** {header.get('currency')}")
        st.write(f"**Total Amount:** {header.get('total_amount')}")

        # Line Items
        st.subheader("Invoice Line Items")
        line_items = pd.DataFrame(invoice_data.get("line_item", []))
        st.dataframe(line_items)

        # Discrepancy Summary (ORIGINAL)
        st.subheader("Discrepancy Summary")
        discrepancy_summary = invoice_data.get("discrepancy_report", {}).get("discrepancy_summary", [])


        if discrepancy_summary:
            if isinstance(discrepancy_summary, str):
                discrepancy_summary = [discrepancy_summary]

            st.markdown(
        f"""
        <div style="background-color:#fdecea;border-left:6px solid #d32f2f;padding:16px;border-radius:6px;">
            <div style="color:#d32f2f;font-weight:600;margin-bottom:10px;">
                ⚠️ There are discrepancies in the invoice
            </div>
            <ul style="color:#d32f2f;padding-left:20px;margin:0;line-height:1.6;list-style-position:inside;">
                {''.join(f'<li style="margin-bottom:6px;">{issue}</li>' for issue in discrepancy_summary)}
            </ul>
        </div>
        """,
            unsafe_allow_html=True
            )
        else:
            st.success("No discrepancies found.")


        st.write(f"**Recommendation:** {invoice_data.get('recommendation', 'N/A')}")

        # Display the Human Report 
        human_report = invoice_data.get("human_report", None)
    
        if human_report:
            st.subheader("Report: ")

            # Use Markdown to make the human report look more readable
            st.markdown("""
            <div style="background-color:#f4f6f9; padding: 20px; border-radius: 10px;">
                <h3 style="color: #2b2d42;">Report Details:</h3>
                <p style="color: #3e3e3e;">{}</p>
            </div>
            """.format(human_report), unsafe_allow_html=True)
        else:
            st.write("No Report found")


# =============================
# This Section is for conditional Human Review
# =============================

        statuss = invoice_data.get("status", "")

        normalized_rec = statuss.lower().strip()
        print(normalized_rec)

        if (
            ("manual review" in normalized_rec)
            # and not st.session_state.review_submitted
        ):

            st.subheader("Human Feedback & Correction")

            with st.expander("Edit Invoice JSON"):
                st.text_area(
                    "Editable Invoice JSON",
                    json.dumps(invoice_data, indent=4),
                    height=200
                )

            remarks = st.text_area("Enter correction notes", height=100)

            st.markdown("""
            <style>
            div[data-testid="column"] {
                padding-right: 8px !important;
            }
            button[kind="primary"] {
                background-color: #16a34a !important; /* green */
            }
            button[kind="secondary"] {
                background-color: #dc2626 !important; /* red */
                color: white !important;
            }
            </style>
            """, unsafe_allow_html=True)

            col1, col2, _ = st.columns([1, 1, 6])
            with col1:
                if st.button(" Approve ", type="primary") and not st.session_state.review_submitted:
                    invoice_name = invoice_data.get("file_name")

                    if resumer(
                        name=invoice_name,
                        status="accept",
                        remarks=remarks
                    ):
                        st.session_state.review_submitted = True
                        st.success("Invoice accepted.")

                    st.rerun()

            with col2:
                if st.button(" Reject ", type="secondary") and not st.session_state.review_submitted:
                    invoice_name = invoice_data.get("file_name")

                    if resumer(
                        name=invoice_name,
                        status="reject",
                        remarks=remarks
                    ):
                        st.session_state.review_submitted = True
                        st.warning("Invoice rejected.")

                    st.rerun()



# =============================
# Chatbot Logic
# =============================


def chatbot_response(user_message: str):
    time.sleep(1)
    return llm.invoke(user_message)

# =============================
# QA Chatbot
# =============================
def qa_chatbot_section():
    

    st.subheader("QA Bot")
    st.caption("Ask questions using the PDF names shown in the sidebar")


    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

    # Text input for the user to ask a question
    user_input = st.chat_input("Type your question...")
    
    db = None
    if os.path.exists("docDB/index.faiss"):
        db = FAISS.load_local(
            "docDB/",
            embeddings=embedding_model,
            allow_dangerous_deserialization=True,
        )

    if user_input:
        if not os.path.exists("docDB/index.faiss"):
            st.warning("No invoices indexed yet. Click 'Process New Invoices' first.")
            return
        res = rag_chat(query=user_input, llm=llm, db=db)
        st.session_state.messages.append(
            {"role": "user", "content": user_input}
        )
        # response = chatbot_response(user_input)
        st.session_state.messages.append(
            {"role": "assistant", "content": res["response"] + json_to_markdown(res["reviewed_response"])}
        )
        st.rerun()

# =============================
# Main App
# =============================
# =============================
# Main App
# =============================
def main():

#For Color of json files showing on nav bar
    def get_invoice_color_from_recommendation(file_name, folder="outputs/reports"):
        try:
            with open(os.path.join(folder, file_name), "r") as f:
                data = json.load(f)

            recommendation = data.get("recommendation", "").lower().strip()
            status = data.get("status", "").lower().strip()

            # Case 1: Both recommendation and status are "manual review"
            if recommendation == "manual review" and status == "manual review":
                return "#FFF085"  # Yellow color for manual review

            # Case 2: Status is "Not Required" and recommendation is "Approve" (Pending Approval)
            elif status == "not required" and recommendation == "approve":
                return "#b8ef53"  # green

            # Case 3: Invoice has been accepted or rejected
            elif status == "accept":
                return "#b8ef53"  # Green color for accepted invoices
            elif status == "reject":
                return "#e43939"  # Red color for rejected invoices

            # Case 4: Recommendation is already "accept" or "reject"
            elif recommendation == "accept":
                return "#b8ef53"  # Green color for accepted invoices
            elif recommendation == "reject":
                return "#e43939"  # Red color for rejected invoices

            # Default color if no status or recommendation matches
            else:
                return "#e4e4e7"  # Default light gray

        except Exception as e:
            return "#e4e4e7"  # Default light gray in case of any error
        
    st.title("AI Invoice Auditor Dashboard")

    with st.sidebar:
        if st.button("📥 Process New Invoices", use_container_width=True):
            with st.spinner("Running multi-agent pipeline..."):
                count = process_inbox()
            if count:
                st.success(f"Processed {count} invoice(s).")
                st.rerun()
            else:
                st.info("No new invoices in inbox.")

    # -----------------------------
    # Sidebar Navigation (Vertical Buttons)
    # -----------------------------

    st.markdown("""
    <style>
    /* Sidebar buttons */
    section[data-testid="stSidebar"] button {
        width: 100%;
        border-radius: 8px;
        margin-bottom: 6px;
    }

    /* Active (disabled) button */
    section[data-testid="stSidebar"] button:disabled {
        background-color: #2563eb !important;
        color: white !important;
        opacity: 1 !important;
    }

    /* Inactive buttons */
    section[data-testid="stSidebar"] button:not(:disabled) {
        background-color: #e5e7eb !important;
        color: black !important;
    }
    </style>
    """, unsafe_allow_html=True)

    st.sidebar.markdown("### Select Section")

    if st.sidebar.button(
        "Summary Report",
        disabled=st.session_state.active_section == "Summary Report"
    ):
        st.session_state.active_section = "Summary Report"
        st.rerun()

    if st.sidebar.button(
        "QA Chatbot",
        disabled=st.session_state.active_section == "QA Chatbot"
    ):
        st.session_state.active_section = "QA Chatbot"
        st.rerun()

    # -----------------------------
    # Sidebar PDF List
    # -----------------------------
    st.sidebar.markdown("---")
    st.sidebar.markdown("### Available Invoices")

    if Showing_pdf and len(Showing_pdf) > 0:
        for pdf in Showing_pdf:
            color = get_invoice_color_from_recommendation(pdf)

            label = "Manual Review" if color == "red" else ""

            st.sidebar.markdown(
                f"""
                   <div style="
                    background-color: {color};
                    border-left: 6px solid rgba(0,0,0,0.15);
                    border-radius: 8px;
                    padding: 8px 12px;
                    margin: 6px 0;
                    color: #1f2937;
                    font-weight: 500;
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                ">
                    <span style="font-size: 12px;">●</span>
                    <span>{pdf}</span>
                    {f'<span style="opacity:0.6; font-size:12px;">({label})</span>' if label else ''}
                </div>
                """,
                unsafe_allow_html=True
            )
    else:
        st.sidebar.info("No Invoices found in the folder")



    # -----------------------------
    # Section Routing
    # -----------------------------
    if st.session_state.active_section == "Summary Report":
        invoice_report_section()
    else:
        qa_chatbot_section()

# -----------------------------
# App Entry Point
# -----------------------------
if __name__ == "__main__":
    main()

