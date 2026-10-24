/**
 * Fork (Suslicke/nutritrace): AI_PROVIDER=codex-cli turns one Trace step into a Codex prompt and
 * its structured answer back into /api/ai/chat's {text} / {assistantMessage, toolCalls}.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt, outputSchema, toResult } from '../server/lib/codex-cli.js';

const TOOLS = [{ name: 'log_food', description: 'Log a food', parameters: { type: 'object', properties: { grams: { type: 'number' } } } }];

test('the prompt carries the system prompt, tools, tool turns and images', () => {
  const png = 'data:image/png;base64,' + Buffer.from('x').toString('base64');
  const { prompt, images } = buildPrompt([
    { role: 'user', content: [{ type: 'text', text: 'what is this?' }, { type: 'image_url', image_url: { url: png } }] },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'log_food', arguments: '{"grams":200}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
  ], 'You are Trace.', TOOLS);
  assert.match(prompt, /You are Trace\./);
  assert.match(prompt, /"name":"log_food"/);
  assert.match(prompt, /called tools: log_food\(\{"grams":200\}\) id=c1/);
  assert.match(prompt, /\[tool result id=c1\]\n\{"ok":true\}/);
  assert.deepEqual(images, [{ mime: 'image/png', data: Buffer.from('x').toString('base64') }]);
});

test('the schema allows only known tools, or none', () => {
  assert.deepEqual(outputSchema(['log_food']).properties.tool_calls.items.properties.name.enum, ['log_food']);
  assert.equal(outputSchema([]).properties.tool_calls.maxItems, 0);
});

test('answers map to text or tool calls; unknown tools and bad JSON are dropped safely', () => {
  assert.deepEqual(toResult({ text: 'Готово', tool_calls: [] }, ['log_food']), { text: 'Готово' });
  const r = toResult({ text: '', tool_calls: [
    { name: 'log_food', arguments_json: '{"grams":150}' },
    { name: 'rm_rf', arguments_json: '{}' },
    { name: 'log_food', arguments_json: 'not json' },
  ] }, ['log_food']);
  assert.equal(r.toolCalls.length, 2);
  assert.deepEqual(r.toolCalls.map(c => c.args), [{ grams: 150 }, {}]);
  assert.equal(r.assistantMessage.tool_calls[0].function.arguments, '{"grams":150}');
  assert.equal(r.assistantMessage.tool_calls[0].id, r.toolCalls[0].id);
});
