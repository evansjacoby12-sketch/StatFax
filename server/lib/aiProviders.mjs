export const OPENAI_DEFAULT_MODEL = 'gpt-5.6-luna'
export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

function clean(value, max = 2000) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
}

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function fetchJsonWithRetry({
  label,
  url,
  init,
  fetchImpl,
  maxAttempts = 3,
  sleepImpl = defaultSleep,
}) {
  const attempts = Math.max(1, Math.min(5, Number(maxAttempts) || 3))
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response
    try {
      response = await fetchImpl(url, init)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }

    if (response) {
      if (response.ok) {
        try {
          return await response.json()
        } catch (error) {
          lastError = new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
        }
      } else {
        const body = await response.text()
        const error = new Error(`${label} ${response.status}: ${body.slice(0, 300)}`)
        const quotaExhausted = /"code"\s*:\s*"insufficient_quota"/i.test(body)
        const retryable = !quotaExhausted && (response.status === 429 || response.status >= 500)
        if (!retryable || attempt === attempts) throw error
        lastError = error
      }
    }

    if (attempt === attempts) throw lastError || new Error(`${label} request failed`)
    await sleepImpl(400 * (2 ** (attempt - 1)))
  }
  throw lastError || new Error(`${label} request failed`)
}

export function openAiOutputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text.trim()
  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('')
    .trim()
}

export async function callOpenAiStructured({
  apiKey,
  model = OPENAI_DEFAULT_MODEL,
  instructions,
  input,
  schema,
  schemaName,
  maxOutputTokens = 2500,
  fetchImpl = fetch,
  maxAttempts = 3,
  sleepImpl = defaultSleep,
}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required')
  const payload = await fetchJsonWithRetry({
    label: 'OpenAI API',
    url: OPENAI_RESPONSES_URL,
    fetchImpl,
    maxAttempts,
    sleepImpl,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions: clean(instructions, 12_000),
        input: clean(input, 80_000),
        max_output_tokens: Math.max(64, Math.min(20_000, Number(maxOutputTokens) || 2500)),
        text: {
          format: {
            type: 'json_schema',
            name: clean(schemaName, 64) || 'structured_response',
            strict: true,
            schema,
          },
        },
      }),
    },
  })
  const text = openAiOutputText(payload)
  if (!text) throw new Error('OpenAI response contained no output text')
  try {
    return { value: JSON.parse(text), responseId: payload?.id || null, model: payload?.model || model }
  } catch {
    throw new Error('OpenAI structured response was not valid JSON')
  }
}
