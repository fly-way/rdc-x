import dns from 'node:dns/promises';
import net from 'node:net';

function isPrivateIp(value: string) {
  const ip = value.replace(/^\[|\]$/g, '').split('%')[0]!;
  const kind = net.isIP(ip);
  if (kind === 4) {
    const p = ip.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1]! >= 64 && p[1]! <= 127) ||
      p[0]! >= 224;
  }
  if (kind === 6) {
    const x = ip.toLowerCase();
    return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') ||
      /^fe[89ab]/.test(x) || x.startsWith('ff') || x.startsWith('2001:db8:') ||
      x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.');
  }
  return true;
}

export class NetworkService {
  async assertPublic(url: URL) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https URLs are supported.');
    if (url.username || url.password) throw new Error('URL credentials are not allowed.');
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Local/private network URLs are blocked.');
    const literal = net.isIP(host);
    if (literal) {
      if (isPrivateIp(host)) throw new Error('Local/private network URLs are blocked.');
      return;
    }
    const answers = await dns.lookup(host, { all: true, verbatim: true });
    if (!answers.length || answers.some(a => isPrivateIp(a.address))) throw new Error('Local/private network URLs are blocked.');
  }

  async read(urlText: string, maxBytes = 2 * 1024 * 1024) {
    let url = new URL(urlText);
    for (let redirects = 0; redirects <= 5; redirects++) {
      await this.assertPublic(url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let response: Response;
      try {
        response = await fetch(url, {
          redirect: 'manual', signal: controller.signal,
          headers: { 'User-Agent': 'RDC-X/0.2 (+personal MCP)', Accept: 'text/*,application/json,application/xml;q=0.9,*/*;q=0.1' }
        });
      } finally { clearTimeout(timer); }
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect response did not include Location.');
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const length = Number(response.headers.get('content-length') || 0);
      if (length > maxBytes) throw new Error('Response exceeds configured URL read limit.');
      const reader = response.body?.getReader();
      if (!reader) return { url: url.toString(), status: response.status, contentType: response.headers.get('content-type') || '', text: '' };
      const chunks: Uint8Array[] = []; let total = 0;
      while (true) {
        const item = await reader.read(); if (item.done) break;
        total += item.value.byteLength;
        if (total > maxBytes) { await reader.cancel(); throw new Error('Response exceeds configured URL read limit.'); }
        chunks.push(item.value);
      }
      const bytes = Buffer.concat(chunks.map(x => Buffer.from(x)));
      const type = response.headers.get('content-type') || '';
      if (!/^(text\/|application\/(json|xml|javascript|xhtml\+xml))/i.test(type))
        throw new Error('URL content type is not supported as text: ' + (type || 'unknown'));
      return {
        url: url.toString(), status: response.status, contentType: type,
        bytes: bytes.length, text: bytes.toString('utf8')
      };
    }
    throw new Error('Too many redirects.');
  }
}
