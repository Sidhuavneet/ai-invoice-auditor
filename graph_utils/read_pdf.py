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
            for page in pdf.pages:
                text=page.extract_text()
        return text
    except Exception as e:
        return f"Error: {str(e)}"    