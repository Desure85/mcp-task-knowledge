declare module '@xenova/transformers' {
  // Minimal typings to satisfy TS when importing dynamically
  export const env: any;
  export class AutoTokenizer {
    static from_pretrained(modelPath: string, options?: any): Promise<any>;
  }
}
