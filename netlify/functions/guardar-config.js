const { Octokit } = require('@octokit/rest');

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

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const owner  = process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';

  try {
    const { config } = JSON.parse(event.body || '{}');
    if (!Array.isArray(config)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'config debe ser un array' }) };
    }

    const lines = [HEADERS.join(',')];
    for (const r of config) {
      lines.push([
        r.clave, r.valor, r.unidad, r.descripcion, r.actualizado,
      ].map(escapeCSV).join(','));
    }
    const csvContent = lines.join('\n') + '\n';
    const encoded = Buffer.from(csvContent, 'utf-8').toString('base64');

    // Detectar si el archivo existe (para obtener sha)
    let sha = null;
    try {
      const res = await octokit.repos.getContent({ owner, repo, path: CSV_PATH, ref: branch });
      sha = res.data.sha;
    } catch (err) {
      if (err.status !== 404) throw err;
      console.log('📄 config.csv no existe → se creará');
    }

    await octokit.repos.createOrUpdateFileContents({
      owner, repo, path: CSV_PATH, branch,
      message: `Actualizar config (${config.length} variables)`,
      content: encoded,
      ...(sha ? { sha } : {}),
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, variables: config.length }) };
  } catch (err) {
    console.error('guardar-config error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
