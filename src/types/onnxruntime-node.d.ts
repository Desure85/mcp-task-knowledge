declare module 'onnxruntime-node' {
  export interface InferenceSession {
    // Simplified shape; we don't rely on strong typing here
  }
  export const InferenceSession: {
    create(modelPath: string): Promise<InferenceSession>;
  };
}
