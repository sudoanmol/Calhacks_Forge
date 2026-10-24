// One raw-fetch client per candidate extraction LLM. Gate 0 measures both; Gate 1 keeps one.
export const callLLM = async ({ provider, apiKey, model, baseUrl, system, user, maxTokens = 8000, fetchImpl = fetch }) => {
  if (provider === 'anthropic') {
    const res = await fetchImpl(`${baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return {
      text: body.content.filter((c) => c.type === 'text').map((c) => c.text).join(''),
      usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 },
    };
  }
  if (provider === 'asi1' || provider === 'openai') {
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`${provider} ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return {
      text: body.choices?.[0]?.message?.content ?? '',
      usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 },
    };
  }
  throw new Error(`unknown LLM provider: ${provider}`);
};

export const parseJsonObject = (text) => {
  const s = String(text).replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in LLM output');
  return JSON.parse(s.slice(start, end + 1));
};
