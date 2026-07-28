import type { LLMClient, LLMRequest, LLMResponse, LLMMessage } from '../types.js'

interface AnthropicContent {
  type: string
  text?: string
}

interface AnthropicResponse {
  content: AnthropicContent[]
  usage?: { input_tokens: number; output_tokens: number }
  error?: { message: string; type: string }
}

/**
 * Anthropic Messages API adapter. Translates from OpenAI-style LLMRequest
 * to Anthropic's format: separate system parameter, image via source.base64.
 */
export class AnthropicClient implements LLMClient {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(apiKey: string, baseUrl = 'https://api.anthropic.com') {
    this.apiKey = apiKey
    let url = baseUrl
    let i = url.length
    while (i > 0 && url[i - 1] === '/') i--
    this.baseUrl = i === url.length ? url : url.slice(0, i)
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const url = `${this.baseUrl}/v1/messages`

    const systemMsg = request.messages.find(m => m.role === 'system')
    const conversationMsgs = request.messages.filter(m => m.role !== 'system')

    const messages = conversationMsgs.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: this.convertContent(msg),
    }))

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens ?? 4096,
      temperature: request.temperature ?? 0,
    }

    if (systemMsg) {
      body['system'] = this.extractText(systemMsg)
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
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
      throw new Error(`Anthropic API error ${res.status}: ${detail || res.statusText}`)
    }

    const data = (await res.json()) as AnthropicResponse

    if (data.error) {
      throw new Error(`Anthropic API error: ${data.error.message}`)
    }

    const content = data.content
      .filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('')

    return {
      content,
      tokensUsed: data.usage
        ? data.usage.input_tokens + data.usage.output_tokens
        : undefined,
    }
  }

  private convertContent(msg: LLMMessage): unknown {
    if (typeof msg.content === 'string') {
      return msg.content
    }

    return msg.content.map(part => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text ?? '' }
      }

      if (part.type === 'image_url' && part.image_url) {
        const url = part.image_url.url

        if (url.startsWith('data:')) {
          // data:image/png;base64,<data>
          const semi = url.indexOf(';')
          const comma = url.indexOf(',')
          const mediaType = url.slice(5, semi)
          const data = url.slice(comma + 1)
          return {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data },
          }
        }

        // Remote URL — Anthropic supports these directly
        return {
          type: 'image',
          source: { type: 'url', url },
        }
      }

      return { type: 'text', text: '' }
    })
  }

  private extractText(msg: LLMMessage): string {
    if (typeof msg.content === 'string') return msg.content
    return msg.content
      .filter(p => p.type === 'text')
      .map(p => p.text ?? '')
      .join('')
  }
}
