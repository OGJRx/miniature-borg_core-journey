const API_KEY = '9e7aebf067033c682583b3d4afcf341fee4c20fa';
const SHEET_JOBS = 'JOBS';
const SHEET_SESSIONS = 'SESSIONS';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'Invalid payload' });
    }
    const data = JSON.parse(e.postData.contents);
    if (data.apiKey !== API_KEY) {
      return jsonResponse({ ok: false, error: 'Unauthorized' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const result = routeAction(ss, data);
    return jsonResponse({ ok: true, result: result });

  } catch (error) {
    return jsonResponse({ ok: false, error: error.toString() });
  } finally {
    lock.releaseLock();
  }
}

function routeAction(ss, data) {
  switch (data.action) {
    case 'READ_SESSION': return getSession(ss, data.userId);
    case 'WRITE_SESSION': return updateSession(ss, data.userId, data.currentStep, data.tempData, data.isClear);
    case 'SAVE_JOB': return saveJob(ss, data.jobData);
    case 'QUERY_JOBS': return queryJobs(ss, data.chatId);
    default: throw new Error('Unknown action');
  }
}

function getSession(ss, userId) {
  const sheet = ss.getSheetByName(SHEET_SESSIONS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(userId)) {
      return {
        user_id: data[i][0],
        current_step: data[i][1],
        temp_data: data[i][2] ? JSON.parse(data[i][2]) : {}
      };
    }
  }
  return { current_step: 'IDLE', temp_data: {} };
}

function updateSession(ss, userId, step, tempData, isClear) {
  const sheet = ss.getSheetByName(SHEET_SESSIONS);
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(userId)) {
      rowIndex = i + 1;
      break;
    }
  }
  const jsonTemp = JSON.stringify(tempData || {});
  if (isClear) {
    if (rowIndex > 0) sheet.getRange(rowIndex, 2, 1, 2).setValues([['IDLE', '{}']]);
  } else {
    if (rowIndex > 0) sheet.getRange(rowIndex, 2, 1, 2).setValues([[step, jsonTemp]]);
    else sheet.appendRow([userId, step, jsonTemp]);
  }
  return { success: true };
}

function saveJob(ss, jobData) {
  const sheet = ss.getSheetByName(SHEET_JOBS);
  const newId = Math.floor(Math.random() * 1000000).toString(36).toUpperCase();
  const row = [
    newId,
    "'" + jobData.chat_id,
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
  const data = sheet.getDataRange().getValues();
  const results = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(chatId)) {
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
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}