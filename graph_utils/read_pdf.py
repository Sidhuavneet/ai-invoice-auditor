import pdfplumber

def extract_pdf_content(file_path:str)->str:
    """
    Extracts text from pdf files

    Args:
    - image_path (str): The path to the pdf file

    Returns:
    - str: The extracted text from the pdf.
    """
    try:
        with pdfplumber.open(file_path) as pdf:
            parts = [page.extract_text() or "" for page in pdf.pages]
        return "\n".join(parts)
    except Exception as e:
        return f"Error: {str(e)}"
