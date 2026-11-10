// Single source of truth for model endpoints and the labels shown on the receipt.
export const MODELS = {
  primary: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'qwen/qwen3.8-27b',
    label: 'Groq · Qwen 3.8 27B'
  },
  fallback: {
    baseUrl: 'https://maas.qianwenaiapi.com/compatible-mode/v1',
    model: 'qwen3.8-flash',
    label: '千问 · Qwen 3.8 Flash'
  }
};
