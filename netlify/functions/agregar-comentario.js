// Sin dependencias externas: usa fetch nativo (Netlify Node 18+)
const CSV_PATH = 'data/comentarios.csv';

// Orden canónico de columnas. Al añadir aquí, el CSV se reescribe
// con las columnas nuevas (las viejas filas quedan con vacío en las nuevas).
const CANONICAL_HEADERS = [
  'id','fecha','proceso','categoria','titulo','descripcion',
  'lote','responsable','estado','prioridad','creado_por','creado_en',
  'elemento','fecha_intervencion','actividad_basica',
  'tiempo_inicio','tiempo_final','editado_en'
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

    // 1) Leer archivo (si existe)
    let sha = null;
    let existingRows = [];
    let existingHeaders = [];

    const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers });
    if (getRes.status === 200) {
      const data = await getRes.json();
      sha = data.sha;
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      const parsed = parseCSV(content);
      existingHeaders = parsed.headers;
      existingRows = parsed.rows;
      console.log(`📄 CSV existente: ${existingRows.length} filas / ${existingHeaders.length} columnas`);
    } else if (getRes.status === 404) {
      console.log('📄 comentarios.csv no existe → se creará');
    } else {
      const errTxt = await getRes.text();
      console.error('GET error:', getRes.status, errTxt);
      return { statusCode: 500, body: JSON.stringify({ error: `GET ${getRes.status}: ${errTxt}` }) };
    }

    // 2) Remapear filas existentes al orden canónico (agrega columnas nuevas vacías)
    const remappedExisting = existingRows.map(oldRow => {
      const obj = {};
      existingHeaders.forEach((h, i) => { obj[h] = oldRow[i]; });
      return CANONICAL_HEADERS.map(h => obj[h] != null ? obj[h] : '');
    });

    // 3) CREATE o UPDATE
    const isUpdate = comentario.id != null && String(comentario.id).trim() !== '';
    const now = new Date();
    const nowStr = now.toISOString().replace('T', ' ').slice(0, 16);
    let newId, finalRows, commitMessage, logMessage;

    if (isUpdate) {
      // UPDATE: buscar por ID y reemplazar
      const editId = String(comentario.id).trim();
      const targetIdx = remappedExisting.findIndex(r => String(r[0]).trim() === editId);
      if (targetIdx === -1) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: `Comentario #${editId} no encontrado en el CSV` }),
        };
      }
      const oldRow = remappedExisting[targetIdx];
      const oldObj = {};
      CANONICAL_HEADERS.forEach((h, i) => { oldObj[h] = oldRow[i]; });

      // Preservar creado_por y creado_en del original
      const updatedObj = {
        id:                 editId,
        fecha:              comentario.fecha || oldObj.fecha,
        proceso:            comentario.proceso || oldObj.proceso,
        categoria:          comentario.categoria || oldObj.categoria,
        titulo:             comentario.titulo || oldObj.titulo,
        descripcion:        comentario.descripcion != null ? comentario.descripcion : oldObj.descripcion,
        lote:               comentario.lote != null ? comentario.lote : oldObj.lote,
        responsable:        comentario.responsable != null ? comentario.responsable : oldObj.responsable,
        estado:             comentario.estado || oldObj.estado,
        prioridad:          comentario.prioridad || oldObj.prioridad,
        creado_por:         oldObj.creado_por || '',
        creado_en:          oldObj.creado_en || '',
        elemento:           comentario.elemento != null ? comentario.elemento : oldObj.elemento,
        fecha_intervencion: comentario.fecha_intervencion != null ? comentario.fecha_intervencion : oldObj.fecha_intervencion,
        actividad_basica:   comentario.actividad_basica != null ? comentario.actividad_basica : oldObj.actividad_basica,
        tiempo_inicio:      comentario.tiempo_inicio != null ? comentario.tiempo_inicio : oldObj.tiempo_inicio,
        tiempo_final:       comentario.tiempo_final != null ? comentario.tiempo_final : oldObj.tiempo_final,
        editado_en:         nowStr,
      };
      remappedExisting[targetIdx] = CANONICAL_HEADERS.map(h => updatedObj[h] != null ? updatedObj[h] : '');
      newId = editId;
      finalRows = remappedExisting;
      commitMessage = `Editar comentario #${newId}: ${comentario.titulo}`;
      logMessage = `✏️ Comentario #${newId} actualizado`;
    } else {
      // CREATE: nuevo ID y append
      const maxId = remappedExisting.reduce((m, r) => {
        const n = parseInt(r[0], 10);
        return isNaN(n) ? m : Math.max(m, n);
      }, 0);
      newId = maxId + 1;

      const newRowObj = {
        id:                 String(newId),
        fecha:              comentario.fecha || now.toISOString().slice(0, 10),
        proceso:            comentario.proceso || '',
        categoria:          comentario.categoria || '',
        titulo:             comentario.titulo || '',
        descripcion:        comentario.descripcion || '',
        lote:               comentario.lote || '',
        responsable:        comentario.responsable || '',
        estado:             comentario.estado || 'abierto',
        prioridad:          comentario.prioridad || 'media',
        creado_por:         comentario.creado_por || '',
        creado_en:          nowStr,
        elemento:           comentario.elemento || '',
        fecha_intervencion: comentario.fecha_intervencion || '',
        actividad_basica:   comentario.actividad_basica || '',
        tiempo_inicio:      comentario.tiempo_inicio || '',
        tiempo_final:       comentario.tiempo_final || '',
        editado_en:         '',
      };
      const newRow = CANONICAL_HEADERS.map(h => newRowObj[h] != null ? newRowObj[h] : '');
      finalRows = [...remappedExisting, newRow];
      commitMessage = `Agregar comentario #${newId}: ${comentario.titulo}`;
      logMessage = `➕ Comentario #${newId} creado`;
    }

    // 4) Serializar CSV completo
    const lines = [];
    lines.push(CANONICAL_HEADERS.map(escapeCSV).join(','));
    for (const r of finalRows) lines.push(r.map(escapeCSV).join(','));
    const csvContent = lines.join('\n') + '\n';
    const encoded = Buffer.from(csvContent, 'utf-8').toString('base64');

    // 5) PUT
    const putRes = await fetch(apiBase, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: commitMessage,
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

    console.log(logMessage);
    return {
      statusCode: 200,
      body: JSON.stringify({ id: newId, ok: true, mode: isUpdate ? 'update' : 'create' }),
    };
  } catch (err) {
    console.error('agregar-comentario crash:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || String(err), stack: err.stack }),
    };
  }
};
