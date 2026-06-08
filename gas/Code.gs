/**
 * Google Calendar + データ同期 → My Task 用 GAS
 *
 * 【エンドポイント】
 *   GET  ?action=list                       → カレンダー一覧
 *   GET  ?days=7&calendarIds=primary,xxx    → カレンダーから予定取得
 *   GET  ?action=load                       → 保存データの取得（クラウド → 端末）
 *   POST {"action":"save","data":{...}}     → 保存データの書込（端末 → クラウド）
 *
 * 【デプロイ】
 *   - ウェブアプリとしてデプロイ
 *   - 実行ユーザー: 自分
 *   - アクセスできるユーザー: 全員（URLを知る人のみアクセス可能）
 *
 * 【データ保存先】
 *   あなたの Google Drive に `mytask-data.json` を自動作成して保存します。
 *   削除した場合は次回保存時に再作成されます。
 */

const DEFAULTS = { daysAhead: 7 };
const DATA_FILE_NAME = 'mytask-data.json';

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === 'list') return listCalendars();
    if (params.action === 'load') return loadData();
    return getEvents(params);
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'save') return saveData(body);
    if (body.action === 'load') return loadData();
    if (body.action === 'cancelReminder') return cancelReminder(body);
    if (body.action === 'setReminder')    return setReminder(body);
    return json({ ok: false, error: 'unknown action: ' + body.action });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

/* ─── 予定通知の削除・設定 ───────────── */
function _getCalendar(calId) {
  if (!calId || calId === 'primary') return CalendarApp.getDefaultCalendar();
  try { return CalendarApp.getCalendarById(calId); } catch (_) { return null; }
}

function cancelReminder(body) {
  const eventId = body.eventId;
  if (!eventId) return json({ ok: false, error: 'eventId required' });
  const calId = body.calendarId || 'primary';
  const cal = _getCalendar(calId);
  if (!cal) return json({ ok: false, error: 'calendar not found: ' + calId });
  const event = cal.getEventById(eventId);
  if (!event) return json({ ok: false, error: 'event not found in calendar' });
  event.removeAllReminders();
  return json({ ok: true, action: 'cancelReminder', eventId: eventId });
}

function setReminder(body) {
  const eventId = body.eventId;
  if (!eventId) return json({ ok: false, error: 'eventId required' });
  const calId = body.calendarId || 'primary';
  const minutes = Number(body.minutes) || 10;
  const cal = _getCalendar(calId);
  if (!cal) return json({ ok: false, error: 'calendar not found: ' + calId });
  const event = cal.getEventById(eventId);
  if (!event) return json({ ok: false, error: 'event not found in calendar' });
  event.removeAllReminders();
  event.addPopupReminder(minutes);
  return json({ ok: true, action: 'setReminder', eventId: eventId, minutes: minutes });
}

/* ─── データ保存（Driveの JSON ファイル） ───────────── */
function _getDataFile() {
  const props = PropertiesService.getScriptProperties();
  let fileId = props.getProperty('DATA_FILE_ID');
  if (fileId) {
    try {
      const f = DriveApp.getFileById(fileId);
      if (!f.isTrashed()) return f;
    } catch (_) {}
  }
  const file = DriveApp.createFile(
    DATA_FILE_NAME,
    JSON.stringify({ _meta: { lastModified: 0, createdAt: new Date().toISOString() } }),
    MimeType.PLAIN_TEXT
  );
  props.setProperty('DATA_FILE_ID', file.getId());
  return file;
}

function loadData() {
  const file = _getDataFile();
  const content = file.getBlob().getDataAsString('UTF-8') || '{}';
  let data;
  try { data = JSON.parse(content); } catch (_) { data = {}; }
  return json({
    ok: true,
    data: data,
    lastModified: (data && data._meta && data._meta.lastModified) || 0,
    fileId: file.getId(),
  });
}

function saveData(body) {
  const file = _getDataFile();
  const data = body.data || {};
  if (!data._meta) data._meta = {};
  data._meta.lastModified = Number(data._meta.lastModified) || Date.now();
  data._meta.savedAt = new Date().toISOString();
  file.setContent(JSON.stringify(data));
  return json({
    ok: true,
    savedAt: data._meta.savedAt,
    lastModified: data._meta.lastModified,
    bytes: JSON.stringify(data).length,
  });
}

/* ─── カレンダー一覧 ─────────────────────── */
function listCalendars() {
  const cals = CalendarApp.getAllCalendars();
  const def = CalendarApp.getDefaultCalendar();
  const defId = def.getId();
  const list = cals.map(c => ({
    id: c.getId(),
    name: c.getName(),
    isOwned: safe(() => c.isOwnedByMe(), false),
    isDefault: c.getId() === defId,
    color: safe(() => c.getColor(), ''),
  }));
  list.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
  return json({ ok: true, calendars: list, defaultId: defId });
}

/* ─── 予定取得 ─────────────────────── */
function getEvents(params) {
  const days = Number(params.days) || DEFAULTS.daysAhead;
  const idsParam = (params.calendarIds || '').trim();
  let calendars;
  if (idsParam) {
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean);
    calendars = ids.map(id => {
      if (id === 'primary') return CalendarApp.getDefaultCalendar();
      try { return CalendarApp.getCalendarById(id); }
      catch (_) { return null; }
    }).filter(Boolean);
  } else {
    // カレンダー未指定: 全カレンダーから取得 (取込漏れ防止)
    calendars = CalendarApp.getAllCalendars();
  }

  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + days);

  const tz = Session.getScriptTimeZone();
  const selfEmail = (Session.getActiveUser().getEmail() || '').toLowerCase();

  const all = [];
  calendars.forEach(cal => {
    const calName = cal.getName();
    const calId = cal.getId();
    const events = cal.getEvents(start, end);
    events.forEach(ev => {
      const st = ev.getStartTime();
      const en = ev.getEndTime();
      const location = ev.getLocation() || '';
      const description = ev.getDescription() || '';
      const blob = location + '\n' + description;

      let meetingUrl = '';
      if (/^https?:\/\//i.test(location.trim())) {
        meetingUrl = location.trim().split(/\s/)[0];
      } else {
        const m = blob.match(/https:\/\/(?:meet\.google\.com|[\w-]+\.zoom\.us|teams\.live\.com|teams\.microsoft\.com|[\w.-]*webex\.com|chime\.aws|[\w.-]*\.whereby\.com)[^\s<>"')]+/i);
        if (m) meetingUrl = m[0];
      }

      let guests = [];
      try {
        guests = ev.getGuestList(false)
          .map(g => ({ name: g.getName() || '', email: g.getEmail() || '' }))
          .filter(g => g.email && g.email.toLowerCase() !== selfEmail);
      } catch (_) {}

      const partner = guests.length ? (guests[0].name || guests[0].email) : '';
      const email = guests.length ? guests[0].email : '';

      all.push({
        id: ev.getId(),
        calendarId: calId,
        calendarName: calName,
        date: Utilities.formatDate(st, tz, 'yyyy-MM-dd'),
        time: Utilities.formatDate(st, tz, 'HH:mm'),
        endTime: Utilities.formatDate(en, tz, 'HH:mm'),
        title: ev.getTitle() || '',
        partner: partner,
        email: email,
        guests: guests,
        meetingUrl: meetingUrl,
        location: location,
        notes: description.replace(/<[^>]+>/g, '').slice(0, 1000),
        allDay: ev.isAllDayEvent(),
      });
    });
  });

  all.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    timeZone: tz,
    rangeDays: days,
    count: all.length,
    calendars: calendars.map(c => ({ id: c.getId(), name: c.getName() })),
    events: all,
  });
}

/* ─── ヘルパー ─────────────────────── */
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function safe(fn, fallback) {
  try { return fn(); } catch (_) { return fallback; }
}

/* ─── 動作確認 ─────────── */
function _test_list()   { Logger.log(doGet({ parameter: { action: 'list' } }).getContent()); }
function _test_events() { Logger.log(doGet({ parameter: { days: 7 } }).getContent()); }
function _test_load()   { Logger.log(doGet({ parameter: { action: 'load' } }).getContent()); }
