# OCR Preprocessing API

API Express + TypeScript untuk preprocessing gambar dokumen sebelum OCR.

Pipeline utama:
- YOLO untuk document detection
- PP-LCNet_x1_0_doc_ori untuk document orientation 0/90/180/270
- PP-OCRv5_mobile_det untuk text-aware preprocessing
- OpenCV/ImageMagick-style processing untuk crop, rotate, deskew, denoise, contrast enhancement, dan output image siap OCR

## Fitur

- Upload image via `multipart/form-data`
- Auto detect dokumen
- Auto rotate dokumen ke orientasi benar
- Multi-document support
- Output langsung `image/png`
- Header metadata hasil preprocessing

## Tech Stack

- TypeScript
- Express
- Multer
- onnxruntime-node
- ImageMagick (`magick` CLI)
- Model ONNX lokal

## Model yang dipakai

Letakkan model di folder `models/`. Karena repo ini menyimpan model dalam format ONNX, download model Paddle resmi lalu convert ke ONNX, atau gunakan link berikut.

### Document Detection (YOLO)

```bash
curl -L "https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo11n.onnx" -o models/document-yolo.onnx
```

Untuk akurasi crop dokumen lebih baik, ganti dengan YOLO document detector ONNX bila tersedia.

### Document Orientation (PP-LCNet_x1_0_doc_ori)

Download model Paddle resmi:

```bash
curl -L "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-LCNet_x1_0_doc_ori_infer.tar" -o PP-LCNet_x1_0_doc_ori_infer.tar
tar -xf PP-LCNet_x1_0_doc_ori_infer.tar
```

Convert ke ONNX:

```bash
pip install paddle2onnx packaging paddlepaddle
paddle2onnx \
  --model_dir PP-LCNet_x1_0_doc_ori_infer \
  --model_filename inference.json \
  --params_filename inference.pdiparams \
  --save_file models/pp-lcnet-doc-ori.onnx \
  --opset_version 11 \
  --optimize_tool None \
  --enable_onnx_checker False
```

Dokumentasi: <https://www.paddleocr.ai/main/en/version3.x/module_usage/doc_img_orientation_classification.html>

### Text Detection (PP-OCRv5_mobile_det)

Download model Paddle resmi:

```bash
curl -L "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_infer.tar" -o PP-OCRv5_mobile_det_infer.tar
tar -xf PP-OCRv5_mobile_det_infer.tar
```

Convert ke ONNX:

```bash
paddle2onnx \
  --model_dir PP-OCRv5_mobile_det_infer \
  --model_filename inference.json \
  --params_filename inference.pdiparams \
  --save_file models/pp-ocrv5-mobile-det.onnx \
  --opset_version 11 \
  --optimize_tool None \
  --enable_onnx_checker False
```

Dokumentasi: <https://www.paddleocr.ai/main/en/version3.x/module_usage/text_detection.html>

### Ringkasan model yang dipakai

- `models/document-yolo.onnx`
- `models/pp-lcnet-doc-ori.onnx`
- `models/pp-ocrv5-mobile-det.onnx`

## Environment

Salin `.env.example` ke `.env`.

```bash
cp .env.example .env
```

Isi `.env`:

```env
YOLO_MODEL_PATH=models/document-yolo.onnx
YOLO_INPUT_SIZE=640
YOLO_CONFIDENCE=0.35
DOC_ORIENTATION_MODEL_PATH=models/pp-lcnet-doc-ori.onnx
TEXT_DETECTION_MODEL_PATH=models/pp-ocrv5-mobile-det.onnx
```

## Install

```bash
npm install
```

## Run

Development:

```bash
npm run dev
```

Production-like local run:

```bash
npm run start
```

Typecheck:

```bash
npm run typecheck
```

## Endpoint

### `GET /health`

Response:

```json
{ "ok": true }
```

### `POST /preprocess`

Request:
- `multipart/form-data`
- field: `image`

Contoh:

```bash
curl -X POST http://localhost:3000/preprocess \
  -F "image=@/path/to/image.jpg" \
  --output ocr-ready.png
```

Response:
- Body: `image/png`
- Header metadata:
  - `X-Cropped`
  - `X-Deskew-Angle`
  - `X-Orientation-Angle`
  - `X-Orientation-Method`
  - `X-Detector`
  - `X-Preprocessing`
  - `X-Detection-Status`
  - `X-Document-Count`

## Docs

Saat server jalan:

- Scalar docs: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`

## Catatan

- `ImageMagick` harus tersedia di sistem sebagai command `magick`.
- Inference default berjalan di CPU.
- `.env` sudah di-ignore dari git.
- Folder `dist/` dan `node_modules/` juga di-ignore.
