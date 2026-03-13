import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'POST' && url.pathname === '/api/youtube') {
      await handleYoutube(req, res);
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`Visualizer server running on http://localhost:${PORT}`);
});

async function serveStatic(pathname, res) {
  let requestPath = decodeURIComponent(pathname);
  if (requestPath === '/') {
    requestPath = '/index.html';
  }

  const target = path.resolve(ROOT, `.${requestPath}`);
  if (!target.startsWith(ROOT)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const data = await readFile(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': MIME[ext] || 'application/octet-stream',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: `Not found: ${pathname}` });
  }
}

async function handleYoutube(req, res) {
  const body = await readJsonBody(req);
  const sourceUrl = String(body?.url || '').trim();
  if (!sourceUrl) {
    sendJson(res, 400, { error: 'Missing YouTube URL.' });
    return;
  }

  if (!isLikelyYouTubeUrl(sourceUrl)) {
    sendJson(res, 400, { error: 'Please provide a valid YouTube link.' });
    return;
  }

  try {
    const streamUrl = await resolveStreamUrl(sourceUrl);
    const titleRaw = await runYtDlp(['--no-playlist', '--print', '%(title)s', sourceUrl]).catch(() => 'YouTube Stream');
    const title = titleRaw.split(/\r?\n/).find((line) => line.trim())?.trim() || 'YouTube Stream';
    sendJson(res, 200, { streamUrl, title });
  } catch (error) {
    const details = shorten(String(error.message || error), 280);
    sendJson(res, 500, {
      error:
        `yt-dlp failed: ${details}. Ensure yt-dlp is installed and updated (` +
        `run: yt-dlp -U), and try again.`,
    });
  }
}

function isLikelyYouTubeUrl(raw) {
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    return host.includes('youtube.com') || host.includes('youtu.be');
  } catch {
    return false;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error('Request body too large.');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw);
}

async function runYtDlp(args) {
  const { stdout, stderr } = await execFileAsync('yt-dlp', args, {
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (!stdout?.trim()) {
    throw new Error(stderr?.trim() || 'Empty yt-dlp output.');
  }

  return stdout.trim();
}

async function resolveStreamUrl(sourceUrl) {
  const commandVariants = [
    ['--no-playlist', '-f', 'bestaudio', '-g', sourceUrl],
    ['--no-playlist', '--extractor-args', 'youtube:player_client=web', '-f', 'bestaudio', '-g', sourceUrl],
    ['--no-playlist', '-f', 'bestaudio/best', '-g', sourceUrl],
  ];

  let lastError = null;
  for (const args of commandVariants) {
    try {
      const raw = await runYtDlp(args);
      const streamUrl =
        raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.startsWith('http')) || '';
      if (streamUrl) {
        return streamUrl;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Could not resolve a direct audio stream.');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

function shorten(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}
