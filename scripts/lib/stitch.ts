import { execSync } from 'node:child_process';
import https from 'node:https';
import './config.ts'; // подхватывает .env

/** Прямой вызов Stitch MCP-эндпоинта по HTTP: агенту (Claude/Codex/Cursor) не нужен MCP-клиент, base64 не идёт в контекст. */
const ENDPOINT = 'https://stitch.googleapis.com/mcp';

function apiKey(): string {
  let key = process.env.STITCH_API_KEY ?? '';
  // .env (через config.ts) или переменная окружения; setx не попадает в уже запущенные процессы — читаем реестр
  if (!key && process.platform === 'win32') {
    try {
      const out = execSync('reg query HKCU\\Environment /v STITCH_API_KEY', { encoding: 'utf8' });
      key = out.match(/STITCH_API_KEY\s+REG_\w+\s+(\S+)/)?.[1] ?? '';
    } catch {
      /* not set */
    }
  }
  if (!key) throw new Error('STITCH_API_KEY не задан: добавить в .env (см. .env.example) или setx STITCH_API_KEY "<key>"');
  return key;
}

let rpcId = 0;

export async function stitchCall<T = any>(tool: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': apiKey(),
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Stitch ${tool}: HTTP ${res.status} ${text.slice(0, 300)}`);
  // ответ может прийти как JSON или как SSE (data: {...})
  const json = text.trimStart().startsWith('{')
    ? JSON.parse(text)
    : JSON.parse(text.split('\n').filter((l) => l.startsWith('data:')).pop()!.slice(5));
  if (json.error) throw new Error(`Stitch ${tool}: ${JSON.stringify(json.error).slice(0, 300)}`);
  const r = json.result;
  if (r?.isError) throw new Error(`Stitch ${tool}: ${r.content?.[0]?.text ?? 'error'}`);
  return (r?.structuredContent ?? JSON.parse(r?.content?.[0]?.text ?? 'null')) as T;
}

/**
 * Долгий вызов (генерация/правка экрана, 2–6 мин) через node:https без таймаута.
 * MCP-клиенты агентов обрывают такие вызовы по таймауту, и тогда Stitch НЕ сохраняет экран.
 */
export function stitchCallLong<T = any>(tool: string, args: Record<string, unknown>): Promise<T> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: tool, arguments: args } });
  return new Promise((resolve, reject) => {
    const req = https.request(
      ENDPOINT,
      {
        method: 'POST',
        headers: {
          'X-Goog-Api-Key': apiKey(),
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          try {
            if ((res.statusCode ?? 0) >= 400) throw new Error(`Stitch ${tool}: HTTP ${res.statusCode} ${text.slice(0, 300)}`);
            const json = text.trimStart().startsWith('{')
              ? JSON.parse(text)
              : JSON.parse(text.split('\n').filter((l) => l.startsWith('data:')).pop()!.slice(5));
            if (json.error) throw new Error(`Stitch ${tool}: ${JSON.stringify(json.error).slice(0, 300)}`);
            const r = json.result;
            if (r?.isError) throw new Error(`Stitch ${tool}: ${r.content?.[0]?.text ?? 'error'}`);
            resolve((r?.structuredContent ?? JSON.parse(r?.content?.[0]?.text ?? 'null')) as T);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.setTimeout(0);
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** "projects/123" | "123" | "https://stitch.withgoogle.com/projects/123" -> "123" */
export function bareProjectId(s: string): string {
  return s.match(/projects\/(\d+)/)?.[1] ?? s.trim();
}

/** "projects/1/screens/abc" | "abc" -> "abc" */
export function bareScreenId(s: string): string {
  return s.match(/screens\/([^/]+)/)?.[1] ?? s.trim();
}
