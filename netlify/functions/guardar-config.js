// Sin dependencias externas: usa fetch nativo (Netlify Node 18+)
const CSV_PATH = 'data/config.csv';
const HEADERS = ['clave', 'valor', 'unidad', 'descripcion', 'actualizado'];

function escapeCSV(v) {
  const s = String(v == null ? '' : v);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const token  = process.env.GITHUB_TOKEN;
  const owner  = process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!token || !owner || !repo) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Faltan variables de entorno: GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO',
      }),
    };
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${CSV_PATH}`;
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'sisgo-dashboard',
    'Content-Type': 'application/json',
  };

  try {
    const body = JSON.parse(event.body || '{}');
    const config = body.config;
    if (!Array.isArray(config)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'config debe ser un array' }) };
    }

    const lines = [HEADERS.join(',')];
    for (const r of config) {
      lines.push([r.clave, r.valor, r.unidad, r.descripcion, r.actualizado]
        .map(escapeCSV).join(','));
    }
    const csvContent = lines.join('\n') + '\n';
    const encoded = Buffer.from(csvContent, 'utf-8').toString('base64');

    let sha = null;
    const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers });
    if (getRes.status === 200) {
      const data = await getRes.json();
      sha = data.sha;
    } else if (getRes.status !== 404) {
      const errTxt = await getRes.text();
      return { statusCode: 500, body: JSON.stringify({ error: `GET ${getRes.status}: ${errTxt}` }) };
    }

    const putRes = await fetch(apiBase, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `Actualizar config (${config.length} variables)`,
        content: encoded,
        branch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putRes.ok) {
      const errTxt = await putRes.text();
      console.error('PUT error:', putRes.status, errTxt);
      return { statusCode: 500, body: JSON.stringify({ error: `PUT ${putRes.status}: ${errTxt}` }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, variables: config.length }) };
  } catch (err) {
    console.error('guardar-config crash:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || String(err), stack: err.stack }),
    };
  }
};
