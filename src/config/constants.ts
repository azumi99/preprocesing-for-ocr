export const port = Number(process.env.PORT || 3000);
export const host = process.env.HOST || '0.0.0.0';
export const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024);
export const maxConcurrentPreprocess = Number(process.env.MAX_CONCURRENT_PREPROCESS || 2);
export const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 120_000);
