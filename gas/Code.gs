/**
 * Google Calendar → My Task 取込用 GAS
 *
 * 【エンドポイント】
 *   ?action=list                       → 利用可能なカレンダー一覧を返す
 *   ?days=7&calendarIds=primary,xxx@x  → 指定カレンダーから予定取得
 *
 * 【デプロイ】
 *   - ウェブアプリとしてデプロイ
 *   - 実行ユーザー: 自分
 *   - アクセスできるユーザー: 全員（URL を知る人のみアクセス可能）
 */

const DEFAULTS = {
  daysAhead: 7,
};

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === 'list') {
      return listCalendars();
    }
    return getEvents(params);
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
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
  // 既定カレンダーを先頭に
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
    calendars = [CalendarApp.getDefaultCalendar()];
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

  // 開始時刻順にソート
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

/* ─── 動作確認用 (GASエディタで実行) ─── */
function _test_list() {
  const out = doGet({ parameter: { action: 'list' } });
  Logger.log(out.getContent());
}
function _test_events() {
  const out = doGet({ parameter: { days: 7 } });
  Logger.log(out.getContent());
}
