// Netlify Function: agrega una fila a data/comentarios.csv en GitHub
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
  return rows.filter(r => r.length > 1 || (r[0] || '').trim() !== '');
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
    const c = body.comentario;
    if (!c || !c.titulo || !c.creado_por) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Faltan campos obligatorios: titulo, creado_por' }) };
    }
    if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_OWNER || !process.env.GITHUB_REPO) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Faltan variables de entorno GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO' }) };
    }
    const { content, sha } = await getFile('data/comentarios.csv');
    const rows = parseCSV(content);
    const header = rows[0] || ['id', 'fecha', 'proceso', 'categoria', 'titulo', 'descripcion', 'lote', 'responsable', 'estado', 'prioridad', 'creado_por', 'creado_en'];
    const dataRows = rows.slice(1);
    let maxId = 0;
    for (const r of dataRows) {
      const n = parseInt(r[0]);
      if (!isNaN(n) && n > maxId) maxId = n;
    }
    const id = maxId + 1;
    const now = new Date();
    const fecha = now.toISOString().slice(0, 10);
    const creadoEn = now.toISOString().replace('T', ' ').slice(0, 16);
    const newRow = [
      String(id), fecha,
      c.proceso || 'general', c.categoria || 'otro',
      c.titulo || '', c.descripcion || '',
      c.lote || '', c.responsable || '',
      c.estado || 'abierto', c.prioridad || 'media',
      c.creado_por || '', creadoEn
    ];
    dataRows.push(newRow);
    const newContent = serializeCSV([header, ...dataRows]);
    const result = await putFile('data/comentarios.csv', newContent, sha, `Comentario #${id}: ${c.titulo.slice(0, 50)}`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, id, sha: result.content.sha })
    };
  } catch (err) {
    console.error('agregar-comentario error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(err.message || err) })
    };
  }
};
