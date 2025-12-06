/**
 * DB/CMS LAYER: Google Apps Script (GAS) for Telegram Bot persistence.
 * This acts as the Serverless-compatible, zero-cost API middleware.
 *
 * NOTE: All data access here must be authorized by a hardcoded API_KEY.
 * The structure and logic mirror the PostgreSQL Schema from the specification.
 */

// --- CONFIGURATION ---
const API_KEY = 'YOUR_GAS_API_KEY_SECRET'; // Must match the value in wrangler.toml/secrets
const SS = SpreadsheetApp.getActiveSpreadsheet();
const SHEETS = {
  JOBS: SS.getSheetByName('JOBS'),
  SESSIONS: SS.getSheetByName('SESSIONS'),
};
const JOB_HEADERS = ['ID', 'chat_id', 'client_name', 'vehicle_info', 'status', 'notes', 'progress', 'is_lead', 'created_at'];
const SESSION_HEADERS = ['user_id', 'current_step', 'temp_data'];
// --- UTILITIES ---

/**
 * Validates the incoming request based on the API Key.
 */
function validateRequest(key) {
  if (key !== API_KEY) {
    throw new Error('Unauthorized access.');
  }
}

/**
 * Converts sheet data rows into an array of objects based on headers.
 */
function dataToObjects(data, headers) {
  if (!data || data.length < 2) return [];
  const objects = [];
  const actualHeaders = data[0];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    actualHeaders.forEach((header, index) => {
      if (headers.includes(header)) {
        obj[header] = row[index];
      }
    });
    // Add the Sheet row index for update operations (crucial for Sheets)
    obj.rowIndex = i + 1;
    objects.push(obj);
  }
  return objects;
}

// --- SESSION CRUD (Bot State Machine) ---

/**
 * Reads a user's current session state.
 */
function readSession(userId) {
  const sheet = SHEETS.SESSIONS;
  const data = sheet.getDataRange().getValues();
  const sessions = dataToObjects(data, SESSION_HEADERS);
  const session = sessions.find(s => String(s.user_id) === String(userId));
  
  if (session) {
    // Parse temp_data JSON string back into an object
    session.temp_data = session.temp_data ? JSON.parse(session.temp_data) : {};
  } else {
    // Return a default session object if none found
    return { user_id: userId, current_step: 'IDLE', temp_data: {} };
  }
  
  return session;
}

/**
 * Writes or updates a user's session state.
 */
function writeSession(userId, currentStep, tempData, isClear) {
  const sheet = SHEETS.SESSIONS;
  const data = sheet.getDataRange().getValues();
  
  const userIdStr = String(userId);
  let targetRowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === userIdStr) {
      targetRowIndex = i;
      break;
    }
  }
  
  const tempJson = isClear ? '' : JSON.stringify(tempData);
  const newRow = [userIdStr, currentStep, tempJson];

  if (targetRowIndex !== -1) {
    // Update existing row (remember: data indices start from 0, sheet rows start from 1)
    sheet.getRange(targetRowIndex + 1, 1, 1, newRow.length).setValues([newRow]);
    return { status: 'UPDATED', userId };
  } else {
    // Append new row
    sheet.appendRow(newRow);
    return { status: 'CREATED', userId };
  }
}

// --- JOBS CRUD (Business Data) ---

/**
 * Saves a new job (appointment or lead).
 */
function saveJob(jobData) {
  const sheet = SHEETS.JOBS;
  
  // Find the next ID (simple incremental based on last row index, safe for single workshop MVP)
  const lastRow = sheet.getLastRow();
  const newId = lastRow === 0 ? 1 : sheet.getRange(lastRow, 1).getValue() + 1;
  
  const rowData = [
    newId,
    jobData.chat_id,
    jobData.client_name,
    jobData.vehicle_info,
    jobData.status || 'SCHEDULED',
    jobData.notes || '',
    jobData.progress || 0,
    jobData.is_lead || false,
    new Date()
  ];
  
  sheet.appendRow(rowData);
  return { status: 'CREATED', jobId: newId, chat_id: jobData.chat_id };
}

/**
 * Retrieves active jobs for status checks.
 */
function queryJobs(chatId) {
  const sheet = SHEETS.JOBS;
  const data = sheet.getDataRange().getValues();
  const jobs = dataToObjects(data, JOB_HEADERS);
  
  // Filter for active jobs associated with the given chatId
  const activeJobs = jobs.filter(job => 
    String(job.chat_id) === String(chatId) && 
    job.status !== 'DELIVERED' && 
    job.status !== 'CANCELLED'
  );
  
  return activeJobs;
}

/**
 * Updates a job's status/progress/notes via rowIndex found in query.
 * IMPORTANT: This assumes the input includes the rowIndex, retrieved during read operations.
 */
function updateJobStatus(updateData) {
  const sheet = SHEETS.JOBS;
  const rowIndex = updateData.rowIndex; // Essential for updating Sheets data
  
  if (!rowIndex) throw new Error("Missing rowIndex for update.");

  const rowValues = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  const job = {};
  headers.forEach((header, index) => {
    job[header] = rowValues[index];
  });
  
  // Apply updates
  job.status = updateData.status || job.status;
  job.notes = updateData.notes !== undefined ? updateData.notes : job.notes;
  job.progress = updateData.progress !== undefined ? updateData.progress : job.progress;

  // Rebuild the updated row data based on headers to ensure correct column placement
  const newRow = headers.map(header => job[header] !== undefined ? job[header] : '');
  
  sheet.getRange(rowIndex, 1, 1, newRow.length).setValues([newRow]);
  return job; // Return updated job object (includes chat_id, status)
}

// --- POST/GET HANDLER (API Gateway) ---

function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents);
    validateRequest(request.apiKey);
    
    const action = request.action;
    let result;

    switch (action) {
      case 'READ_SESSION':
        result = readSession(request.userId);
        break;
      case 'WRITE_SESSION':
        result = writeSession(request.userId, request.currentStep, request.tempData, request.isClear);
        break;
      case 'SAVE_JOB':
        result = saveJob(request.jobData);
        break;
      case 'QUERY_JOBS':
        result = queryJobs(request.chatId);
        break;
      case 'UPDATE_JOB':
        result = updateJobStatus(request.updateData);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, result }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log(error);
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
