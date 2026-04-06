declare module '@huggingface/tokenizers' {
  /**
   * Minimal typed wrapper for @huggingface/tokenizers.
   * Only the API used by vector.ts (hf-tokenizers path) is declared.
   */

  export interface EncodedInput {
    readonly ids: readonly number[];
    readonly attention_mask: readonly number[];
    readonly type_ids?: readonly number[];
    [key: string]: unknown;
  }

  export interface Tokenizer {
    encode(text: string, addSpecialTokens?: boolean): EncodedInput;
    encodeBatch(texts: string[], addSpecialTokens?: boolean): EncodedInput[];
  }

  export const Tokenizer: {
    fromFile?(path: string): Promise<Tokenizer>;
    fromBuffer?(buffer: ArrayBuffer): Promise<Tokenizer>;
    from_pretrained?(identifier: string, options?: Record<string, unknown>): Promise<Tokenizer>;
    [key: string]: unknown;
  };
}
