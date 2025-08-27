declare module '@huggingface/tokenizers' {
  // Minimal ambient types to satisfy TS when the native package is not installed at build time.
  // Runtime is handled via optional dynamic import in code.
  export const Tokenizer: any;
}
