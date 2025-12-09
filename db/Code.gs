const API_KEY = '9e7aebf067033c682583b3d4afcf341fee4c20fa'; // Misma clave para mantener compatibilidad
const SHEET_JOBS = 'JOBS';
const SHEET_SESSIONS = 'SESSIONS';

function doPost(e) {
  // Implementamos bloqueo para evitar condiciones de carrera si el usuario escribe muy rápido
  const lock = LockService.getScriptLock();
  lock.tryLock(10000); // Esperar hasta 10 segundos por el lock

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'Invalid payload' });
    }
    const data = JSON.parse(e.postData.contents);

    // Verificación de seguridad simple
    if (data.apiKey !== API_KEY) {
      return jsonResponse({ ok: false, error: 'Unauthorized' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const result = routeAction(ss, data);

    SpreadsheetApp.flush(); // Forzar escritura inmediata
    return jsonResponse({ ok: true, result: result });

  } catch (error) {
    return jsonResponse({ ok: false, error: error.toString() });
  } finally {
    lock.releaseLock();
  }
}

function cleanId(id) {
  // Limpia comillas simples que Excel/Sheets a veces agrega
  return String(id).replace(/^'/, '').trim();
}

function routeAction(ss, data) {
  switch (data.action) {
    case 'READ_SESSION': return getSession(ss, data.userId);
    case 'WRITE_SESSION': return updateSession(ss, data.userId, data.currentStep, data.tempData, data.isClear);
    case 'SAVE_JOB': return saveJob(ss, data.jobData);
    case 'QUERY_JOBS': return queryJobs(ss, data.chatId);
    default: throw new Error('Unknown action: ' + data.action);
  }
}

function getSession(ss, userId) {
  const sheet = ss.getSheetByName(SHEET_SESSIONS);
  if (!sheet) throw new Error("Sheet SESSIONS not found");

  const data = sheet.getDataRange().getValues();
  const targetId = cleanId(userId);
  
  // Búsqueda inversa (del final al principio) para obtener el estado más reciente rápidamente
  for (let i = data.length - 1; i >= 1; i--) {
    const rowId = cleanId(data[i][0]);
    if (rowId === targetId) {
      return {
        user_id: rowId,
        current_step: data[i][1],
        temp_data: data[i][2] ? JSON.parse(data[i][2]) : {}
      };
    }
  }
  // Si no existe, retornamos estado base
  return { current_step: 'IDLE', temp_data: {} };
}

function updateSession(ss, userId, step, tempData, isClear) {
  const sheet = ss.getSheetByName(SHEET_SESSIONS);
  if (!sheet) throw new Error("Sheet SESSIONS not found");

  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  const targetId = cleanId(userId);

  // Buscar si el usuario ya existe
  for (let i = data.length - 1; i >= 1; i--) {
    if (cleanId(data[i][0]) === targetId) {
      rowIndex = i + 1; // Índice basado en 1 para Apps Script
      break;
    }
  }

  // --- LOGIC FIX START ---
  // Si isClear es true, limpiamos la data temporal, PERO respetamos el 'step' que entra.
  const jsonTemp = isClear ? '{}' : JSON.stringify(tempData || {});

  // Si 'step' viene definido (ej: AWAIT_NAME), lo usamos. Si no, fallback a IDLE.
  // Esto arregla el bug donde /start forzaba IDLE.
  const nextStep = step || 'IDLE';
  // --- LOGIC FIX END ---

  const safeUserId = "'" + targetId; // Forzar formato texto

  if (rowIndex > 0) {
    // Actualizar fila existente
    sheet.getRange(rowIndex, 2, 1, 2).setValues([[nextStep, jsonTemp]]);
  } else {
    // Crear nueva sesión al final
    sheet.appendRow([safeUserId, nextStep, jsonTemp]);
  }

  return { success: true, status: rowIndex > 0 ? 'updated' : 'created', step: nextStep };
}

function saveJob(ss, jobData) {
  const sheet = ss.getSheetByName(SHEET_JOBS);
  if (!sheet) throw new Error("Sheet JOBS not found");

  const newId = Math.floor(Math.random() * 1000000).toString(36).toUpperCase();
  const row = [
    newId,
    "'" + jobData.chat_id, // Forzar texto para IDs grandes
    jobData.client_name,
    jobData.vehicle_info,
    jobData.status,
    jobData.notes || '',
    jobData.progress || 0,
    jobData.is_lead ? true : false,
    new Date().toISOString()
  ];
  sheet.appendRow(row);
  return { jobId: newId, status: 'saved' };
}

function queryJobs(ss, chatId) {
  const sheet = ss.getSheetByName(SHEET_JOBS);
  if (!sheet) throw new Error("Sheet JOBS not found");

  const data = sheet.getDataRange().getValues();
  const results = [];
  const targetId = cleanId(chatId);
  
  // Saltamos encabezados (i=1)
  for (let i = 1; i < data.length; i++) {
    if (cleanId(data[i][1]) === targetId) {
      results.push({
        ID: data[i][0],
        chat_id: data[i][1],
        client_name: data[i][2],
        vehicle_info: data[i][3],
        status: data[i][4],
        notes: data[i][5],
        progress: data[i][6],
        is_lead: data[i][7],
        created_at: data[i][8]
      });
    }
  }
  return results;
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}