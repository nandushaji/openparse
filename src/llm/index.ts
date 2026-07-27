import type { LLMClient, LLMProvider } from '../types.js'
import { OpenAIClient } from './openai.js'
import { AnthropicClient } from './anthropic.js'

export { OpenAIClient } from './openai.js'
export { AnthropicClient } from './anthropic.js'

export interface CreateLLMClientOptions {
  apiKey: string
  baseUrl: string
  provider: LLMProvider
}

export function createLLMClient(options: CreateLLMClientOptions): LLMClient {
  switch (options.provider) {
    case 'anthropic':
      return new AnthropicClient(options.apiKey, options.baseUrl)
    case 'openai':
    case 'compatible':
    default:
      return new OpenAIClient(options.apiKey, options.baseUrl)
  }
}
