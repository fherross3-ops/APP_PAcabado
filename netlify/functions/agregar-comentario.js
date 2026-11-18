const { Octokit } = require('@octokit/rest');

const CSV_PATH = 'data/comentarios.csv';
const DEFAULT_HEADERS = [
  'id','fecha','proceso','categoria','titulo','descripcion',
  'lote','responsable','estado','prioridad','creado_por','creado_en',
  'elemento','fecha_intervencion','actividad_basica'
];

function escapeCSV(v) {
  const s = String(v == null ? '' : v);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const result = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        result.push(cur); cur = '';
      } else cur += c;
    }
    result.push(cur);
    return result;
  });
  return { headers, rows };
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
    const { comentario } = JSON.parse(event.body || '{}');
    if (!comentario || !comentario.titulo) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta el comentario o el título' }) };
    }

    // 1) Leer archivo (si existe)
    let sha = null;
    let existingRows = [];
    let headers = DEFAULT_HEADERS;

    try {
      const res = await octokit.repos.getContent({ owner, repo, path: CSV_PATH, ref: branch });
      sha = res.data.sha;
      const content = Buffer.from(res.data.content, 'base64').toString('utf-8');
      const parsed = parseCSV(content);
      if (parsed.headers.length > 0) headers = parsed.headers;
      existingRows = parsed.rows;
    } catch (err) {
      if (err.status === 404) {
        console.log('📄 comentarios.csv no existe → se creará');
      } else {
        throw err;
      }
    }

    // 2) Nuevo ID
    const maxId = existingRows.reduce((m, r) => {
      const n = parseInt(r[0], 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    const newId = maxId + 1;

    // 3) Construir fila en el orden de los headers existentes
    const now = new Date();
    const rowMap = {
      id: String(newId),
      fecha: comentario.fecha || now.toISOString().slice(0, 10),
      proceso: comentario.proceso || '',
      categoria: comentario.categoria || '',
      titulo: comentario.titulo || '',
      descripcion: comentario.descripcion || '',
      lote: comentario.lote || '',
      responsable: comentario.responsable || '',
      estado: comentario.estado || 'abierto',
      prioridad: comentario.prioridad || 'media',
      creado_por: comentario.creado_por || '',
      creado_en: now.toISOString().replace('T', ' ').slice(0, 16),
      elemento: comentario.elemento || '',
      fecha_intervencion: comentario.fecha_intervencion || '',
      actividad_basica: comentario.actividad_basica || '',
    };
    const newRow = headers.map(h => rowMap[h] != null ? rowMap[h] : '');

    // 4) Serializar
    const lines = [];
    lines.push(headers.map(escapeCSV).join(','));
    for (const r of existingRows) lines.push(r.map(escapeCSV).join(','));
    lines.push(newRow.map(escapeCSV).join(','));
    const csvContent = lines.join('\n') + '\n';

    // 5) PUT (create si sha es null, update si existe)
    const encoded = Buffer.from(csvContent, 'utf-8').toString('base64');
    await octokit.repos.createOrUpdateFileContents({
      owner, repo, path: CSV_PATH, branch,
      message: `Agregar comentario #${newId}: ${comentario.titulo}`,
      content: encoded,
      ...(sha ? { sha } : {}),
    });

    return { statusCode: 200, body: JSON.stringify({ id: newId, ok: true }) };
  } catch (err) {
    console.error('agregar-comentario error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
