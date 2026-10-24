/**
 * server/lib/codex-cli.js — fork (Suslicke/nutritrace): AI_PROVIDER=codex-cli.
 *
 * Runs the OpenAI Codex CLI (`codex exec`, signed in with a ChatGPT subscription) for one model
 * step of Trace. The client runs the tool loop, so each call is stateless: the conversation and
 * the tool list go in as a prompt, the answer comes back through `--output-schema` as
 * {text, tool_calls[name, arguments_json]} (arguments as a JSON string, because a strict schema
 * can't describe every tool's own arguments), images go in with `-i`.
 *
 * Env: CODEX_BIN (codex), CODEX_HOME (the sign-in), CODEX_EFFORT (medium), CODEX_TIMEOUT (seconds,
 * 180), CODEX_UID / CODEX_GID (run codex as that user — when CODEX_HOME belongs to another
 * service, so a refreshed sign-in stays readable for it).
 */
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { chown, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { logger } from '../logger.js';

// Every Codex feature that lets the model act or read beyond the prompt is off: the prompt carries
// user-controlled text (food names from Open Food Facts, chat), and one model step only needs to
// return JSON. Plus the server keeps its data dirs root-only, and codex runs as another uid.
const DISABLE = ['shell_tool', 'unified_exec', 'unified_exec_tty', 'unified_exec_zsh_fork', 'multi_agent',
  'apps', 'plugins', 'remote_plugin', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access',
  'computer_use', 'code_mode_host', 'view_image', 'image_generation', 'hooks', 'skill_search',
  'skill_mcp_dependency_install', 'tool_suggest', 'in_app_local_automation', 'workspace_dependencies',
  'worktrees', 'write_stdin_approval', 'sleep_tool', 'goals'];

const RULES = `You are the model behind a nutrition diary app's assistant. Answer ONLY through the output schema:
- a final answer to the user: put it in "text" and leave "tool_calls" empty;
- to use tools: list them in "tool_calls" (name + "arguments_json", a JSON object string matching that tool's parameters) and leave "text" empty.
Never invent tool names. Do not run commands or read files. Images, if any, are attached in order.`;

/** Flatten OpenAI-shaped content; image parts are collected for `codex -i`. */
function contentText(content, images) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  const out = [];
  for (const part of content) {
    if (part?.type === 'text') out.push(part.text || '');
    else if (part?.type === 'image_url') {
      const m = /^data:([^;]+);base64,(.+)$/s.exec(part.image_url?.url || '');
      if (m) { images.push({ mime: m[1], data: m[2] }); out.push(`[image #${images.length} attached]`); }
    }
  }
  return out.join('\n');
}

/** The prompt for one step: rules, system prompt, tools, then the conversation. */
export function buildPrompt(messages = [], systemPrompt = '', tools = []) {
  const images = [];
  const lines = [RULES, '', '## System prompt of the app', systemPrompt || '(none)', ''];
  if (tools.length) {
    lines.push('## Available tools');
    for (const t of tools) lines.push(JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }));
    lines.push('');
  }
  lines.push('## Conversation');
  for (const m of messages) {
    let role = m.role;
    let text = contentText(m.content, images);
    if (role === 'assistant' && m.tool_calls?.length) {
      const calls = m.tool_calls.map(c => `${c.function?.name}(${c.function?.arguments || '{}'}) id=${c.id}`);
      text = (text ? text + '\n' : '') + 'called tools: ' + calls.join('; ');
    } else if (role === 'tool') {
      role = `tool result id=${m.tool_call_id}`;
    }
    lines.push(`[${role}]`, text, '');
  }
  return { prompt: lines.join('\n'), images };
}

export function outputSchema(toolNames = []) {
  const call = { type: 'object', additionalProperties: false, required: ['name', 'arguments_json'],
    properties: { name: { type: 'string', ...(toolNames.length ? { enum: toolNames } : {}) }, arguments_json: { type: 'string' } } };
  return { type: 'object', additionalProperties: false, required: ['text', 'tool_calls'],
    properties: { text: { type: 'string' }, tool_calls: { type: 'array', items: call, ...(toolNames.length ? {} : { maxItems: 0 }) } } };
}

/** Codex's structured answer → what /api/ai/chat returns: {text} or {assistantMessage, toolCalls}. */
export function toResult(answer, toolNames = []) {
  const calls = [];
  for (const c of answer?.tool_calls || []) {
    if (!toolNames.includes(c?.name)) continue;
    let args = {};
    try { args = JSON.parse(c.arguments_json || '{}') || {}; } catch { /* keep {} */ }
    calls.push({ id: 'call_' + randomUUID().replace(/-/g, '').slice(0, 12), name: c.name, args });
  }
  if (!calls.length) return { text: answer?.text || '' };
  const assistantMessage = { role: 'assistant', content: null, tool_calls: calls.map(c => ({
    id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) };
  return { assistantMessage, toolCalls: calls };
}

function run(argv, { input, cwd, env, uid, gid, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, ...(uid != null ? { uid, gid } : {}), stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Codex CLI timed out')); }, timeoutMs);
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stderr }); });
    child.stdin.end(input);
  });
}

export async function callCodexCli(model, messages, systemPrompt, tools = []) {
  const env = process.env;
  const uid = env.CODEX_UID ? Number(env.CODEX_UID) : null;
  const gid = env.CODEX_GID ? Number(env.CODEX_GID) : uid;
  const work = await mkdtemp(path.join(os.tmpdir(), 'codex-'));
  try {
    const toolNames = tools.map(t => t.name);
    // Which tools reached the model — catches a browser still running an old app build.
    logger.info(`[codex-cli] step: ${toolNames.length} tools${toolNames.includes('create_meal') ? ' (fork tools on)' : ' (no fork tools: old app build?)'}, ${messages.length} msgs`);
    const { prompt, images } = buildPrompt(messages, systemPrompt, tools);
    const files = [path.join(work, 'schema.json')];
    await writeFile(files[0], JSON.stringify(outputSchema(toolNames)));
    const imageArgs = [];
    for (const [i, img] of images.entries()) {
      const ext = img.mime === 'image/png' ? 'png' : img.mime === 'image/webp' ? 'webp' : 'jpg';
      const file = path.join(work, `img${i + 1}.${ext}`);
      await writeFile(file, Buffer.from(img.data, 'base64'));
      files.push(file);
      imageArgs.push('-i', file);
    }
    if (uid != null) for (const f of [work, ...files]) await chown(f, uid, gid);
    const out = path.join(work, 'out.json');
    const argv = [env.CODEX_BIN || 'codex', '-a', 'never', 'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral',
      '--skip-git-repo-check', '-C', work, ...(model ? ['-m', model] : []), '-s', 'read-only',
      ...DISABLE.flatMap(f => ['--disable', f]),
      '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
      '-c', `model_reasoning_effort="${env.CODEX_EFFORT || 'medium'}"`, '--color', 'never',
      '--output-schema', files[0], '-o', out, ...imageArgs, '-'];
    const childEnv = { PATH: env.PATH, HOME: work, LANG: env.LANG || 'C.UTF-8', ...(env.CODEX_HOME ? { CODEX_HOME: env.CODEX_HOME } : {}) };
    const { code, stderr } = await run(argv, { input: prompt, cwd: work, env: childEnv, uid, gid,
      timeoutMs: (Number(env.CODEX_TIMEOUT) || 180) * 1000 });
    let answer;
    try { answer = JSON.parse(await readFile(out, 'utf8')); } catch { answer = null; }
    if (code !== 0 || !answer) {
      // The details stay in the server log; the browser gets a generic message.
      logger.warn(`[codex-cli] exit ${code}: ${stderr.trim().split('\n').slice(-5).join(' | ').slice(0, 800)}`);
      throw new Error('The AI provider (Codex CLI) could not answer. Details are in the server log.');
    }
    return toResult(answer, toolNames);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
