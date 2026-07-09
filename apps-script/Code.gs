/**
 * CATA beta-feedback backend — Google Apps Script bound to the unified feedback sheet.
 *
 * Two jobs:
 *   1. doGet(?merchant=<slug>)  — serves that merchant's rows as JSON to the portal sites,
 *      exposing only the public columns. The sheet itself stays private (no link sharing).
 *   2. syncJiraTickets()        — creates a Jira ticket for each row where the "Create Jira"
 *      checkbox is ticked and "Jira key" is empty, then writes the key back. Run on a
 *      time-driven trigger (installTrigger() sets up every 10 min).
 *
 * Setup (once, in the Apps Script editor attached to the sheet):
 *   - Deploy > New deployment > Web app: Execute as = Me, Who has access = Anyone.
 *     The /exec URL is the `data_url` for portal.config.json.
 *   - Project Settings > Script Properties (needed for Jira only):
 *       JIRA_SITE        catasg.atlassian.net
 *       JIRA_EMAIL       <your Atlassian account email>
 *       JIRA_API_TOKEN   <token from id.atlassian.com/manage-profile/security/api-tokens>
 *       JIRA_PROJECT     TECHSUPP            (optional, this is the default)
 *       JIRA_ISSUE_TYPE  Task                (optional, this is the default)
 *       JIRA_AUTO_CREATE false               (optional; 'true' = ticket for every row, no checkbox)
 *   - Run installTrigger() once (grants permissions on first run).
 *
 * Sheet expectations: first row = headers (case-insensitive). Tally's Google Sheets
 * integration provides "Submission ID", "Your Email", "Description", "Category",
 * "Merchant Priority", "Steps to reproduce", "Submitted at" and the hidden field
 * "Merchant". Added manually: "Status", "CATA response", "Create JIRA" (checkbox
 * column) and "JIRA ticket ID".
 */

var SHEET_NAME = 'Feedback'; // tab that receives Tally submissions; falls back to first tab
var PUBLIC_COLUMNS = [
  'submission id', 'your email', 'description', 'category',
  'merchant priority', 'status', 'cata response', 'submitted at', 'merchant'
];

// ---------------------------------------------------------------- web app ---

function doGet(e) {
  var merchant = String((e && e.parameter && e.parameter.merchant) || '').trim().toLowerCase();
  var rows = [];
  if (merchant) { // no merchant param -> empty; never dump the whole sheet
    rows = readRows_()
      .filter(function (r) { return String(r['merchant'] || '').trim().toLowerCase() === merchant; })
      .map(function (r) {
        var out = {};
        PUBLIC_COLUMNS.forEach(function (c) { out[c] = r[c] || ''; });
        return out;
      });
  }
  return ContentService
    .createTextOutput(JSON.stringify({ rows: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}

function readRows_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  var values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  return values.slice(1).map(function (row) {
    var o = {};
    headers.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });
}

// --------------------------------------------------------------- Jira sync ---

function syncJiraTickets() {
  var props = PropertiesService.getScriptProperties();
  var site = props.getProperty('JIRA_SITE');
  var email = props.getProperty('JIRA_EMAIL');
  var token = props.getProperty('JIRA_API_TOKEN');
  var project = props.getProperty('JIRA_PROJECT') || 'TECHSUPP';
  var issueType = props.getProperty('JIRA_ISSUE_TYPE') || 'Task';
  var autoCreate = props.getProperty('JIRA_AUTO_CREATE') === 'true';
  if (!site || !email || !token) {
    throw new Error('Set JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN in Script Properties.');
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return;
    var headers = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var col = function (name) { return headers.indexOf(name); };
    var cCreate = col('create jira'), cKey = col('jira ticket id');
    if (cCreate < 0 || cKey < 0) {
      throw new Error('Add "Create JIRA" (checkbox) and "JIRA ticket ID" columns to the sheet.');
    }

    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      if (String(row[cKey]).trim()) continue;                 // already has a ticket
      if (!autoCreate && !isChecked_(row[cCreate])) continue; // checkbox not ticked
      var desc = String(row[col('description')] || '').trim();
      if (!desc) continue;
      var merchant = String(row[col('merchant')] || '').trim().toLowerCase();

      var summary = '[' + (merchant || 'beta') + '] ' + desc.split('\n')[0].slice(0, 120);
      var key = createJiraIssue_(site, email, token, {
        project: project,
        issueType: issueType,
        summary: summary,
        labels: ['beta-feedback'].concat(merchant ? [merchant] : []),
        details: {
          'Merchant': merchant || '—',
          'Submission ID': String(row[col('submission id')] || ''),
          'Submitted by': String(row[col('your email')] || ''),
          'Category': String(row[col('category')] || ''),
          'Merchant priority': String(row[col('merchant priority')] || ''),
          'Steps to reproduce': String(row[col('steps to reproduce')] || ''),
          'Submitted at': String(row[col('submitted at')] || ''),
          'Portal': merchant ? 'https://cata-feedback.vercel.app/' + merchant : ''
        },
        description: desc
      });
      sheet.getRange(i + 1, cKey + 1).setValue(key);
      SpreadsheetApp.flush();
    }
  } finally {
    lock.releaseLock();
  }
}

function createJiraIssue_(site, email, token, issue) {
  var paragraphs = [adfParagraph_(issue.description)];
  Object.keys(issue.details).forEach(function (label) {
    if (issue.details[label]) paragraphs.push(adfParagraph_(label + ': ' + issue.details[label]));
  });
  var payload = {
    fields: {
      project: { key: issue.project },
      issuetype: { name: issue.issueType },
      summary: issue.summary,
      labels: issue.labels,
      description: { type: 'doc', version: 1, content: paragraphs }
    }
  };
  var resp = UrlFetchApp.fetch('https://' + site + '/rest/api/3/issue', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(email + ':' + token) },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 201) {
    throw new Error('Jira create failed (' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
  return JSON.parse(resp.getContentText()).key;
}

// True for a real checkbox tick and for TRUE/yes typed as text.
function isChecked_(v) {
  return v === true || ['true', 'yes'].indexOf(String(v).trim().toLowerCase()) >= 0;
}

function adfParagraph_(text) {
  return { type: 'paragraph', content: [{ type: 'text', text: text }] };
}

// Run once to schedule the Jira sync.
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncJiraTickets') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncJiraTickets').timeBased().everyMinutes(10).create();
}
