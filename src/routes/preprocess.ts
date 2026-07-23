import { Router, Request, Response } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { preprocessDocument } from '../services/preprocessService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }

    cb(new Error('Only image files are allowed'));
  }
});

export const preprocessRouter = Router();

preprocessRouter.post('/preprocess', upload.single('image'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'Field image is required' });
    return;
  }

  try {
    const result = await preprocessDocument(req.file.buffer);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Cropped', String(result.cropped));
    res.setHeader('X-Deskew-Angle', String(result.deskewAngle));
    res.setHeader('X-Orientation-Angle', String(result.orientationAngle));
    res.setHeader('X-Orientation-Method', result.orientationMethod);
    res.setHeader('X-Detector', result.detector);
    res.setHeader('X-Preprocessing', result.preprocessing);
    res.setHeader('X-Detection-Status', result.detectionStatus);
    res.setHeader('X-Document-Count', String(result.documentCount));
    res.send(result.output);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Preprocessing failed', message });
  }
});
