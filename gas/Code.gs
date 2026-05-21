/**
 * Google Calendar → タスク管理アプリ 取込用 GAS
 *
 * 【使い方】
 * 1. https://script.google.com/ で新規プロジェクト作成
 * 2. このコードを貼り付け
 * 3. [デプロイ] → [新しいデプロイ] → 種類「ウェブアプリ」
 *    - 実行ユーザー: 自分
 *    - アクセスできるユーザー: 自分のみ（または「全員」※URLを知っている人のみ）
 * 4. デプロイ後に表示される URL をコピー
 * 5. タスク管理アプリの ⚙ 設定 → 「GAS URL」に貼り付け
 * 6. 「📅 カレンダーから取込」ボタンで同期
 *
 * 【取得対象】
 *   今日から DAYS_AHEAD 日先までの全予定
 *   - 件名 / 開始日時 / 場所 / 説明 / ゲスト
 *   - Google Meet / Zoom / Teams 等のURLを場所 or 説明から自動抽出
 *   - 最初のゲスト（自分以外）を「相手先」候補として返す
 */

const CONFIG = {
  daysAhead: 7,         // 何日先まで取得するか
  calendarId: 'primary', // 'primary' または特定のカレンダーID
};

function doGet(e) {
  try {
    const days = Number((e && e.parameter && e.parameter.days)) || CONFIG.daysAhead;
    const cal = (CONFIG.calendarId === 'primary')
      ? CalendarApp.getDefaultCalendar()
      : CalendarApp.getCalendarById(CONFIG.calendarId);

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + days);

    const tz = Session.getScriptTimeZone();
    const selfEmail = Session.getActiveUser().getEmail();
    const events = cal.getEvents(start, end);

    const list = events.map(ev => {
      const st = ev.getStartTime();
      const en = ev.getEndTime();
      const location = ev.getLocation() || '';
      const description = ev.getDescription() || '';
      const blob = location + '\n' + description;

      // Web会議URLの抽出（場所優先 → 説明文）
      let meetingUrl = '';
      if (/^https?:\/\//i.test(location.trim())) {
        meetingUrl = location.trim().split(/\s/)[0];
      } else {
        const m = blob.match(/https:\/\/(?:meet\.google\.com|[\w-]+\.zoom\.us|teams\.live\.com|teams\.microsoft\.com|[\w.-]*webex\.com|chime\.aws|[\w.-]*\.whereby\.com)[^\s<>"')]+/i);
        if (m) meetingUrl = m[0];
      }

      // ゲスト一覧（自分は除外）
      let guests = [];
      try {
        guests = ev.getGuestList(false)
          .map(g => ({ name: g.getName() || '', email: g.getEmail() || '' }))
          .filter(g => g.email && g.email.toLowerCase() !== (selfEmail || '').toLowerCase());
      } catch (_) {}

      const partner = guests.length ? (guests[0].name || guests[0].email) : '';
      const email = guests.length ? guests[0].email : '';

      return {
        id: ev.getId(),  // 外部ID（重複排除用）
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
      };
    });

    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      timeZone: tz,
      rangeDays: days,
      count: list.length,
      events: list,
    });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// 動作確認用（GASエディタで実行）
function _test_run() {
  const out = doGet({ parameter: { days: 3 } });
  Logger.log(out.getContent());
}
