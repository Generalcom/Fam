FROM python:3.12-slim

# Tesseract (the OCR engine) with English, which covers SA IDs and passports' machine-readable lines.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Face detection (YuNet, MIT) and face recognition (SFace, Apache-2.0) from OpenCV Zoo, checked against known hashes.
# The anti-spoofing models (Apache-2.0) are in models/ already.
COPY models/ models/
RUN cd models \
 && curl -fsSLO https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx \
 && curl -fsSLO https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx \
 && echo "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4  face_detection_yunet_2023mar.onnx" | sha256sum -c - \
 && echo "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79  face_recognition_sface_2021dec.onnx" | sha256sum -c -

COPY kyc_worker/ kyc_worker/

# The photos are only ever held in memory; nothing is written to disk. Run as an unprivileged user.
RUN useradd --system --no-create-home worker
USER worker
ENV PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1
CMD ["python", "-m", "kyc_worker"]
