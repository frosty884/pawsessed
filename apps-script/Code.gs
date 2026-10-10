/**
 * Pawsessed Lagoon — party backend.
 *
 * A Google Apps Script web app backed by a Google Sheet. The website reads the live song-request queue,
 * raffle count and DJ settings from it and writes requests / raffle entries to it.
 * Works two ways:
 *   - standalone (script.google.com > New project, easiest on a phone): the first run creates the
 *     spreadsheet "Pawsessed Lagoon · requests & raffle" in your Drive and remembers it;
 *   - bound to a Sheet (Extensions > Apps Script): uses that Sheet and adds a 🌴 Pawsessed menu.
 * Tabs: "Requests", "Raffle", "Settings", plus "Log" (anything that went wrong, newest last).
 * Run setup() once to create them and log the Sheet's link.
 *
 * DJs can manage the queue right in the sheet: tick "Played" (or "Removed") and the request leaves
 * the website's queue within a few seconds.
 *
 * Updating: paste this file over the old code, save, then Deploy > Manage deployments > ✏️ >
 * Version: New version > Deploy. The web app URL stays the same.
 */

var VERSION = '2026-10-10.2';

// The DJ password is stored as a SHA-256 hash so it is not readable in the public repo.
// To change it, add a Script property DJ_PASSWORD (Project Settings > Script properties); that wins over the hash.
var DJ_PASSWORD_SHA256 = 'a5c032f4faf0c5b1a73cfd99b4d481311ada25cee1cf24fe367ef975796a1ced';

var SHEET = { requests: 'Requests', raffle: 'Raffle', settings: 'Settings', log: 'Log' };
var REQ_HEADERS = ['ID', 'Submitted', 'Title', 'Artist', 'Requested by', 'Votes', 'Played', 'Removed', 'Played at', 'Client', 'Voters'];
var RQ = { id: 0, at: 1, title: 2, artist: 3, by: 4, votes: 5, played: 6, removed: 7, playedAt: 8, client: 9, voters: 10 };
var RQ_CHECKBOXES = [RQ.played, RQ.removed];
var RAFFLE_HEADERS = ['Ticket', 'Entered', 'Platform', 'Handle', 'Profile', 'Followed', 'Client', 'Winner', 'Removed', 'Check'];
var RF = { ticket: 0, at: 1, platform: 2, handle: 3, profile: 4, followed: 5, client: 6, winner: 7, removed: 8, check: 9 };
var RF_CHECKBOXES = [RF.winner, RF.removed];
var LOG_HEADERS = ['Time', 'Action', 'Result', 'Message', 'Client', 'Details'];
var SETTINGS_DEFAULTS = [
  ['requestsOpen', true, 'Untick to pause song requests on the website'],
  ['nowSpinning', '', 'Who is on the decks right now (shown on the website)'],
  ['notice', '', 'Short announcement banner on the website (blank = none)'],
  ['raffleOpen', true, 'Untick to close raffle entries'],
  ['raffleWinner', '', 'Filled in by the DJ portal or 🌴 Pawsessed > Draw raffle winner'],
];
var LINEUP = ['Vortex Fox', 'Frosty', 'Ming-Yan', 'Bunitsi'];
var FOLLOWS = ['projectunknownvr', 'greenlinechicago', 'frostyxlr8', 'bunitsi', 'jayk_mingyan'];
var LIMITS = {
  title: 100, artist: 100, by: 40, notice: 160, handle: 40,
  requestsPerClient: 4, requestWindowSec: 600, // 4 requests per device per 10 minutes
  activeQueueMax: 150,
  entriesPerClient: 3,
  badLoginsMax: 25, badLoginWindowSec: 600,
  logRows: 1000,
};
var CACHE_KEY = 'state:v2';
var CACHE_SEC = 10; // standalone scripts get no edit trigger, so sheet edits show within ~10s + one poll
var TIDY_VERSION = '2'; // bump to re-run the one-time tidy of the Requests and Raffle tabs
var WRITE_ACTIONS = { request: 1, vote: 1, raffle: 1 };

// ------------------------------------------------------------------ web app entry points

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'state';
  try {
    try { tidyOnce_(); } catch (err) { log_('tidy', 'error', userMessage_(err), '', err && err.stack); }
    if (action === 'state') return json_(getState_(false));
    if (action === 'ping') return json_({ ok: true, now: Date.now(), version: VERSION });
    if (action === 'health') return json_(health_());
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    log_('get:' + action, 'error', userMessage_(err), '', err && err.stack);
    return json_({ ok: false, error: userMessage_(err), retry: true });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  var handlers = {
    request: addRequest_,
    vote: vote_,
    raffle: enterRaffle_,
    djLogin: djLogin_,
    djRemove: djRemove_,
    djPlayed: djPlayed_,
    djRestore: djRestore_,
    djSettings: djSettings_,
    djClear: djClear_,
    djDraw: djDraw_,
    djHideWinner: djHideWinner_,
    djRaffleList: djRaffleList_,
    djRaffleRemove: djRaffleRemove_,
    djRaffleRestore: djRaffleRestore_,
  };
  var action = body && body.action;
  var fn = handlers[action];
  if (!fn) return json_({ ok: false, error: 'Unknown action' });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    // lots of people at once: the website keeps the submission and tries again by itself
    return json_({ ok: false, error: 'Lots of people at once! Trying again…', code: 503, retry: true });
  }
  var sidKey = WRITE_ACTIONS[action] && /^[a-z0-9-]{8,64}$/i.test(String(body.sid || '')) ? 'sid:' + body.sid : null;
  try {
    try { tidyOnce_(true); } catch (err) { log_('tidy', 'error', userMessage_(err), '', err && err.stack); }
    var cache = CacheService.getScriptCache();
    if (sidKey) {
      // the same submission sent twice (a retry after a dropped connection) is answered, not repeated
      var prev = cache.get(sidKey);
      if (prev) {
        var again = JSON.parse(prev);
        again.ok = true;
        again.replayed = true;
        again.state = getState_(true);
        return json_(again);
      }
    }
    var out = fn(body) || {};
    SpreadsheetApp.flush();
    bustCache_();
    if (sidKey) {
      try { cache.put(sidKey, JSON.stringify(out), 1800); } catch (ignored) {}
    }
    out.ok = true;
    out.state = getState_(true);
    return json_(out);
  } catch (err) {
    var code = (err && err.code) || 500;
    if (code !== 401) log_(action, code === 500 ? 'error' : 'rejected', userMessage_(err), clientId_(body.client), describe_(body, err));
    return json_({ ok: false, error: userMessage_(err), code: code, retry: code === 500 });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

// ------------------------------------------------------------------ public state (what the website shows)

function getState_(fresh) {
  var cache = CacheService.getScriptCache();
  if (!fresh) {
    var hit = cache.get(CACHE_KEY);
    if (hit) return JSON.parse(hit);
  }
  var settings = readSettings_();
  var rows = readRows_(SHEET.requests, REQ_HEADERS.length);
  var queue = [], played = [];
  rows.forEach(function (r) {
    if (!r[RQ.id] || !r[RQ.title]) return;
    var item = {
      id: String(r[RQ.id]), title: String(r[RQ.title]), artist: String(r[RQ.artist]), by: String(r[RQ.by]),
      votes: Number(r[RQ.votes]) || 1, at: time_(r[RQ.at]),
    };
    if (truthy_(r[RQ.removed])) return;
    if (truthy_(r[RQ.played])) {
      item.playedAt = time_(r[RQ.playedAt]) || item.at;
      played.push(item);
    } else {
      queue.push(item);
    }
  });
  queue.sort(function (a, b) { return a.at - b.at; });
  played.sort(function (a, b) { return b.playedAt - a.playedAt; });
  var entries = readRows_(SHEET.raffle, RAFFLE_HEADERS.length).filter(function (r) {
    return r[RF.handle] && !truthy_(r[RF.removed]);
  }).length;
  var winner = null;
  if (settings.raffleWinner) {
    var w = String(settings.raffleWinner).split(':');
    winner = { platform: w[0], handle: w.slice(1).join(':') };
  }
  var state = {
    ok: true,
    version: VERSION,
    now: Date.now(),
    settings: {
      requestsOpen: settings.requestsOpen,
      raffleOpen: settings.raffleOpen,
      nowSpinning: String(settings.nowSpinning || ''),
      notice: String(settings.notice || ''),
    },
    queue: queue,
    played: played.slice(0, 8),
    raffle: { entries: entries, winner: winner },
    lineup: LINEUP,
  };
  try { cache.put(CACHE_KEY, JSON.stringify(state), CACHE_SEC); } catch (ignored) {}
  return state;
}

function health_() {
  var reqs = readRows_(SHEET.requests, REQ_HEADERS.length).filter(function (r) { return r[RQ.id]; }).length;
  var raffle = readRows_(SHEET.raffle, RAFFLE_HEADERS.length).filter(function (r) { return r[RF.handle]; }).length;
  return { ok: true, version: VERSION, now: Date.now(), requests: reqs, raffleEntries: raffle,
    tidy: PropertiesService.getScriptProperties().getProperty('tidyVersion') === TIDY_VERSION };
}

// ------------------------------------------------------------------ song requests

function addRequest_(b) {
  var settings = readSettings_();
  if (!settings.requestsOpen) fail_('Requests are paused right now. Try again later!', 409);
  var title = clean_(b.title), artist = clean_(b.artist), by = clean_(b.by);
  if (!title) fail_('Add the song title.');
  if (!artist) fail_('Add the artist.');
  if (!by) fail_('Add your name so the DJ knows who asked.');
  if (title.length > LIMITS.title || artist.length > LIMITS.artist || by.length > LIMITS.by) fail_('That is a bit long. Shorten it and try again.');
  var client = clientId_(b.client);
  var sheet = sheet_(SHEET.requests);
  var rows = readRows_(SHEET.requests, REQ_HEADERS.length);
  var key = norm_(title) + '|' + norm_(artist);
  var active = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (truthy_(r[RQ.played]) || truthy_(r[RQ.removed]) || !r[RQ.id]) continue;
    active++;
    if (norm_(r[RQ.title]) + '|' + norm_(r[RQ.artist]) === key) {
      // already in the queue: count it as a vote instead of a duplicate (doesn't use up the request limit)
      var voters = String(r[RQ.voters] || '').split(',').filter(String);
      if (voters.indexOf(client) === -1) {
        voters.push(client);
        sheet.getRange(i + 2, RQ.votes + 1).setValue((Number(r[RQ.votes]) || 1) + 1);
        sheet.getRange(i + 2, RQ.voters + 1).setValue(voters.join(','));
      }
      return { merged: true, id: String(r[RQ.id]) };
    }
  }
  if (active >= LIMITS.activeQueueMax) fail_('The queue is full right now. Try again in a bit!', 409);
  rateLimit_('rq:' + client, LIMITS.requestsPerClient, LIMITS.requestWindowSec,
    'Easy there! You can send a few requests every 10 minutes.');
  var id = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  appendRow_(SHEET.requests, [id, new Date(), safe_(title), safe_(artist), safe_(by), 1, false, false, '', client, client], RQ_CHECKBOXES);
  return { id: id };
}

function vote_(b) {
  var client = clientId_(b.client);
  rateLimit_('vote:' + client, 30, 600, 'That is a lot of hearts! Give it a minute.');
  var found = findRequest_(b.id);
  if (!found || truthy_(found.row[RQ.played]) || truthy_(found.row[RQ.removed])) fail_('That request is not in the queue anymore.', 404);
  var voters = String(found.row[RQ.voters] || '').split(',').filter(String);
  if (voters.indexOf(client) !== -1) return { votes: Number(found.row[RQ.votes]) || 1, already: true };
  voters.push(client);
  var votes = (Number(found.row[RQ.votes]) || 1) + 1;
  found.sheet.getRange(found.rowNumber, RQ.votes + 1).setValue(votes);
  found.sheet.getRange(found.rowNumber, RQ.voters + 1).setValue(voters.join(','));
  return { votes: votes };
}

// ------------------------------------------------------------------ raffle

// Usernames that don't look quite right are still entered (and marked "double-check" in the sheet):
// a slightly-off @ beats someone giving up. Only empty, overlong or clearly-not-a-username input is refused.
var IG_RE = /^[a-z0-9._]{1,30}$/i;
var TG_RE = /^[a-z0-9_]{5,32}$/i;
var LOOSE_RE = /^[A-Za-z0-9._\- \u00C0-\uFFFF]{2,40}$/;

function checkHandle_(platform, raw) {
  if (!raw) fail_('Add your @ first.');
  if (raw.length > LIMITS.handle) fail_('That is a bit long for an @. Just the username, like @frostyxlr8.');
  if (/^\+?[\d\s()-]{7,}$/.test(raw)) fail_(platform === 'telegram' ? 'Use your Telegram @username, not a phone number.' : 'Use your Instagram @username, not a phone number.');
  var strict = (platform === 'instagram' ? IG_RE : TG_RE).test(raw);
  if (!strict && !LOOSE_RE.test(raw)) fail_('Just the username please, like @frostyxlr8 (letters, numbers, dots and _).');
  return strict;
}

function enterRaffle_(b) {
  var settings = readSettings_();
  if (!settings.raffleOpen) fail_('Raffle entries are closed.', 409);
  var platform = String(b.platform || '').toLowerCase();
  if (platform !== 'instagram' && platform !== 'telegram') fail_('Pick Instagram or Telegram.');
  var handle = cleanHandle_(b.handle);
  var valid = checkHandle_(platform, handle);
  var follows = (Array.isArray(b.follows) ? b.follows : []).map(String).filter(function (f) { return FOLLOWS.indexOf(f) !== -1; });
  var client = clientId_(b.client);
  var sheet = sheet_(SHEET.raffle);
  var rows = readRows_(SHEET.raffle, RAFFLE_HEADERS.length);
  var key = handle.toLowerCase().replace(/\s+/g, '');
  var maxTicket = 0, mine = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    maxTicket = Math.max(maxTicket, Number(r[RF.ticket]) || 0);
    if (!r[RF.handle]) continue;
    if (String(r[RF.client]) === client && !truthy_(r[RF.removed])) mine++;
    if (String(r[RF.platform]).toLowerCase() === platform && cleanHandle_(r[RF.handle]).toLowerCase().replace(/\s+/g, '') === key) {
      if (follows.length) sheet.getRange(i + 2, RF.followed + 1).setValue(follows.join(', '));
      if (truthy_(r[RF.removed])) sheet.getRange(i + 2, RF.removed + 1).setValue(false);
      return { ticket: Number(r[RF.ticket]), already: true, handle: '@' + handle, platform: platform };
    }
  }
  if (client !== 'anon' && mine >= LIMITS.entriesPerClient) fail_('This device already entered a few people. One entry each!', 429);
  var ticket = maxTicket + 1;
  var profile = valid ? (platform === 'instagram' ? 'https://instagram.com/' : 'https://t.me/') + handle : '';
  appendRow_(SHEET.raffle, [ticket, new Date(), platform, safe_('@' + handle), profile, follows.join(', '), client, false, false, valid ? '' : 'double-check'], RF_CHECKBOXES);
  return { ticket: ticket, handle: '@' + handle, platform: platform, check: !valid };
}

// ------------------------------------------------------------------ DJ portal (password checked here, never in the page)

function djLogin_(b) {
  requireDj_(b);
  return { dj: true, sheetUrl: ss_().getUrl() };
}

function djDraw_(b) {
  requireDj_(b);
  var w = drawWinner_();
  if (!w) fail_('No raffle entries left to draw from.', 404);
  return { winner: w };
}

function djHideWinner_(b) {
  requireDj_(b);
  writeSettings_({ raffleWinner: '' });
  return {};
}

function djRaffleList_(b) {
  requireDj_(b);
  var entries = readRows_(SHEET.raffle, RAFFLE_HEADERS.length).filter(function (r) { return r[RF.handle]; }).map(function (r) {
    return {
      ticket: Number(r[RF.ticket]), handle: String(r[RF.handle]), platform: String(r[RF.platform]),
      followed: String(r[RF.followed] || '').split(',').filter(function (s) { return s.trim(); }).length,
      at: time_(r[RF.at]), winner: truthy_(r[RF.winner]), removed: truthy_(r[RF.removed]), check: String(r[RF.check] || ''),
    };
  });
  return { entries: entries };
}

function setRaffleRemoved_(b, value) {
  requireDj_(b);
  var ticket = Number(b.ticket);
  var rows = readRows_(SHEET.raffle, RAFFLE_HEADERS.length);
  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i][RF.ticket]) === ticket && rows[i][RF.handle]) {
      var cell = sheet_(SHEET.raffle).getRange(i + 2, RF.removed + 1);
      cell.insertCheckboxes();
      cell.setValue(value);
      return djRaffleList_(b);
    }
  }
  fail_('Raffle ticket not found.', 404);
}

function djRaffleRemove_(b) { return setRaffleRemoved_(b, true); }
function djRaffleRestore_(b) { return setRaffleRemoved_(b, false); }

function djRemove_(b) {
  requireDj_(b);
  var found = findRequest_(b.id);
  if (!found) fail_('Request not found.', 404);
  found.sheet.getRange(found.rowNumber, RQ.removed + 1).setValue(true);
  return {};
}

function djPlayed_(b) {
  requireDj_(b);
  var found = findRequest_(b.id);
  if (!found) fail_('Request not found.', 404);
  found.sheet.getRange(found.rowNumber, RQ.played + 1).setValue(true);
  found.sheet.getRange(found.rowNumber, RQ.playedAt + 1).setValue(new Date());
  return {};
}

function djRestore_(b) {
  requireDj_(b);
  var found = findRequest_(b.id);
  if (!found) fail_('Request not found.', 404);
  found.sheet.getRange(found.rowNumber, RQ.played + 1).setValue(false);
  found.sheet.getRange(found.rowNumber, RQ.removed + 1).setValue(false);
  return {};
}

function djSettings_(b) {
  requireDj_(b);
  var patch = {};
  if (typeof b.requestsOpen === 'boolean') patch.requestsOpen = b.requestsOpen;
  if (typeof b.raffleOpen === 'boolean') patch.raffleOpen = b.raffleOpen;
  if (typeof b.nowSpinning === 'string') {
    var dj = clean_(b.nowSpinning);
    if (dj.length > 40) fail_('That name is too long.');
    patch.nowSpinning = safe_(dj);
  }
  if (typeof b.notice === 'string') {
    var notice = clean_(b.notice);
    if (notice.length > LIMITS.notice) fail_('Keep the announcement under ' + LIMITS.notice + ' characters.');
    patch.notice = safe_(notice);
  }
  writeSettings_(patch);
  return {};
}

function djClear_(b) {
  requireDj_(b);
  var sheet = sheet_(SHEET.requests);
  var rows = readRows_(SHEET.requests, REQ_HEADERS.length);
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][RQ.id] || truthy_(rows[i][RQ.played]) || truthy_(rows[i][RQ.removed])) continue;
    sheet.getRange(i + 2, RQ.removed + 1).setValue(true);
    n++;
  }
  return { cleared: n };
}

function requireDj_(b) {
  var cache = CacheService.getScriptCache();
  var bad = Number(cache.get('badlogins') || 0);
  if (bad >= LIMITS.badLoginsMax) fail_('Too many wrong passwords. Wait a few minutes.', 429);
  var custom = PropertiesService.getScriptProperties().getProperty('DJ_PASSWORD');
  var given = String(b.password || '');
  var ok = custom ? given === custom : sha256Hex_(given) === DJ_PASSWORD_SHA256;
  if (!ok) {
    cache.put('badlogins', String(bad + 1), LIMITS.badLoginWindowSec);
    fail_('Wrong password.', 401);
  }
}

// ------------------------------------------------------------------ sheet menu, triggers and setup

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🌴 Pawsessed')
    .addItem('🎟️ Draw raffle winner', 'drawRaffleWinner')
    .addItem('✅ Mark every queued request played', 'markAllPlayed')
    .addItem('🔄 Push sheet edits to the website now', 'refreshWebsite')
    .addSeparator()
    .addItem('⚙️ Set up / repair the sheets', 'setup')
    .addToUi();
}

// simple trigger (bound sheets only): ticking Played/Removed or editing Settings shows on the website right away
function onEdit() {
  bustCache_();
}

function refreshWebsite() {
  bustCache_();
}

// menu / editor version: draws and shows a popup when there is a sheet UI to show it in
function drawRaffleWinner() {
  var w = drawWinner_();
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (ignored) {}
  var msg = w ? '🎉 Winner: ' + w.handle + ' (' + w.platform + ', ticket #' + w.ticket + ')\n\nIt now shows on the website. Clear Settings > raffleWinner to hide it.'
    : 'No raffle entries left to draw from.';
  if (ui) ui.alert(msg); else console.log(msg);
  return w;
}

function drawWinner_() {
  var sheet = sheet_(SHEET.raffle);
  var rows = readRows_(SHEET.raffle, RAFFLE_HEADERS.length);
  var pool = [];
  rows.forEach(function (r, i) { if (r[RF.handle] && !truthy_(r[RF.winner]) && !truthy_(r[RF.removed])) pool.push(i); });
  if (!pool.length) return null;
  var pick = pool[Math.floor(Math.random() * pool.length)];
  var r = rows[pick];
  var cell = sheet.getRange(pick + 2, RF.winner + 1);
  cell.insertCheckboxes();
  cell.setValue(true);
  writeSettings_({ raffleWinner: String(r[RF.platform]) + ':' + String(r[RF.handle]) });
  bustCache_();
  return { ticket: Number(r[RF.ticket]), handle: String(r[RF.handle]), platform: String(r[RF.platform]) };
}

function markAllPlayed() {
  var sheet = sheet_(SHEET.requests);
  var rows = readRows_(SHEET.requests, REQ_HEADERS.length);
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][RQ.id] || truthy_(rows[i][RQ.played]) || truthy_(rows[i][RQ.removed])) continue;
    sheet.getRange(i + 2, RQ.played + 1).setValue(true);
    sheet.getRange(i + 2, RQ.playedAt + 1).setValue(new Date());
  }
  bustCache_();
}

/** Creates (or repairs) the tabs, their headers and the settings rows, and tidies the data. Safe to re-run.
 *  Prints the Sheet's link in the execution log. */
function setup() {
  var ss = ss_();
  setupSheets_(ss);
  tidy_(SHEET.requests, REQ_HEADERS.length, RQ_CHECKBOXES);
  tidy_(SHEET.raffle, RAFFLE_HEADERS.length, RF_CHECKBOXES);
  PropertiesService.getScriptProperties().setProperty('tidyVersion', TIDY_VERSION);
  console.log('✅ Sheet ready: ' + ss.getUrl());
  return ss.getUrl();
}

function setupSheets_(ss) {
  // Checkboxes are added row by row as data arrives. (Pre-filling them down the sheet makes Sheets treat
  // those rows as used, which pushed every new row below them.)
  var req = ensureSheet_(ss, SHEET.requests, REQ_HEADERS);
  req.getRange('B2:B').setNumberFormat('ddd h:mm am/pm');
  req.getRange('I2:I').setNumberFormat('ddd h:mm am/pm');
  req.setColumnWidth(RQ.title + 1, 240);
  req.setColumnWidth(RQ.artist + 1, 180);
  req.setColumnWidth(RQ.by + 1, 140);
  req.hideColumns(RQ.client + 1, 2);
  var grey = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=OR($G2=TRUE,$H2=TRUE)')
    .setFontColor('#9aa0a6').setStrikethrough(true)
    .setRanges([req.getRange('A2:K')]).build();
  req.setConditionalFormatRules([grey]);

  var raffle = ensureSheet_(ss, SHEET.raffle, RAFFLE_HEADERS);
  raffle.getRange('B2:B').setNumberFormat('ddd h:mm am/pm');
  raffle.setColumnWidth(RF.handle + 1, 180);
  raffle.setColumnWidth(RF.profile + 1, 220);
  raffle.setColumnWidth(RF.followed + 1, 320);
  raffle.hideColumns(RF.client + 1, 1);
  var struck = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$I2=TRUE')
    .setFontColor('#9aa0a6').setStrikethrough(true)
    .setRanges([raffle.getRange('A2:J')]).build();
  raffle.setConditionalFormatRules([struck]);

  var set = ensureSheet_(ss, SHEET.settings, ['Setting', 'Value', 'What it does']);
  var have = readRows_(SHEET.settings, 3).map(function (r) { return String(r[0]); });
  SETTINGS_DEFAULTS.forEach(function (d) {
    if (have.indexOf(d[0]) === -1) set.appendRow(d);
  });
  var keys = readRows_(SHEET.settings, 3).map(function (r) { return String(r[0]); });
  ['requestsOpen', 'raffleOpen'].forEach(function (k) {
    var i = keys.indexOf(k);
    if (i === -1) return;
    var cell = set.getRange(i + 2, 2);
    var v = cell.getValue();
    cell.insertCheckboxes();
    cell.setValue(v === '' ? true : truthy_(v));
  });
  var ns = keys.indexOf('nowSpinning');
  if (ns !== -1) {
    set.getRange(ns + 2, 2).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList([''].concat(LINEUP), true).setAllowInvalid(true).build());
  }
  set.setColumnWidth(1, 140);
  set.setColumnWidth(2, 220);
  set.setColumnWidth(3, 420);
  ensureSheet_(ss, SHEET.log, LOG_HEADERS).setColumnWidth(4, 360);
  bustCache_();
}

// ------------------------------------------------------------------ keeping the tabs tidy

function isDataRow_(r, checkboxCols) {
  for (var c = 0; c < r.length; c++) {
    if (checkboxCols.indexOf(c) !== -1) continue;
    if (String(r[c] == null ? '' : r[c]).trim() !== '') return true;
  }
  return false;
}

/** Moves a tab's rows into one block starting at row 2 (no blank or checkbox-only rows in between or
 *  after) and puts checkboxes back on just those rows. Returns true if it changed anything. */
function tidy_(name, width, checkboxCols) {
  var sh = ss_().getSheetByName(name);
  if (!sh) return false;
  var last = sh.getLastRow();
  if (last < 2) return false;
  var range = sh.getRange(2, 1, last - 1, width);
  var vals = range.getValues();
  var keep = vals.filter(function (r) { return isDataRow_(r, checkboxCols); });
  if (keep.length === vals.length) return false;
  range.clearContent();
  range.clearDataValidations();
  if (keep.length) {
    sh.getRange(2, 1, keep.length, width).setValues(keep.map(function (r) {
      return r.map(function (v, c) { return checkboxCols.indexOf(c) !== -1 ? truthy_(v) : v; });
    }));
    checkboxCols.forEach(function (c) {
      var col = sh.getRange(2, c + 1, keep.length, 1);
      col.insertCheckboxes();
      col.setValues(keep.map(function (r) { return [truthy_(r[c])]; }));
    });
  }
  log_('tidy', 'fixed', name + ': ' + keep.length + ' rows moved back to the top (from rows up to ' + last + ')', '', '');
  return true;
}

// once per TIDY_VERSION: fixes sheets set up by the first version (rows pushed below row 1000)
function tidyOnce_(haveLock) {
  // checked on every poll, so remember "done" in the cache (Script properties have a daily read quota)
  var cache = CacheService.getScriptCache();
  var doneKey = 'tidy:' + TIDY_VERSION;
  if (cache.get(doneKey)) return;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('tidyVersion') === TIDY_VERSION) {
    cache.put(doneKey, '1', 21600);
    return;
  }
  var lock = null;
  if (!haveLock) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return; // someone else is writing; the next request will do it
  }
  try {
    if (props.getProperty('tidyVersion') === TIDY_VERSION) return;
    setupSheets_(ss_());
    tidy_(SHEET.requests, REQ_HEADERS.length, RQ_CHECKBOXES);
    tidy_(SHEET.raffle, RAFFLE_HEADERS.length, RF_CHECKBOXES);
    SpreadsheetApp.flush();
    props.setProperty('tidyVersion', TIDY_VERSION);
    cache.put(doneKey, '1', 21600);
    bustCache_();
  } finally {
    if (lock) try { lock.releaseLock(); } catch (ignored) {}
  }
}

/** Writes a row straight under the last row that holds data (never after stray formatting or checkboxes). */
function appendRow_(name, values, checkboxCols) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  var row = 2;
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, values.length).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      if (isDataRow_(vals[i], checkboxCols)) { row = i + 3; break; }
    }
  }
  sh.getRange(row, 1, 1, values.length).setValues([values]);
  checkboxCols.forEach(function (c) {
    var cell = sh.getRange(row, c + 1);
    cell.insertCheckboxes();
    cell.setValue(truthy_(values[c]));
  });
  return row;
}

// ------------------------------------------------------------------ log (failures only, so it stays useful)

function log_(action, result, message, client, details) {
  try {
    // the same problem from the same place is logged once every 10 minutes, so a bad spell can't flood the tab
    var cache = CacheService.getScriptCache();
    var key = 'log:' + sha256Hex_([action, result, message, client].join('|')).slice(0, 24);
    if (cache.get(key)) return;
    cache.put(key, '1', 600);
    var sh = ss_().getSheetByName(SHEET.log) || ensureSheet_(ss_(), SHEET.log, LOG_HEADERS);
    sh.appendRow([new Date(), String(action || ''), String(result || ''), safe_(String(message || '')), String(client || ''), safe_(String(details || '').slice(0, 500))]);
    var extra = sh.getLastRow() - 1 - LIMITS.logRows;
    if (extra > 0) sh.deleteRows(2, extra);
  } catch (ignored) {}
}

function describe_(body, err) {
  var b = {};
  ['action', 'title', 'artist', 'by', 'handle', 'platform', 'id', 'ticket'].forEach(function (k) {
    if (body && body[k] != null && body[k] !== '') b[k] = String(body[k]).slice(0, 80);
  });
  var out = JSON.stringify(b);
  if (err && !err.userMessage && err.stack) out += ' | ' + String(err.stack).split('\n')[0];
  return out;
}

// ------------------------------------------------------------------ helpers

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#1d0b3a').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return sh;
}

// the spreadsheet: the bound one, else the one this script created (Script property SHEET_ID), else a new one
var SS_ = null;
function ss_() {
  if (SS_) return SS_;
  try { SS_ = SpreadsheetApp.getActiveSpreadsheet(); } catch (ignored) {}
  if (SS_) return SS_;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) {
    try { SS_ = SpreadsheetApp.openById(id); } catch (ignored) { SS_ = null; }
    if (SS_) return SS_;
  }
  SS_ = SpreadsheetApp.create('Pawsessed Lagoon · requests & raffle');
  props.setProperty('SHEET_ID', SS_.getId());
  setupSheets_(SS_);
  props.setProperty('tidyVersion', TIDY_VERSION);
  return SS_;
}

function sheet_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    setupSheets_(ss);
    sh = ss.getSheetByName(name);
  }
  return sh;
}

function readRows_(name, width) {
  var sh = ss_().getSheetByName(name);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, width).getValues();
}

function readSettings_() {
  var out = { requestsOpen: true, raffleOpen: true, nowSpinning: '', notice: '', raffleWinner: '' };
  readRows_(SHEET.settings, 2).forEach(function (r) {
    var k = String(r[0]);
    if (!(k in out)) return;
    out[k] = (k === 'requestsOpen' || k === 'raffleOpen') ? truthy_(r[1]) : String(r[1] == null ? '' : r[1]);
  });
  return out;
}

function writeSettings_(patch) {
  var sh = sheet_(SHEET.settings);
  var rows = readRows_(SHEET.settings, 2);
  Object.keys(patch).forEach(function (k) {
    var idx = -1;
    for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === k) { idx = i; break; }
    if (idx === -1) {
      var def = SETTINGS_DEFAULTS.filter(function (d) { return d[0] === k; })[0];
      sh.appendRow([k, patch[k], def ? def[2] : '']);
      rows.push([k, patch[k]]);
    } else {
      sh.getRange(idx + 2, 2).setValue(patch[k]);
    }
  });
}

function findRequest_(id) {
  id = String(id || '');
  if (!id) return null;
  var sheet = sheet_(SHEET.requests);
  var rows = readRows_(SHEET.requests, REQ_HEADERS.length);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][RQ.id]) === id) return { sheet: sheet, row: rows[i], rowNumber: i + 2 };
  }
  return null;
}

function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function rateLimit_(key, max, windowSec, message) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get(key) || 0);
  if (n >= max) fail_(message, 429);
  cache.put(key, String(n + 1), windowSec);
}

function bustCache_() {
  try { CacheService.getScriptCache().remove(CACHE_KEY); } catch (ignored) {}
}

// control characters, zero-width characters and the Unicode line/paragraph separators
var CONTROL_CHARS_ = new RegExp('[\x00-\x1f\x7f​-‏  ]', 'g');

function clean_(s) {
  return String(s == null ? '' : s).replace(CONTROL_CHARS_, ' ').replace(/\s+/g, ' ').trim();
}

// a cell value starting with = + - @ would be run as a formula by Sheets; a leading ' keeps it plain text
function safe_(s) {
  s = String(s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function cleanHandle_(s) {
  s = clean_(s).replace(/^https?:\/\//i, '').replace(/^(www\.)?(instagram\.com|t\.me|telegram\.me)\//i, '');
  return s.replace(/^@+/, '').replace(/[/?#].*$/, '').trim();
}

function norm_(s) {
  return clean_(s).toLowerCase().replace(/[^a-z0-9À-￿]+/g, '');
}

function clientId_(c) {
  c = String(c || '');
  return /^[a-z0-9-]{8,64}$/i.test(c) ? c : 'anon';
}

function truthy_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function time_(v) {
  if (v instanceof Date) return v.getTime();
  var t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

function fail_(message, code) {
  var e = new Error(message);
  e.userMessage = message;
  e.code = code || 400;
  throw e;
}

function userMessage_(err) {
  if (err && err.userMessage) return err.userMessage;
  console.error(err && err.stack ? err.stack : err);
  return 'Something went wrong. Try again in a moment.';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
