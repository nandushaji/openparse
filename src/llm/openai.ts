import type { LLMClient, LLMRequest, LLMResponse } from '../types.js'

/** Strip trailing slashes without a regex (avoids polynomial ReDoS). */
function trimTrailingSlashes(s: string): string {
  let end = s.length
  while (end > 0 && s[end - 1] === '/') end--
  return end === s.length ? s : s.slice(0, end)
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export interface OpenAIClientOptions {
  apiKey: string
  /** Default: `https://api.openai.com/v1`. Override for Groq, Azure, Ollama, etc. */
  baseUrl?: string
}

interface OpenAIChoice {
  message: { content: string | null }
}

interface OpenAICompletionResponse {
  choices: OpenAIChoice[]
  usage?: { total_tokens: number }
  error?: { message: string; type: string; code?: string }
}

function resolveOpenAIArgs(
  apiKeyOrOptions: string | OpenAIClientOptions,
  baseUrl?: string
): { apiKey: string; baseUrl: string } {
  if (typeof apiKeyOrOptions === 'object' && apiKeyOrOptions !== null) {
    const { apiKey, baseUrl: url } = apiKeyOrOptions
    if (typeof apiKey !== 'string' || !apiKey) {
      throw new TypeError(
        'OpenAIClient: options.apiKey must be a non-empty string. ' +
          'Usage: new OpenAIClient({ apiKey, baseUrl? })'
      )
    }
    return { apiKey, baseUrl: trimTrailingSlashes(url ?? DEFAULT_BASE_URL) }
  }

  if (typeof apiKeyOrOptions === 'string') {
    return {
      apiKey: apiKeyOrOptions,
      baseUrl: trimTrailingSlashes(baseUrl ?? DEFAULT_BASE_URL),
    }
  }

  throw new TypeError(
    'OpenAIClient: expected new OpenAIClient({ apiKey, baseUrl? }) ' +
      'or new OpenAIClient(apiKey, baseUrl?). ' +
      `Received: ${typeof apiKeyOrOptions}`
  )
}

/**
 * OpenAI-compatible HTTP client. Works with OpenAI, Groq, Azure OpenAI,
 * Ollama (set baseUrl), LM Studio, and any other OpenAI-compatible endpoint.
 *
 * @example
 * new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! })
 * new OpenAIClient({ apiKey: 'ollama', baseUrl: 'http://localhost:11434/v1' })
 * new OpenAIClient(apiKey, baseUrl) // positional form still supported
 */
export class OpenAIClient implements LLMClient {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(options: OpenAIClientOptions)
  constructor(apiKey: string, baseUrl?: string)
  constructor(apiKeyOrOptions: string | OpenAIClientOptions, baseUrl?: string) {
    const resolved = resolveOpenAIArgs(apiKeyOrOptions, baseUrl)
    this.apiKey = resolved.apiKey
    this.baseUrl = resolved.baseUrl
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const url = `${this.baseUrl}/chat/completions`

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0,
    }

    if (request.max_tokens != null) body['max_tokens'] = request.max_tokens
    if (request.response_format) body['response_format'] = request.response_format

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      let detail = ''
      try {
        const err = (await res.json()) as { error?: { message: string } }
        detail = err.error?.message ?? ''
      } catch {
        detail = await res.text().catch(() => '')
      }
      throw new Error(`LLM API error ${res.status}: ${detail || res.statusText}`)
    }

    const data = (await res.json()) as OpenAICompletionResponse

    if (data.error) {
      throw new Error(`LLM API error: ${data.error.message}`)
    }

    const content = data.choices?.[0]?.message?.content ?? ''

    return {
      content,
      tokensUsed: data.usage?.total_tokens,
    }
  }
}
