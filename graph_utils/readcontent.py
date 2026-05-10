from .read_docx import extract_docx_content
from .read_images import extract_text_from_image
from .read_pdf import extract_pdf_content

def read_invoice(file_path:str)->str:
    """
    main function to drive and fetch the content based on the file type

    Args:
    - file_path (str): path of the file where it is located

    Returns:
    - str: content of the file
    """
    try:
        lower = file_path.lower()
        if lower.endswith(".pdf"):
            content = extract_pdf_content(file_path)
        elif lower.endswith((".png", ".jpg", ".jpeg")):
            content = extract_text_from_image(file_path)
        elif lower.endswith(".docx"):
            content = extract_docx_content(file_path)
        else:
            raise ValueError(f"Unsupported file type: {file_path}")
        return content
    except Exception as e:
        return f"Error: {str(e)}"


        