/**
 * BitterSweet CRM receiver (Google Apps Script web app).
 * Bound to a Google Sheet: the Worker POSTs one JSON row here, this script appends it to the "CRM" sheet.
 * A delete_request instead deletes every row of that LINE user from the CRM sheet.
 *
 * Setup: see SETUP.md. Deploy as Web app -> Execute as: Me -> Who has access: Anyone.
 * The shared secret is NOT in this file: set the script property SHARED_TOKEN (Project Settings -> Script properties).
 */

// Optional: an email address that gets a one-line alert when a customer needs the perfumer (handoff).
// Leave empty to turn alerts off.
var NOTIFY_EMAIL = '';

var SHEET_NAME = 'CRM';
var MIN_TOKEN_LENGTH = 32;
var SEGMENTS = ['', 'booth_smeller', 'set_trier', 'cilantro_lover', 'green_curious', 'gift_seeker', 'repeat_wearer'];
var BOOLEAN_FIELDS = ['discovery_set_interest', 'preorder_waitlist', 'consent_pdpa', 'handoff', 'delete_request'];
var STRING_FIELDS = ['scents_smelled', 'liked', 'disliked', 'preferences', 'last_message'];
var MAX_FIELD_LENGTH = 500;
var COLUMNS = [
  'timestamp', 'line_user_id', 'segment', 'scents_smelled', 'liked', 'disliked', 'preferences',
  'discovery_set_interest', 'preorder_waitlist', 'consent_pdpa', 'handoff', 'delete_request', 'last_message'
];

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, error: 'bad json' });
  }

  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_TOKEN');
  if (!tokenUsable_(expected)) {
    console.error('SHARED_TOKEN script property is missing, a placeholder, or shorter than ' + MIN_TOKEN_LENGTH + ' characters.');
    return reply_({ ok: false, error: 'not configured' });
  }
  if (!data || typeof data.token !== 'string' || data.token !== expected) {
    return reply_({ ok: false, error: 'unauthorized' });
  }

  var problem = invalidRow_(data);
  if (problem) return reply_({ ok: false, error: 'invalid row: ' + problem });

  // The lock covers only the sheet change itself (a few hundred milliseconds), not the email below,
  // so concurrent requests queue briefly (at most 8 s, less than the Worker's timeout for this call) instead of failing. Appends without a lock could race with the
  // sheet creation / header row and with deletes, which shift row numbers.
  var lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    if (data.delete_request === true) {
      deleteRowsOf_(data.line_user_id);
    } else {
      appendRow_(data);
    }
  } finally {
    lock.releaseLock();
  }

  if (data.handoff === true && NOTIFY_EMAIL && !alertedToday_(data.line_user_id)) {
    MailApp.sendEmail(
      NOTIFY_EMAIL,
      'BitterSweet: customer needs the perfumer',
      'Handoff requested by LINE user ' + data.line_user_id + ' at ' + data.timestamp + '. See the CRM sheet.'
    );
  }
  return reply_({ ok: true });
}

// Returns the name of the first invalid field, or '' when the row is fine. Everything here comes from the Worker,
// but the endpoint is public, so a leaked token must not be able to write arbitrary junk into the sheet.
function invalidRow_(d) {
  if (typeof d.line_user_id !== 'string' || !/^U[0-9a-f]{32}$/.test(d.line_user_id)) return 'line_user_id';
  if (typeof d.timestamp !== 'string' || d.timestamp.length > 40) return 'timestamp';
  if (typeof d.segment !== 'string' || SEGMENTS.indexOf(d.segment) === -1) return 'segment';
  for (var i = 0; i < BOOLEAN_FIELDS.length; i++) {
    if (typeof d[BOOLEAN_FIELDS[i]] !== 'boolean') return BOOLEAN_FIELDS[i];
  }
  for (var j = 0; j < STRING_FIELDS.length; j++) {
    var v = d[STRING_FIELDS[j]];
    if (typeof v !== 'string' || v.length > MAX_FIELD_LENGTH) return STRING_FIELDS[j];
  }
  return '';
}

function tokenUsable_(t) {
  if (typeof t !== 'string' || t.length < MIN_TOKEN_LENGTH) return false;
  return !/replace|change.?me|placeholder|example/i.test(t);
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(COLUMNS);
  return sheet;
}

function appendRow_(data) {
  getSheet_().appendRow(COLUMNS.map(function (c) { return cell_(data[c]); }));
}

// Deletes every data row (not the header) whose line_user_id matches. Goes from the bottom up so row numbers stay valid.
function deleteRowsOf_(userId) {
  if (typeof userId !== 'string' || userId === '') return;
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return;
  var ids = sheet.getRange(2, COLUMNS.indexOf('line_user_id') + 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === userId) sheet.deleteRow(i + 2);
  }
}

// At most one handoff email per user per UTC day. CacheService entries live at most 6 hours (21600 s),
// so in the worst case the same user can trigger up to four emails a day.
function alertedToday_(userId) {
  var cache = CacheService.getScriptCache();
  var key = 'handoff:' + new Date().toISOString().slice(0, 10) + ':' + userId;
  if (cache.get(key)) return true;
  cache.put(key, '1', 21600);
  return false;
}

// Values starting with = + - @ (or a tab / carriage return) would be run as formulas by Sheets; prefix them so they stay plain text.
function cell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  var s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
