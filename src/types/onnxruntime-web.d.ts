declare module 'onnxruntime-web' {
  export interface InferenceSession {
    readonly inputNames: string[];
    readonly outputNames: string[];
    readonly executionProvider?: string[];
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }

  export interface InferenceSessionFactory {
    create(model: ArrayBuffer | Uint8Array | string, options?: SessionCreateOptions): Promise<InferenceSession>;
  }

  export interface SessionCreateOptions {
    executionProviders?: Array<string | ExecutionProviderConfig>;
    graphOptimizationLevel?: 'disabled' | 'basic' | 'extended' | 'all';
    [key: string]: unknown;
  }

  export interface ExecutionProviderConfig {
    name: string;
    deviceId?: number;
    [key: string]: unknown;
  }

  export interface Tensor<T = ArrayBuffer | Float32Array | Int64Array | BigInt64Array | number[] | string> {
    readonly dims: readonly number[];
    readonly type: string;
    readonly data: T;
  }

  export interface TensorConstructor {
    new <T = ArrayBuffer>(type: string, data: T, dims: number[]): Tensor<T>;
  }

  export interface OrtEnv {
    useFS?: boolean;
    allowLocalModels?: boolean;
    allowRemoteModels?: boolean;
    localModelPath?: string;
    HF_ENDPOINT?: string;
    [key: string]: unknown;
  }

  export const InferenceSession: InferenceSessionFactory;
  export const Tensor: TensorConstructor;
  export const env: OrtEnv;
}

declare module 'onnxruntime-node' {
  export * from 'onnxruntime-web';
}
