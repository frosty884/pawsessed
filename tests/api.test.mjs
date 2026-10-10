// Unit tests for apps-script/Code.gs, run against the in-memory Sheets stand-in.
//   node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from './mock-gas.mjs';

const CLIENT = 'client-aaaa-1111';
const fresh = () => {
  const g = createGas();
  g.ctx.setup();
  return g;
};
const req = (g, title, artist, by = 'Sam', client = CLIENT) => g.call.post({ action: 'request', title, artist, by, client });

test('setup creates the tabs with headers and default settings', () => {
  const g = fresh();
  assert.deepEqual([...g.sheets.keys()].sort(), ['Log', 'Raffle', 'Requests', 'Settings']);
  assert.equal(g.sheet('Requests').cells[0][2], 'Title');
  const settings = Object.fromEntries(g.sheet('Settings').rows().map((r) => [r[0], r[1]]));
  assert.equal(settings.requestsOpen, true);
  assert.equal(settings.raffleOpen, true);
  assert.equal(g.props.get('DJ_PASSWORD'), undefined, 'no plain-text password is stored');
  // setup is safe to run twice
  g.ctx.setup();
  assert.equal(g.sheet('Settings').rows().length, 5);
});

test('state works on an empty sheet', () => {
  const s = fresh().call.get();
  assert.equal(s.ok, true);
  assert.deepEqual(s.queue, []);
  assert.equal(s.raffle.entries, 0);
  assert.equal(s.settings.requestsOpen, true);
  assert.deepEqual(s.lineup, ['Vortex Fox', 'Frosty', 'Ming-Yan', 'Bunitsi']);
});

test('a request lands in the sheet and in the public queue', () => {
  const g = fresh();
  const r = req(g, '  Sandstorm ', 'Darude', 'Frosty fan');
  assert.equal(r.ok, true);
  assert.ok(r.id);
  assert.equal(r.state.queue.length, 1);
  assert.deepEqual(
    { title: r.state.queue[0].title, artist: r.state.queue[0].artist, by: r.state.queue[0].by, votes: r.state.queue[0].votes },
    { title: 'Sandstorm', artist: 'Darude', by: 'Frosty fan', votes: 1 });
  const row = g.sheet('Requests').rows()[0];
  assert.equal(row[2], 'Sandstorm');
  assert.equal(row[6], false);
  assert.equal(row[7], false);
});

test('requests need a title, an artist and a name', () => {
  const g = fresh();
  assert.match(req(g, '', 'x').error, /title/);
  assert.match(req(g, 'x', '').error, /artist/);
  assert.match(req(g, 'x', 'y', '   ').error, /name/);
  assert.match(req(g, 'x'.repeat(101), 'y').error, /long/);
  assert.equal(g.sheet('Requests').rows().length, 0);
});

test('formula injection is stored as plain text', () => {
  const g = fresh();
  const r = req(g, '=IMPORTXML("http://evil","//a")', '+SUM(1)', '@everyone');
  assert.equal(r.ok, true);
  const row = g.sheet('Requests').rows()[0];
  for (const v of row) assert.ok(!(v && typeof v === 'object' && v.formula), 'no cell may become a formula');
  assert.equal(row[2], '=IMPORTXML("http://evil","//a")');
  assert.equal(r.state.queue[0].by, '@everyone');
});

test('the same song twice becomes a vote, not a duplicate', () => {
  const g = fresh();
  req(g, 'Sandstorm', 'Darude', 'A', 'client-aaaa-0001');
  const r = req(g, 'sandstorm!!', 'DARUDE', 'B', 'client-bbbb-0002');
  assert.equal(r.merged, true);
  assert.equal(r.state.queue.length, 1);
  assert.equal(r.state.queue[0].votes, 2);
  // the same device asking again does not add more votes
  const again = req(g, 'Sandstorm', 'Darude', 'B', 'client-bbbb-0002');
  assert.equal(again.state.queue[0].votes, 2);
});

test('hearts: one vote per device', () => {
  const g = fresh();
  const { id } = req(g, 'Song', 'Artist');
  const v1 = g.call.post({ action: 'vote', id, client: 'client-cccc-0003' });
  assert.equal(v1.votes, 2);
  const v2 = g.call.post({ action: 'vote', id, client: 'client-cccc-0003' });
  assert.equal(v2.already, true);
  assert.equal(v2.state.queue[0].votes, 2);
  assert.match(g.call.post({ action: 'vote', id: 'nope', client: 'client-cccc-0003' }).error, /not in the queue/);
});

test('a device can only send a few requests per 10 minutes', () => {
  const g = fresh();
  for (let i = 0; i < 4; i++) assert.equal(req(g, 'Song ' + i, 'Artist').ok, true);
  assert.match(req(g, 'Song 5', 'Artist').error, /few requests/);
  assert.equal(req(g, 'Song 5', 'Artist', 'Sam', 'client-dddd-0004').ok, true);
});

test('ticking Played or Removed in the sheet takes the song off the website queue', () => {
  const g = fresh();
  req(g, 'One', 'A'); req(g, 'Two', 'B'); req(g, 'Three', 'C');
  const sh = g.sheet('Requests');
  sh.set(2, 7, true); // DJ ticks Played on "One"
  sh.set(3, 8, true); // ...and Removed on "Two"
  g.ctx.onEdit(); // the sheet's simple trigger clears the cache
  const s = g.call.get();
  assert.deepEqual(s.queue.map((q) => q.title), ['Three']);
  assert.deepEqual(s.played.map((q) => q.title), ['One']);
});

test('the public state is cached until something changes', () => {
  const g = fresh();
  req(g, 'One', 'A');
  g.call.get();
  g.sheet('Requests').set(2, 7, true); // edited without the onEdit trigger firing
  assert.equal(g.call.get().queue.length, 1, 'served from cache');
  g.ctx.refreshWebsite();
  assert.equal(g.call.get().queue.length, 0);
});

test('DJ actions need the password', () => {
  const g = fresh();
  const { id } = req(g, 'One', 'A');
  assert.match(g.call.post({ action: 'djLogin', password: 'nope' }).error, /Wrong password/);
  assert.equal(g.call.post({ action: 'djLogin', password: 'vortex' }).ok, true);
  assert.match(g.call.post({ action: 'djRemove', id, password: 'Vortex' }).error, /Wrong password/);
  assert.equal(g.call.get().queue.length, 1);
});

test('DJ can remove, mark played, restore and clear', () => {
  const g = fresh();
  const a = req(g, 'One', 'A').id;
  const b = req(g, 'Two', 'B').id;
  const c = req(g, 'Three', 'C').id;
  const pw = { password: 'vortex' };
  let s = g.call.post({ action: 'djRemove', id: a, ...pw }).state;
  assert.deepEqual(s.queue.map((q) => q.title), ['Two', 'Three']);
  s = g.call.post({ action: 'djPlayed', id: b, ...pw }).state;
  assert.deepEqual(s.queue.map((q) => q.title), ['Three']);
  assert.equal(s.played[0].title, 'Two');
  assert.ok(s.played[0].playedAt > 0);
  s = g.call.post({ action: 'djRestore', id: a, ...pw }).state;
  assert.deepEqual(s.queue.map((q) => q.title), ['One', 'Three']);
  const cleared = g.call.post({ action: 'djClear', ...pw });
  assert.equal(cleared.cleared, 2);
  assert.equal(cleared.state.queue.length, 0);
  assert.equal(g.call.post({ action: 'djPlayed', id: c, ...pw }).ok, true);
});

test('DJ settings: pause requests, now spinning, announcement', () => {
  const g = fresh();
  const pw = { password: 'vortex' };
  let r = g.call.post({ action: 'djSettings', requestsOpen: false, nowSpinning: 'Bunitsi', notice: 'Pizza in the kitchen!', ...pw });
  assert.equal(r.state.settings.requestsOpen, false);
  assert.equal(r.state.settings.nowSpinning, 'Bunitsi');
  assert.equal(r.state.settings.notice, 'Pizza in the kitchen!');
  assert.match(req(g, 'Song', 'Artist').error, /paused/);
  r = g.call.post({ action: 'djSettings', requestsOpen: true, ...pw });
  assert.equal(req(g, 'Song', 'Artist').ok, true);
  assert.match(g.call.post({ action: 'djSettings', notice: 'x'.repeat(200), ...pw }).error, /under 160/);
});

test('a DJ_PASSWORD script property replaces the built-in password', () => {
  const g = fresh();
  g.props.set('DJ_PASSWORD', 'new-pass');
  assert.match(g.call.post({ action: 'djLogin', password: 'vortex' }).error, /Wrong password/);
  assert.equal(g.call.post({ action: 'djLogin', password: 'new-pass' }).ok, true);
});

test('the password is not in the source code', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.ok(!/'vortex'/i.test(src));
});

test('too many wrong passwords locks the DJ login for a while', () => {
  const g = fresh();
  for (let i = 0; i < 25; i++) g.call.post({ action: 'djLogin', password: 'guess' + i });
  assert.match(g.call.post({ action: 'djLogin', password: 'vortex' }).error, /Too many/);
});

test('raffle: valid entry gets a ticket, the same handle again keeps it', () => {
  const g = fresh();
  const r = g.call.post({ action: 'raffle', handle: '@Frosty.XLR8', platform: 'instagram', follows: ['frostyxlr8', 'bunitsi', 'evil'], client: CLIENT });
  assert.equal(r.ok, true);
  assert.equal(r.ticket, 1);
  assert.equal(r.handle, '@Frosty.XLR8');
  const row = g.sheet('Raffle').rows()[0];
  assert.equal(row[2], 'instagram');
  assert.equal(row[3], '@Frosty.XLR8');
  assert.equal(row[4], 'https://instagram.com/Frosty.XLR8');
  assert.equal(row[5], 'frostyxlr8, bunitsi');
  const again = g.call.post({ action: 'raffle', handle: 'https://instagram.com/frosty.xlr8/', platform: 'instagram', client: 'client-zzzz-9999' });
  assert.equal(again.already, true);
  assert.equal(again.ticket, 1);
  assert.equal(again.state.raffle.entries, 1);
  const tg = g.call.post({ action: 'raffle', handle: 't.me/vortexthefox', platform: 'telegram', client: CLIENT });
  assert.equal(tg.ticket, 2);
  assert.equal(tg.state.raffle.entries, 2);
});

test('raffle: odd-looking handles go in (flagged), junk is refused, one device enters at most 3', () => {
  const g = fresh();
  const enter = (handle, platform, client = CLIENT) => g.call.post({ action: 'raffle', handle, platform, client });
  assert.match(enter('frosty', 'tiktok').error, /Instagram or Telegram/);
  assert.match(enter('', 'instagram').error, /Add your @/);
  assert.match(enter('=HYPERLINK("x")', 'instagram').error, /username/);
  assert.match(enter('+1 (555) 123-4567', 'telegram').error, /phone number/);
  assert.match(enter('x'.repeat(41), 'instagram').error, /long/);
  const odd = enter('Frosty Cat', 'instagram');
  assert.equal(odd.ok, true, 'a display name still gets an entry');
  assert.equal(odd.check, true);
  const row = g.sheet('Raffle').rows().find((r) => r[3] === '@Frosty Cat');
  assert.equal(row[9], 'double-check');
  assert.equal(row[4], '', 'no profile link for an unusual handle');
  assert.equal(enter('abc', 'telegram').check, true, 'short telegram names are flagged, not refused');
  assert.equal(enter('good_name', 'telegram').ok, true);
  assert.match(enter('one_more', 'telegram').error, /One entry each/, 'the 4th entry from one device is refused');
  assert.equal(enter('one_more', 'telegram', 'client-other-0002').ok, true);
});


test('raffle can be closed from settings', () => {
  const g = fresh();
  g.call.post({ action: 'djSettings', raffleOpen: false, password: 'vortex' });
  assert.match(g.call.post({ action: 'raffle', handle: 'someone', platform: 'instagram', client: CLIENT }).error, /closed/);
});

test('drawing a winner marks them and shows them on the website', () => {
  const g = fresh();
  g.call.post({ action: 'raffle', handle: 'only_one', platform: 'instagram', client: CLIENT });
  const w = g.ctx.drawRaffleWinner();
  assert.equal(w.handle, '@only_one');
  assert.equal(g.sheet('Raffle').rows()[0][7], true);
  assert.deepEqual(g.call.get().raffle.winner, { platform: 'instagram', handle: '@only_one' });
  assert.equal(g.ctx.drawRaffleWinner(), null, 'nobody left to draw');
  assert.match(g.alerts.at(-1), /No raffle entries/);
});

test('bad input never crashes the web app', () => {
  const g = fresh();
  assert.equal(g.call.post('not json').ok, false);
  assert.equal(g.call.post({ action: 'nope' }).error, 'Unknown action');
  assert.equal(g.call.get({ action: 'nope' }).ok, false);
  assert.equal(g.call.get({ action: 'ping' }).ok, true);
  assert.equal(g.call.post({ action: 'request', title: { a: 1 }, artist: ['x'], by: 5 }).ok, true, 'odd types are coerced to text');
});

test('the sheet repairs itself if a tab was deleted', () => {
  const g = fresh();
  g.sheets.delete('Requests');
  assert.equal(req(g, 'Song', 'Artist').ok, true);
  assert.equal(g.sheet('Requests').rows().length, 1);
});

test('standalone script (made at script.google.com) creates its own sheet once and reuses it', () => {
  const g = createGas({ standalone: true });
  assert.equal(g.call.get().ok, true, 'the first request creates the sheet');
  assert.equal(g.created(), 1);
  assert.equal(g.props.get('SHEET_ID'), 'sheet-id-1');
  assert.deepEqual([...g.sheets.keys()].sort(), ['Log', 'Raffle', 'Requests', 'Settings']);
  assert.equal(g.call.post({ action: 'request', title: 'Song', artist: 'Artist', by: 'Me', client: CLIENT }).ok, true);
  assert.equal(g.ctx.setup(), 'https://docs.google.com/spreadsheets/d/sheet-id-1/edit');
  assert.equal(g.created(), 1, 'never makes a second spreadsheet');
});

test('DJ portal: login gives the sheet link, draw and hide the raffle winner', () => {
  const g = fresh();
  const pw = { password: 'vortex' };
  assert.equal(g.call.post({ action: 'djLogin', ...pw }).sheetUrl, 'https://docs.google.com/spreadsheets/d/sheet-id-1/edit');
  assert.match(g.call.post({ action: 'djDraw', ...pw }).error, /No raffle entries/);
  g.call.post({ action: 'raffle', handle: 'lucky_one', platform: 'telegram', client: CLIENT });
  assert.match(g.call.post({ action: 'djDraw', password: 'nope' }).error, /Wrong password/);
  const d = g.call.post({ action: 'djDraw', ...pw });
  assert.deepEqual(d.winner, { ticket: 1, handle: '@lucky_one', platform: 'telegram' });
  assert.deepEqual(d.state.raffle.winner, { platform: 'telegram', handle: '@lucky_one' });
  const h = g.call.post({ action: 'djHideWinner', ...pw });
  assert.equal(h.state.raffle.winner, null);
});


// ---------------------------------------------------------------- robustness

test('new tabs have no pre-filled checkboxes, so the first entry lands on row 2', () => {
  const g = fresh();
  assert.equal(g.sheet('Requests').getLastRow(), 1);
  assert.equal(g.sheet('Raffle').getLastRow(), 1);
  g.call.post({ action: 'request', title: 'Song', artist: 'Artist', by: 'Me', client: CLIENT });
  g.call.post({ action: 'raffle', handle: 'first_one', platform: 'instagram', client: CLIENT });
  assert.equal(g.sheet('Requests').cells[1][2], 'Song');
  assert.equal(g.sheet('Raffle').cells[1][3], '@first_one');
  assert.ok(g.sheet('Requests').isCheckbox(2, 7) && g.sheet('Requests').isCheckbox(2, 8), 'Played/Removed are checkboxes on the new row');
  assert.ok(g.sheet('Raffle').isCheckbox(2, 8), 'Winner is a checkbox on the new row');
});

test('a sheet from the first version (entries pushed below row 1000) is tidied on the next visit', () => {
  const g = createGas();
  const ss = g.ss;
  // what the first version left behind: checkboxes pre-filled on rows 2-1000, real rows from 1001
  ss.insertSheet('Requests');
  ss.insertSheet('Raffle');
  ss.insertSheet('Settings');
  const req = g.sheet('Requests'), raf = g.sheet('Raffle');
  req.set(1, 1, 'ID');
  req.getRange(2, 7, 999, 2).insertCheckboxes();
  req.getRange(1001, 1, 2, 11).setValues([
    ['aaa111', new Date(), 'Billie Jean', 'Michael Jackson', 'Zeus', 3, false, false, '', 'client-z', 'client-z'],
    ['bbb222', new Date(), 'Murmure', 'Inlie', 'Kix', 1, true, false, new Date(), 'client-k', 'client-k'],
  ]);
  raf.set(1, 1, 'Ticket');
  raf.getRange(2, 8, 999, 1).insertCheckboxes();
  raf.getRange(1001, 1, 2, 8).setValues([
    [1, new Date(), 'instagram', '@kix7', 'https://instagram.com/kix7', 'frostyxlr8', 'client-k', false],
    [2, new Date(), 'telegram', '@zeus_dj', 'https://t.me/zeus_dj', '', 'client-z', false],
  ]);
  assert.equal(req.getLastRow(), 1002);

  const s = g.call.get();
  assert.equal(s.ok, true);
  assert.equal(s.raffle.entries, 2);
  assert.deepEqual(s.queue.map((q) => q.title), ['Billie Jean']);
  assert.deepEqual(s.played.map((q) => q.title), ['Murmure'], 'Played survives the move');
  assert.equal(req.getLastRow(), 3, 'requests now sit on rows 2-3');
  assert.equal(raf.getLastRow(), 3, 'raffle entries now sit on rows 2-3');
  assert.equal(req.cells[2][2], 'Murmure');
  assert.equal(req.cells[2][6], true);
  assert.ok(req.isCheckbox(3, 7) && !req.isCheckbox(500, 7), 'checkboxes only on real rows');
  assert.equal(g.props.get('tidyVersion'), '2');
  assert.ok(g.sheet('Log').rows().some((r) => r[1] === 'tidy' && r[2] === 'fixed'));
  // and the next entry goes right under them
  const r = g.call.post({ action: 'raffle', handle: 'next_person', platform: 'instagram', client: CLIENT });
  assert.equal(r.ticket, 3);
  assert.equal(raf.cells[3][3], '@next_person');
  assert.equal(raf.getLastRow(), 4);
});

test('entries go straight under the last real row even if empty checkboxes were added below', () => {
  const g = fresh();
  g.call.post({ action: 'raffle', handle: 'row_two', platform: 'instagram', client: CLIENT });
  g.sheet('Raffle').getRange(3, 8, 60, 1).insertCheckboxes(); // someone pre-fills checkboxes again
  g.call.post({ action: 'raffle', handle: 'row_three', platform: 'instagram', client: 'client-dddd-0004' });
  assert.equal(g.sheet('Raffle').cells[2][3], '@row_three');
});

test('a retried submission (same sid) is saved once and answered the same way', () => {
  const g = fresh();
  const body = { action: 'raffle', handle: 'retry_me', platform: 'instagram', client: CLIENT, sid: 'sid-1234-abcd' };
  const a = g.call.post(body);
  const b = g.call.post(body);
  assert.equal(a.ticket, 1);
  assert.equal(b.ticket, 1);
  assert.equal(b.replayed, true);
  assert.equal(g.sheet('Raffle').rows().length, 1);
  const r1 = g.call.post({ action: 'request', title: 'Once', artist: 'Only', by: 'Me', client: CLIENT, sid: 'sid-req-0001' });
  const r2 = g.call.post({ action: 'request', title: 'Once', artist: 'Only', by: 'Me', client: CLIENT, sid: 'sid-req-0001' });
  assert.equal(r1.id, r2.id);
  assert.equal(g.sheet('Requests').rows().length, 1);
});

test('when the sheet is busy the site is told to retry, and nothing is half-saved', () => {
  const g = fresh();
  g.lock.busy = true;
  const r = g.call.post({ action: 'raffle', handle: 'busy_time', platform: 'instagram', client: CLIENT, sid: 'sid-busy-0001' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 503);
  assert.equal(r.retry, true);
  assert.equal(g.sheet('Raffle').rows().length, 0);
  g.lock.busy = false;
  assert.equal(g.call.post({ action: 'raffle', handle: 'busy_time', platform: 'instagram', client: CLIENT, sid: 'sid-busy-0001' }).ticket, 1);
});

test('refused submissions are written to the Log tab (wrong DJ passwords are not)', () => {
  const g = fresh();
  g.call.post({ action: 'raffle', handle: '+1 555 123 4567', platform: 'telegram', client: CLIENT });
  g.call.post({ action: 'djLogin', password: 'nope' });
  const log = g.sheet('Log').rows();
  assert.equal(log.length, 1);
  assert.equal(log[0][1], 'raffle');
  assert.equal(log[0][2], 'rejected');
  assert.match(log[0][3], /phone number/);
  assert.match(log[0][5], /555/);
});

test('DJ portal: list, remove and restore raffle entries; removed ones are not counted or drawn', () => {
  const g = fresh();
  const pw = { password: 'vortex' };
  g.call.post({ action: 'raffle', handle: 'keep_me', platform: 'instagram', client: CLIENT });
  g.call.post({ action: 'raffle', handle: 'test_entry', platform: 'instagram', client: 'client-eeee-0005' });
  assert.match(g.call.post({ action: 'djRaffleList', password: 'nope' }).error, /Wrong password/);
  let r = g.call.post({ action: 'djRaffleList', ...pw });
  assert.deepEqual(r.entries.map((e) => e.handle), ['@keep_me', '@test_entry']);
  r = g.call.post({ action: 'djRaffleRemove', ticket: 2, ...pw });
  assert.equal(r.entries.find((e) => e.ticket === 2).removed, true);
  assert.equal(r.state.raffle.entries, 1);
  assert.equal(g.call.post({ action: 'djDraw', ...pw }).winner.handle, '@keep_me', 'removed entries are never drawn');
  r = g.call.post({ action: 'djRaffleRestore', ticket: 2, ...pw });
  assert.equal(r.state.raffle.entries, 2);
  assert.match(g.call.post({ action: 'djRaffleRemove', ticket: 99, ...pw }).error, /not found/);
});

test('health check reports the version and counts', () => {
  const g = fresh();
  g.call.post({ action: 'raffle', handle: 'healthy', platform: 'instagram', client: CLIENT });
  const h = g.call.get({ action: 'health' });
  assert.equal(h.ok, true);
  assert.equal(h.raffleEntries, 1);
  assert.equal(h.tidy, true);
  assert.match(h.version, /^2026-10-10/);
  assert.equal(g.call.get().version, h.version);
});
