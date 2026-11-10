// Single source of truth for model providers: endpoint, labels and payload quirks.
export const PROVIDERS = {
  groq: {
    label: 'Groq · Qwen 3.8 27B',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'qwen/qwen3.8-27b',
    apiKeyEnv: 'GROQ_API_KEY',
    extra: { reasoning_effort: 'none' }
  },
  qwen: {
    label: '千问 · Qwen 3.8 Flash',
    baseUrl: 'https://maas.qianwenaiapi.com/compatible-mode/v1',
    model: 'qwen3.8-flash',
    apiKeyEnv: 'QWEN_API_KEY',
    extra: { enable_thinking: false }
  },
  sf: {
    label: '硅基流动 · Qwen3.5 4B',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen3.5-4B',
    apiKeyEnv: 'SF_API_KEY',
    extra: { enable_thinking: false }
  }
};

export const DEFAULT_PROVIDER = 'groq';

export function isProvider(name) {
  return typeof name === 'string' && Object.hasOwn(PROVIDERS, name);
}
