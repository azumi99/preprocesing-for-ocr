export type Bounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PreprocessResult = {
  output: Buffer;
  cropped: boolean;
  deskewAngle: number;
  orientationAngle: number;
  orientationMethod: 'pp-lcnet-doc-ori';
  detector: 'yolo';
  preprocessing: 'opencv-text-det';
  detectionStatus: 'detected' | 'not_detected';
  documentCount: number;
};
