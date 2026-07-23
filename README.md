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

Letakkan model di folder `models/`:

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
