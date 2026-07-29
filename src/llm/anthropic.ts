import type { LLMClient, LLMRequest, LLMResponse, LLMMessage } from '../types.js'

const DEFAULT_BASE_URL = 'https://api.anthropic.com'

/** Strip trailing slashes without a regex (avoids polynomial ReDoS). */
function trimTrailingSlashes(s: string): string {
  let end = s.length
  while (end > 0 && s[end - 1] === '/') end--
  return end === s.length ? s : s.slice(0, end)
}

export interface AnthropicClientOptions {
  apiKey: string
  /** Default: `https://api.anthropic.com` */
  baseUrl?: string
}

interface AnthropicContent {
  type: string
  text?: string
}

interface AnthropicResponse {
  content: AnthropicContent[]
  usage?: { input_tokens: number; output_tokens: number }
  error?: { message: string; type: string }
}

function resolveAnthropicArgs(
  apiKeyOrOptions: string | AnthropicClientOptions,
  baseUrl?: string
): { apiKey: string; baseUrl: string } {
  if (typeof apiKeyOrOptions === 'object' && apiKeyOrOptions !== null) {
    const { apiKey, baseUrl: url } = apiKeyOrOptions
    if (typeof apiKey !== 'string' || !apiKey) {
      throw new TypeError(
        'AnthropicClient: options.apiKey must be a non-empty string. ' +
          'Usage: new AnthropicClient({ apiKey, baseUrl? })'
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
    'AnthropicClient: expected new AnthropicClient({ apiKey, baseUrl? }) ' +
      'or new AnthropicClient(apiKey, baseUrl?). ' +
      `Received: ${typeof apiKeyOrOptions}`
  )
}

/**
 * Anthropic Messages API adapter. Translates from OpenAI-style LLMRequest
 * to Anthropic's format: separate system parameter, image via source.base64.
 *
 * @example
 * new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY! })
 * new AnthropicClient(apiKey, baseUrl) // positional form still supported
 */
export class AnthropicClient implements LLMClient {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(options: AnthropicClientOptions)
  constructor(apiKey: string, baseUrl?: string)
  constructor(apiKeyOrOptions: string | AnthropicClientOptions, baseUrl?: string) {
    const resolved = resolveAnthropicArgs(apiKeyOrOptions, baseUrl)
    this.apiKey = resolved.apiKey
    this.baseUrl = resolved.baseUrl
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
