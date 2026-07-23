import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import * as ort from 'onnxruntime-node';
import type { PreprocessResult } from '../types/preprocess.js';

type Detection = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};

const execFileAsync = promisify(execFile);
const configuredModelPath = process.env.YOLO_MODEL_PATH || 'models/document-yolo.onnx';
const modelPath = isAbsolute(configuredModelPath) ? configuredModelPath : resolve(process.cwd(), configuredModelPath);
const configuredOrientationModelPath = process.env.DOC_ORIENTATION_MODEL_PATH || 'models/pp-lcnet-doc-ori.onnx';
const orientationModelPath = isAbsolute(configuredOrientationModelPath)
  ? configuredOrientationModelPath
  : resolve(process.cwd(), configuredOrientationModelPath);
const configuredTextDetectorModelPath = process.env.TEXT_DETECTION_MODEL_PATH || 'models/pp-ocrv5-mobile-det.onnx';
const textDetectorModelPath = isAbsolute(configuredTextDetectorModelPath)
  ? configuredTextDetectorModelPath
  : resolve(process.cwd(), configuredTextDetectorModelPath);
const inputSize = Number(process.env.YOLO_INPUT_SIZE || 640);
const confidenceThreshold = Number(process.env.YOLO_CONFIDENCE || 0.35);
let yoloSession: Promise<ort.InferenceSession> | null = null;
let orientationSession: Promise<ort.InferenceSession> | null = null;
let textDetectorSession: Promise<ort.InferenceSession> | null = null;

export async function preprocessDocument(buffer: Buffer): Promise<PreprocessResult> {
  if (!modelPath) {
    throw new Error('YOLO model path is missing. Set YOLO_MODEL_PATH or place a model at models/document-yolo.onnx.');
  }

  const sourceInfo = await getImageInfo(buffer);
  const detections = await detectDocuments(buffer, sourceInfo.width, sourceInfo.height);
  const detectionStatus = detections.length > 0 ? 'detected' : 'not_detected';
  const targets = detections.length > 0 ? sortDetections(detections) : [null];
  const processed: Buffer[] = [];
  const orientationAngles: number[] = [];

  for (const detection of targets) {
    const crop = await cropDocument(buffer, detection, sourceInfo);
    const cropInfo = await getImageInfo(crop);
    const orientation = await detectOrientationWithYoloOpenCv(crop, null, cropInfo);
    orientationAngles.push(orientation.angle);
    const orientedInfo = await getImageInfo(orientation.buffer);
    processed.push(await runOpenCvPreprocessing(orientation.buffer, null, orientedInfo));
  }

  const output = processed.length > 1 ? await appendImagesVertically(processed) : processed[0] ?? await runOpenCvPreprocessing(buffer, null, sourceInfo);

  return {
    output,
    cropped: detectionStatus === 'detected',
    deskewAngle: 0,
    orientationAngle: orientationAngles[0] ?? 0,
    orientationMethod: 'pp-lcnet-doc-ori',
    detector: 'yolo',
    preprocessing: 'opencv-text-det',
    detectionStatus,
    documentCount: targets.length
  };
}

async function getYoloSession(): Promise<ort.InferenceSession> {
  yoloSession ??= ort.InferenceSession.create(modelPath!);
  return yoloSession;
}

async function getOrientationSession(): Promise<ort.InferenceSession> {
  orientationSession ??= ort.InferenceSession.create(orientationModelPath);
  return orientationSession;
}

async function getTextDetectorSession(): Promise<ort.InferenceSession> {
  textDetectorSession ??= ort.InferenceSession.create(textDetectorModelPath);
  return textDetectorSession;
}

async function detectDocuments(buffer: Buffer, imageWidth: number, imageHeight: number): Promise<Detection[]> {
  const session = await getYoloSession();
  const inputName = session.inputNames[0];
  if (!inputName) throw new Error('YOLO model has no input tensor');

  const tensor = await imageToYoloTensor(buffer);
  const results = await session.run({ [inputName]: tensor });
  const outputName = session.outputNames[0];
  const output = outputName ? results[outputName] : undefined;
  if (!output) throw new Error('YOLO model returned no output tensor');

  return parseYoloOutput(output, imageWidth, imageHeight);
}

async function imageToYoloTensor(buffer: Buffer): Promise<ort.Tensor> {
  const workdir = await mkdtemp(join(tmpdir(), 'ocr-yolo-'));
  const inputPath = join(workdir, `${randomUUID()}.img`);
  const outputPath = join(workdir, 'rgb.bin');

  try {
    await writeFile(inputPath, buffer);
    await execFileAsync('magick', [
      inputPath,
      '-auto-orient',
      '-resize',
      `${inputSize}x${inputSize}!`,
      '-colorspace',
      'RGB',
      '-depth',
      '8',
      `rgb:${outputPath}`
    ]);

    const pixels = await readFile(outputPath);
    if (pixels.length !== inputSize * inputSize * 3) {
      throw new Error('Failed to prepare YOLO input image');
    }

    const data = new Float32Array(3 * inputSize * inputSize);
    for (let y = 0; y < inputSize; y += 1) {
      for (let x = 0; x < inputSize; x += 1) {
        const offset = y * inputSize + x;
        const pixelOffset = offset * 3;
        data[offset] = (pixels[pixelOffset] ?? 0) / 255;
        data[inputSize * inputSize + offset] = (pixels[pixelOffset + 1] ?? 0) / 255;
        data[2 * inputSize * inputSize + offset] = (pixels[pixelOffset + 2] ?? 0) / 255;
      }
    }

    return new ort.Tensor('float32', data, [1, 3, inputSize, inputSize]);
  } finally {
    await rm(workdir, { force: true, recursive: true });
  }
}

function parseYoloOutput(output: ort.Tensor, imageWidth: number, imageHeight: number): Detection[] {
  const values = output.data as Float32Array;
  const shape = output.dims;
  const channels = shape.length === 3 ? shape[1] : shape[0];
  const candidates = shape.length === 3 ? shape[2] : shape[1];
  if (!channels || !candidates) return [];

  const detections: Detection[] = [];
  const transposed = shape.length === 3 && channels < candidates;

  for (let i = 0; i < candidates; i += 1) {
    const read = (channel: number) => values[transposed ? channel * candidates + i : i * channels + channel] ?? 0;
    const cx = read(0);
    const cy = read(1);
    const width = read(2);
    const height = read(3);
    const objectness = channels > 5 ? read(4) : 1;
    let classScore = channels > 5 ? 0 : read(4);

    for (let c = 5; c < channels; c += 1) {
      classScore = Math.max(classScore, read(c));
    }

    const score = objectness * classScore;
    if (score < confidenceThreshold) continue;

    detections.push({
      x: (cx - width / 2) * (imageWidth / inputSize),
      y: (cy - height / 2) * (imageHeight / inputSize),
      width: width * (imageWidth / inputSize),
      height: height * (imageHeight / inputSize),
      score
    });
  }

  return nonMaxSuppression(detections, 0.45)
    .filter((detection) => detection.width > imageWidth * 0.08 && detection.height > imageHeight * 0.08)
    .slice(0, 12);
}

function nonMaxSuppression(detections: Detection[], threshold: number): Detection[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const selected: Detection[] = [];

  for (const detection of sorted) {
    if (selected.every((existing) => intersectionOverUnion(detection, existing) < threshold)) {
      selected.push(detection);
    }
  }

  return selected;
}

function intersectionOverUnion(a: Detection, b: Detection): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;

  return union > 0 ? intersection / union : 0;
}

async function getImageInfo(buffer: Buffer): Promise<{ width: number; height: number }> {
  const workdir = await mkdtemp(join(tmpdir(), 'ocr-info-'));
  const inputPath = join(workdir, `${randomUUID()}.img`);

  try {
    await writeFile(inputPath, buffer);
    const { stdout } = await execFileAsync('magick', ['identify', '-format', '%w %h', inputPath]);
    const [width, height] = stdout.trim().split(/\s+/).map(Number);
    if (!width || !height) throw new Error('Invalid image');
    return { width, height };
  } finally {
    await rm(workdir, { force: true, recursive: true });
  }
}

async function runOpenCvPreprocessing(
  buffer: Buffer,
  detection: Detection | null,
  imageInfo: { width: number; height: number }
): Promise<Buffer> {
  const workdir = await mkdtemp(join(tmpdir(), 'ocr-opencv-'));
  const inputPath = join(workdir, `${randomUUID()}.img`);
  const outputPath = join(workdir, 'ocr.png');
  const paddingX = detection ? detection.width * 0.025 : 0;
  const paddingY = detection ? detection.height * 0.025 : 0;
  const x = detection ? clamp(Math.floor(detection.x - paddingX), 0, imageInfo.width - 1) : 0;
  const y = detection ? clamp(Math.floor(detection.y - paddingY), 0, imageInfo.height - 1) : 0;
  const right = detection ? clamp(Math.ceil(detection.x + detection.width + paddingX), x + 1, imageInfo.width) : imageInfo.width;
  const bottom = detection ? clamp(Math.ceil(detection.y + detection.height + paddingY), y + 1, imageInfo.height) : imageInfo.height;
  const textCoverage = await estimateTextCoverage(buffer).catch(() => 0);
  const sharpenAmount = textCoverage > 0.01 ? '1.0' : '0.7';

  try {
    await writeFile(inputPath, buffer);
    const args = [
      inputPath,
      '-auto-orient',
      '-crop',
      `${right - x}x${bottom - y}+${x}+${y}`,
      '+repage',
      '-deskew',
      '40%',
      '-resize',
      '1800x1800>',
      '-colorspace',
      'Gray',
      '(',
      '+clone',
      '-blur',
      '0x18',
      ')',
      '-compose',
      'DivideSrc',
      '-composite',
      '-statistic',
      'Median',
      '1',
      '-contrast-stretch',
      '0.1%x0.1%',
      '-auto-level',
      '-gamma',
      '1.2',
      '-sigmoidal-contrast',
      '3x50%',
      '-unsharp',
      `0x1+${sharpenAmount}+0.01`,
      outputPath
    ];

    await execFileAsync('magick', args);

    return readFile(outputPath);
  } finally {
    await rm(workdir, { force: true, recursive: true });
  }
}

async function estimateTextCoverage(buffer: Buffer): Promise<number> {
  const session = await getTextDetectorSession();
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) return 0;

  const tensor = await imageToTextDetectorTensor(buffer);
  const results = await session.run({ [inputName]: tensor });
  const output = results[outputName];
  if (!output) return 0;

  const values = output.data as Float32Array;
  let active = 0;
  for (const value of values) {
    if (value > 0.3) active += 1;
  }

  return values.length > 0 ? active / values.length : 0;
}

async function imageToTextDetectorTensor(buffer: Buffer): Promise<ort.Tensor> {
  const workdir = await mkdtemp(join(tmpdir(), 'ocr-text-det-'));
  const inputPath = join(workdir, `${randomUUID()}.img`);
  const outputPath = join(workdir, 'rgb.bin');
  const size = 960;

  try {
    await writeFile(inputPath, buffer);
    await execFileAsync('magick', [
      inputPath,
      '-auto-orient',
      '-resize',
      `${size}x${size}!`,
      '-colorspace',
      'RGB',
      '-depth',
      '8',
      `rgb:${outputPath}`
    ]);

    const pixels = await readFile(outputPath);
    const means = [0.485, 0.456, 0.406];
    const stds = [0.229, 0.224, 0.225];
    const data = new Float32Array(3 * size * size);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const offset = y * size + x;
        const pixelOffset = offset * 3;
        data[offset] = (((pixels[pixelOffset] ?? 0) / 255) - means[0]!) / stds[0]!;
        data[size * size + offset] = (((pixels[pixelOffset + 1] ?? 0) / 255) - means[1]!) / stds[1]!;
        data[2 * size * size + offset] = (((pixels[pixelOffset + 2] ?? 0) / 255) - means[2]!) / stds[2]!;
      }
    }

    return new ort.Tensor('float32', data, [1, 3, size, size]);
  } finally {
    await rm(workdir, { force: true, recursive: true });
  }
}

async function cropDocument(buffer: Buffer, detection: Detection | null, imageInfo: { width: number; height: number }): Promise<Buffer> {
  const workdir = await mkdtemp(join(tmpdir(), 'ocr-crop-'));
  const inputPath = join(workdir, `${randomUUID()}.img`);
  const outputPath = join(workdir, 'crop.png');

  try {
    await writeFile(inputPath, buffer);
    await execFileAsync('magick', [inputPath, '-auto-orient', '-crop', cropGeometry(detection, imageInfo), '+repage', outputPath]);
    return readFile(outputPath);
  } finally {
    await rm(workdir, { force: true, recursive: true });
  }
}

async function appendImagesVertically(images: Buffer[]): Promise<Buffer> {
  const workdir = await mkdtemp(join(tmpdir(), 'ocr-append-'));
  const outputPath = join(workdir, 'combined.png');
  const inputPaths = images.map((_, index) => join(workdir, `${index}.png`));

  try {
    await Promise.all(images.map((image, index) => writeFile(inputPaths[index]!, image)));
    await execFileAsync('magick', [...inputPaths, '-background', 'white', '-gravity', 'center', '-append', outputPath]);
    return readFile(outputPath);
  } finally {
    await rm(workdir, { force: true, recursive: true });
  }
}

function sortDetections(detections: Detection[]): Detection[] {
  const rowThreshold = Math.max(...detections.map((detection) => detection.height), 1) * 0.5;
  return [...detections].sort((a, b) => {
    if (Math.abs(a.y - b.y) > rowThreshold) return a.y - b.y;
    return a.x - b.x;
  });
}

async function applyOrientation(buffer: Buffer, angle: number): Promise<Buffer> {
  if (angle === 0) return buffer;

  const workdir = await mkdtemp(join(tmpdir(), 'ocr-rotate-'));
  const inputPath = join(workdir, `${randomUUID()}.img`);
  const outputPath = join(workdir, 'rotated.png');

  try {
    await writeFile(inputPath, buffer);
    await execFileAsync('magick', [inputPath, '-auto-orient', ...rotationArgs(angle), outputPath]);
    return readFile(outputPath);
  } finally {
    await rm(workdir, { force: true, recursive: true });
  }
}

async function detectOrientationWithYoloOpenCv(
  buffer: Buffer,
  detection: Detection | null,
  imageInfo: { width: number; height: number }
): Promise<{ angle: number; buffer: Buffer }> {
  const orientation = await predictDocumentOrientation(buffer, detection, imageInfo);
  const angle = correctionRotation(orientation);
  const rotated = await applyOrientation(buffer, angle);

  return { angle, buffer: rotated };
}

async function predictDocumentOrientation(buffer: Buffer, detection: Detection | null, imageInfo: { width: number; height: number }): Promise<number> {
  const session = await getOrientationSession();
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) throw new Error('Document orientation model has invalid input/output tensors');

  const tensor = await imageToDocOrientationTensor(buffer, detection, imageInfo);
  const results = await session.run({ [inputName]: tensor });
  const output = results[outputName];
  if (!output) throw new Error('Document orientation model returned no output tensor');

  return parseDocOrientationOutput(output);
}

async function imageToDocOrientationTensor(
  buffer: Buffer,
  detection: Detection | null,
  imageInfo: { width: number; height: number }
): Promise<ort.Tensor> {
  const workdir = await mkdtemp(join(tmpdir(), 'ocr-doc-orientation-'));
  const inputPath = join(workdir, `${randomUUID()}.img`);
  const outputPath = join(workdir, 'rgb.bin');
  const crop = cropGeometry(detection, imageInfo);

  try {
    await writeFile(inputPath, buffer);
    await execFileAsync('magick', [
      inputPath,
      '-auto-orient',
      '-crop',
      crop,
      '+repage',
      '-resize',
      '256x256^',
      '-gravity',
      'center',
      '-extent',
      '224x224',
      '-colorspace',
      'RGB',
      '-depth',
      '8',
      `rgb:${outputPath}`
    ]);

    const pixels = await readFile(outputPath);
    const width = 224;
    const height = 224;
    const means = [0.485, 0.456, 0.406];
    const stds = [0.229, 0.224, 0.225];
    const data = new Float32Array(3 * width * height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = y * width + x;
        const pixelOffset = offset * 3;
        data[offset] = (((pixels[pixelOffset] ?? 0) / 255) - means[0]!) / stds[0]!;
        data[width * height + offset] = (((pixels[pixelOffset + 1] ?? 0) / 255) - means[1]!) / stds[1]!;
        data[2 * width * height + offset] = (((pixels[pixelOffset + 2] ?? 0) / 255) - means[2]!) / stds[2]!;
      }
    }

    return new ort.Tensor('float32', data, [1, 3, height, width]);
  } finally {
    await rm(workdir, { force: true, recursive: true });
  }
}

function parseDocOrientationOutput(output: ort.Tensor): number {
  const values = Array.from(output.data as Float32Array);
  const labels = [0, 90, 180, 270];
  let bestIndex = 0;

  for (let i = 1; i < Math.min(values.length, labels.length); i += 1) {
    if ((values[i] ?? 0) > (values[bestIndex] ?? 0)) bestIndex = i;
  }

  return labels[bestIndex] ?? 0;
}

function cropGeometry(detection: Detection | null, imageInfo: { width: number; height: number }): string {
  if (!detection) return `${imageInfo.width}x${imageInfo.height}+0+0`;

  const paddingX = detection.width * 0.025;
  const paddingY = detection.height * 0.025;
  const x = clamp(Math.floor(detection.x - paddingX), 0, imageInfo.width - 1);
  const y = clamp(Math.floor(detection.y - paddingY), 0, imageInfo.height - 1);
  const right = clamp(Math.ceil(detection.x + detection.width + paddingX), x + 1, imageInfo.width);
  const bottom = clamp(Math.ceil(detection.y + detection.height + paddingY), y + 1, imageInfo.height);

  return `${right - x}x${bottom - y}+${x}+${y}`;
}

function rotationArgs(angle: number): string[] {
  if (angle === 90 || angle === 180 || angle === 270) {
    return ['-rotate', String(angle)];
  }

  return [];
}

function correctionRotation(angle: number): number {
  if (angle === 90) return 270;
  if (angle === 270) return 90;
  return angle;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
