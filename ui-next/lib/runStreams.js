// Bộ đệm event SSE theo runId — cho client NỐI LẠI stream khi kết nối đứt giữa lượt.
//
// Vì sao cần: route chat/evidence/release/kloc/translate chạy killOnDisconnect:false, nên khi kết nối
// trình duyệt ↔ ngrok đứt thì run vẫn chạy tiếp ở server. Trước đây client chỉ poll /api/chat/active
// tới khi run xong rồi đọc đáp án từ .jsonl → mất toàn bộ phần hiển thị trực tiếp (chữ đang gõ, tiến
// trình) cho tới hết lượt. Giờ claudeSSE({ replayKey }) ghi mỗi event (kèm `id:` tăng dần) vào đây,
// và /api/chat/resume?runId=&from=N phát lại các event có id > N rồi nối tiếp phần đang chạy.
//
// Chỉ nằm trong RAM của process: app restart là mất bộ đệm → /api/chat/active báo resumable:false và
// client quay về cách cũ (poll + đọc .jsonl). globalThis giữ Map qua HMR của dev.
const g = globalThis;
if (!g.__aiRunStreams) g.__aiRunStreams = new Map(); // runId -> { frames, listeners, done, timer }
const streams = g.__aiRunStreams;

// Giữ bộ đệm thêm một lúc sau khi run xong: client có thể đứt ngay trước event `end` rồi mới nối lại.
const KEEP_AFTER_DONE_MS = 10 * 60 * 1000;
// Trần số event giữ cho MỘT run — chặn run chạy rất dài làm phình RAM. Vượt trần thì bỏ event cũ;
// client nối lại từ id đã bị bỏ sẽ nhận `gap` và tự quay về cách đọc .jsonl.
const MAX_FRAMES = 20000;

export function openRunStream(runId) {
  const old = streams.get(runId);
  if (old && old.timer) clearTimeout(old.timer);
  const s = { frames: [], first: 1, seq: 0, listeners: new Set(), done: false, timer: null };
  streams.set(runId, s);
  return s;
}

// Ghi một event; trả về id đã gán (dùng cho dòng `id:` của SSE).
export function pushRunEvent(runId, event, data) {
  const s = streams.get(runId);
  if (!s || s.done) return 0;
  const id = ++s.seq;
  const frame = { id, event, data };
  s.frames.push(frame);
  if (s.frames.length > MAX_FRAMES) { s.frames.shift(); s.first++; }
  for (const fn of s.listeners) { try { fn(frame); } catch {} }
  return id;
}

export function closeRunStream(runId) {
  const s = streams.get(runId);
  if (!s || s.done) return;
  s.done = true;
  for (const fn of s.listeners) { try { fn(null); } catch {} }
  s.listeners.clear();
  s.timer = setTimeout(() => { if (streams.get(runId) === s) streams.delete(runId); }, KEEP_AFTER_DONE_MS);
  if (s.timer.unref) s.timer.unref();
}

export function hasRunStream(runId) {
  return !!(runId && streams.get(runId));
}

// Phát lại các event có id > from rồi theo dõi event mới. onFrame(frame) nhận từng event, onFrame(null)
// khi run kết thúc. Trả về { gap, unsubscribe } — gap=true nghĩa là một phần event cần phát lại đã bị
// bỏ (vượt MAX_FRAMES), client không ghép lại được đúng nội dung.
export function subscribeRunStream(runId, from, onFrame) {
  const s = streams.get(runId);
  if (!s) return null;
  const gap = from + 1 < s.first;
  for (const f of s.frames) if (f.id > from) onFrame(f);
  if (s.done) { onFrame(null); return { gap, unsubscribe() {} }; }
  s.listeners.add(onFrame);
  return { gap, unsubscribe() { s.listeners.delete(onFrame); } };
}
