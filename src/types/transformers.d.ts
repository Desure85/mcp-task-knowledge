declare module '@xenova/transformers' {
  /**
   * Minimal typed wrapper for @xenova/transformers.
   * Only the APIs used by vector.ts are declared.
   */

  export interface XenovaEnv {
    useFS?: boolean;
    allowLocalModels?: boolean;
    allowRemoteModels?: boolean;
    localModelPath?: string;
    HF_ENDPOINT?: string;
    [key: string]: unknown;
  }

  export interface TokenizerOutput {
    input_ids: ArrayLike<number | bigint>;
    attention_mask: ArrayLike<number | bigint>;
    [key: string]: unknown;
  }

  export interface TokenizerEncodeOptions {
    add_special_tokens?: boolean;
    padding?: boolean | string;
    truncation?: boolean | number | { max_length?: number };
    [key: string]: unknown;
  }

  export interface XenovaTokenizer {
    (text: string, options?: TokenizerEncodeOptions): Promise<TokenizerOutput>;
  }

  export interface AutoTokenizerClass {
    static from_pretrained(modelPath: string, options?: Record<string, unknown>): Promise<XenovaTokenizer>;
  }

  export const env: XenovaEnv;
  export const AutoTokenizer: AutoTokenizerClass;
}
