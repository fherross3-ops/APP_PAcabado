
// Netlify Function: sobrescribe data/config.csv en GitHub
const GH = 'https://api.github.com';

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function serializeCSV(rows) {
  return rows.map(row => row.map(f => {
    const s = String(f == null ? '' : f);
    return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  }).join(',')).join('\n') + '\n';
}

async function getFile(path) {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = process.env;
  const branch = GITHUB_BRANCH || 'main';
  const url = `${GH}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${branch}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'sisgo-dashboard'
    }
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
}

async function putFile(path, content, sha, message) {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = process.env;
  const branch = GITHUB_BRANCH || 'main';
  const url = `${GH}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'sisgo-dashboard'
    },
    body: JSON.stringify({
      message,
      content: Buffer.from('\uFEFF' + content, 'utf8').toString('base64'),
      sha,
      branch
    })
  });
  if (!res.ok) throw new Error(`PUT ${path}: ${res.status} ${await res.text()}`);
  return await res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const body = JSON.parse(event.body || '{}');
    const { config } = body;
    if (!Array.isArray(config)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta array "config"' }) };
    }
    if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_OWNER || !process.env.GITHUB_REPO) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Faltan variables de entorno GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO' }) };
    }
    const { sha } = await getFile('data/config.csv');
    const header = ['clave', 'valor', 'unidad', 'descripcion', 'actualizado'];
    const rows = [header, ...config.map(c => [
      String(c.clave || '').trim(),
      String(c.valor || '').trim(),
      String(c.unidad || '').trim(),
      String(c.descripcion || '').trim(),
      String(c.actualizado || '').trim()
    ])];
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const result = await putFile('data/config.csv', serializeCSV(rows), sha, `Config actualizada vía dashboard · ${ts}`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, sha: result.content.sha, rows: config.length })
    };
  } catch (err) {
    console.error('guardar-config error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(err.message || err) })
    };
  }
};
