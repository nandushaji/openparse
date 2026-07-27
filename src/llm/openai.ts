import type { LLMClient, LLMRequest, LLMResponse } from '../types.js'

interface OpenAIChoice {
  message: { content: string | null }
}

interface OpenAICompletionResponse {
  choices: OpenAIChoice[]
  usage?: { total_tokens: number }
  error?: { message: string; type: string; code?: string }
}

/**
 * OpenAI-compatible HTTP client. Works with OpenAI, Groq, Azure OpenAI,
 * Ollama (set baseUrl), LM Studio, and any other OpenAI-compatible endpoint.
 */
export class OpenAIClient implements LLMClient {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl.replace(/\/+$/, '')
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
