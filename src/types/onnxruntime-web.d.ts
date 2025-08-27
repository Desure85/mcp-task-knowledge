declare module 'onnxruntime-web' {
  export class InferenceSession {
    constructor(options?: any);
    static create(model: ArrayBuffer | Uint8Array | string, options?: any): Promise<InferenceSession>;
    inputNames: string[];
    outputNames: string[];
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }
  export class Tensor<T = any> {
    constructor(type: string, data: T, dims: number[]);
    readonly dims: number[];
    readonly type: string;
    readonly data: T;
  }
  export const env: any;
}
