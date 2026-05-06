from PIL import Image
import pytesseract

## required pytesseract==0.3.13
## Pillow==11.3.0

def extract_text_from_image(image_path:str)->str:
    """
    Extracts text from a PNG image using Tesseract OCR.

    Args:
    - image_path (str): The path to the PNG image file.

    Returns:
    - str: The extracted text from the image.
    """
    try:
        # Open the image file
        image = Image.open(image_path)

        # Use Tesseract to extract text from the image
        text = pytesseract.image_to_string(image)

        return text

    except Exception as e:
        return f"Error occurred: {str(e)}"