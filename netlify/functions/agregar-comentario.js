// Sin dependencias externas: usa fetch nativo (Netlify Node 18+)
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

  const token  = process.env.GITHUB_TOKEN;
  const owner  = process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!token || !owner || !repo) {
    
      // === DIAGNÓSTICO TEMPORAL ===
  console.log('DIAGNOSTICO_TOKEN_PREFIX:', token ? token.slice(0, 12) : 'N/A');
  console.log('DIAGNOSTICO_TOKEN_LENGTH:', token ? token.length : 0);
  console.log('DIAGNOSTICO_OWNER:', JSON.stringify(owner));
  console.log('DIAGNOSTICO_REPO:', JSON.stringify(repo));
  console.log('DIAGNOSTICO_BRANCH:', JSON.stringify(branch));
  console.log('DIAGNOSTICO_API_URL:', `https://api.github.com/repos/${owner}/${repo}/contents/${CSV_PATH}`);
  // === FIN DIAGNÓSTICO ===
    
    
    
    
    
    
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
    const comentario = body.comentario;
    if (!comentario || !comentario.titulo) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta el comentario o el título' }) };
    }

    let sha = null;
    let existingRows = [];
    let csvHeaders = DEFAULT_HEADERS;

    const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers });
    if (getRes.status === 200) {
      const data = await getRes.json();
      sha = data.sha;
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      const parsed = parseCSV(content);
      if (parsed.headers.length > 0) csvHeaders = parsed.headers;
      existingRows = parsed.rows;
      console.log(`📄 CSV existente: ${existingRows.length} filas`);
    } else if (getRes.status === 404) {
      console.log('📄 comentarios.csv no existe → se creará');
    } else {
      const errTxt = await getRes.text();
      console.error('GET error:', getRes.status, errTxt);
      return { statusCode: 500, body: JSON.stringify({ error: `GET ${getRes.status}: ${errTxt}` }) };
    }

    const maxId = existingRows.reduce((m, r) => {
      const n = parseInt(r[0], 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    const newId = maxId + 1;

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
    const newRow = csvHeaders.map(h => rowMap[h] != null ? rowMap[h] : '');

    const lines = [];
    lines.push(csvHeaders.map(escapeCSV).join(','));
    for (const r of existingRows) lines.push(r.map(escapeCSV).join(','));
    lines.push(newRow.map(escapeCSV).join(','));
    const csvContent = lines.join('\n') + '\n';
    const encoded = Buffer.from(csvContent, 'utf-8').toString('base64');

    const putRes = await fetch(apiBase, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `Agregar comentario #${newId}: ${comentario.titulo}`,
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

    return { statusCode: 200, body: JSON.stringify({ id: newId, ok: true }) };
  } catch (err) {
    console.error('agregar-comentario crash:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || String(err), stack: err.stack }),
    };
  }
};
