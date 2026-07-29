import { describe, it, expect, vi } from 'vitest'
import { OpenAIClient } from '../src/llm/openai.js'
import { AnthropicClient } from '../src/llm/anthropic.js'
import { parse } from '../src/parse.js'
import type { LLMClient } from '../src/types.js'
import { join } from 'path'
import { fileURLToPath } from 'url'

const FIXTURES = join(fileURLToPath(import.meta.url), '..', 'fixtures')

describe('OpenAIClient constructor', () => {
  it('accepts an options object', () => {
    const client = new OpenAIClient({ apiKey: 'sk-test', baseUrl: 'http://localhost:11434/v1/' })
    expect(client).toBeInstanceOf(OpenAIClient)
  })

  it('accepts positional (apiKey, baseUrl)', () => {
    const client = new OpenAIClient('sk-test', 'https://api.openai.com/v1')
    expect(client).toBeInstanceOf(OpenAIClient)
  })

  it('defaults baseUrl when omitted from options', () => {
    const client = new OpenAIClient({ apiKey: 'sk-test' })
    expect(client).toBeInstanceOf(OpenAIClient)
  })

  it('throws a clear TypeError for missing apiKey in options', () => {
    expect(() => new OpenAIClient({ apiKey: '' } as { apiKey: string })).toThrow(
      /options\.apiKey must be a non-empty string/
    )
  })

  it('throws a clear TypeError for completely wrong args', () => {
    expect(() => new OpenAIClient(42 as unknown as string)).toThrow(/expected new OpenAIClient/)
  })
})

describe('AnthropicClient constructor', () => {
  it('accepts an options object', () => {
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' })
    expect(client).toBeInstanceOf(AnthropicClient)
  })

  it('accepts positional apiKey', () => {
    const client = new AnthropicClient('sk-ant-test')
    expect(client).toBeInstanceOf(AnthropicClient)
  })
})

describe('parse() client passthrough', () => {
  it('uses the injected client instead of requiring an API key', async () => {
    const chat = vi.fn().mockResolvedValue({
      content: '# Hello\n\nInjected client worked.',
      tokensUsed: 10,
    })
    const client: LLMClient = { chat }

    const result = await parse(join(FIXTURES, 'simple.pdf'), {
      client,
      mode: 'cost_effective',
      model: 'test-model',
    })

    expect(chat).toHaveBeenCalled()
    expect(result.markdown).toContain('Injected client worked')
    expect(result.errors).toHaveLength(0)
  })

  it('does not require apiKey when client is provided', async () => {
    const prev = process.env['OPENAI_API_KEY']
    delete process.env['OPENAI_API_KEY']

    try {
      const client: LLMClient = {
        chat: async () => ({ content: 'ok', tokensUsed: 1 }),
      }
      const result = await parse(join(FIXTURES, 'simple.pdf'), {
        client,
        mode: 'cost_effective',
      })
      expect(result.errors).toHaveLength(0)
    } finally {
      if (prev !== undefined) process.env['OPENAI_API_KEY'] = prev
    }
  })
})
