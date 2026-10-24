// One raw-fetch client per candidate extraction LLM. Gate 0 measures both; Gate 1 keeps one.
// When `jsonSchema` is given, the reply comes back as a parsed object (`json`) via the
// provider's structured-output mode, so quotes copied from JSON pages can't break parsing.
export const callLLM = async ({ provider, apiKey, model, baseUrl, system, user, jsonSchema, maxTokens = 16000, fetchImpl = fetch }) => {
  if (provider === 'anthropic') {
    const tool = jsonSchema && { name: 'record_rows', description: 'Record the extracted rows.', input_schema: jsonSchema };
    const res = await fetchImpl(`${baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      // Current Claude models reject `temperature`; extraction relies on the prompt and the quote anchor instead.
      body: JSON.stringify({
        model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }],
        ...(tool ? { tools: [tool], tool_choice: { type: 'tool', name: tool.name } } : {}),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    const toolUse = body.content.find((c) => c.type === 'tool_use');
    return {
      text: body.content.filter((c) => c.type === 'text').map((c) => c.text).join(''),
      json: toolUse?.input,
      stopReason: body.stop_reason,
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
        ...(jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: 'rows', schema: jsonSchema } } } : {}),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`${provider} ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return {
      text: body.choices?.[0]?.message?.content ?? '',
      stopReason: body.choices?.[0]?.finish_reason,
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
