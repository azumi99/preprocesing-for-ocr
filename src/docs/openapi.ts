export function createOpenApiDocument(port: number) {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
  return {
    openapi: '3.1.0',
    info: {
      title: 'OCR Preprocessing API',
      version: '1.0.0',
      description: 'API untuk preprocessing gambar dokumen sebelum OCR memakai YOLO untuk deteksi dokumen dan OpenCV untuk crop, deskew, denoise, contrast, dan binarization.'
    },
    servers: [{ url: publicBaseUrl }],
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          responses: {
            200: {
              description: 'API status',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { ok: { type: 'boolean' } }
                  }
                }
              }
            }
          }
        }
      },
      '/preprocess': {
        post: {
          summary: 'Preprocess document image for OCR',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['image'],
                  properties: {
                    image: {
                      type: 'string',
                      format: 'binary',
                      description: 'Foto atau scan dokumen/kertas'
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: 'Processed PNG image',
              headers: {
                'X-Cropped': { schema: { type: 'boolean' } },
                'X-Deskew-Angle': { schema: { type: 'number' } },
                'X-Orientation-Angle': { schema: { type: 'number' } },
                'X-Orientation-Method': { schema: { type: 'string', enum: ['pp-lcnet-doc-ori'] } },
                'X-Detector': { schema: { type: 'string', enum: ['yolo'] } },
                'X-Preprocessing': { schema: { type: 'string', enum: ['opencv-text-det'] } },
                'X-Detection-Status': { schema: { type: 'string', enum: ['detected', 'not_detected'] } },
                'X-Document-Count': { schema: { type: 'number' } }
              },
              content: {
                'image/png': {
                  schema: { type: 'string', format: 'binary' }
                }
              }
            },
            400: { description: 'Invalid upload' },
            500: { description: 'Preprocessing failed' }
          }
        }
      }
    }
  };
}
