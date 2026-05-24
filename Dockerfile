FROM python:3.11-slim

# System deps for PDF/DOCX/OCR parsing (same as apt.txt on Render).
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    poppler-utils \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# HuggingFace Spaces requires a non-root user with uid 1000.
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"
ENV HOME=/home/user
WORKDIR /home/user/app

# Install Python deps first (better Docker layer caching).
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend.
COPY --chown=user . .

# HF Spaces expects the app on port 7860.
EXPOSE 7860

CMD ["uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "7860"]
