"use client";

import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ThemeToggle from "../ThemeToggle";
import BackToTop from "./BackToTop";
import { playDoneSound, playErrorSound } from "../../lib/notifySound";

// Markdown rendering for agent answers that emit GFM (tables, lists, links) — ON by default for
// every console; a console can opt OUT with config.renderMarkdown: false. Tables get a
// horizontal-scroll wrapper; links open in a new tab so Jira ticket links are clickable.
// See `.md` styles in globals.css.
const MD_COMPONENTS = {
  table: ({ node, ...props }) => <div className="md-tablewrap"><table {...props} /></div>,
  a: ({ node, ...props }) => <a target="_blank" rel="noreferrer" {...props} />,
  // Screenshots (e.g. /api/snapshot/*.png emitted by the snapshot helper): a small thumbnail inside
  // the bubble; clicking opens it full-size in an in-page lightbox (see the overlay in AgentConsole)
  // instead of a new tab. The click dispatches a window event the console listens for.
  img: ({ node, src, alt, ...props }) => (
    <img
      src={src}
      alt={alt || ""}
      loading="lazy"
      title="Bấm để phóng to"
      onClick={() => window.dispatchEvent(new CustomEvent("chat-lightbox", { detail: src }))}
      className="my-1 max-h-40 w-auto max-w-full cursor-zoom-in rounded-md border border-line"
      {...props}
    />
  ),
};
// memo: mỗi lần state của console đổi (delta mới, tick tiến trình...) React sẽ render lại cả danh
// sách message; không memo thì MỌI bong bóng cũ đều bị remark parse lại từ đầu → hội thoại dài là
// giật/treo. Text không đổi → bỏ qua hẳn.
const Markdown = memo(function Markdown({ text }) {
  return (
    <div className="md break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{text}</ReactMarkdown>
    </div>
  );
});

// Turn a raw tool/agent name (từ SSE event `tool`) thành nhãn tiếng Việt + icon dễ đọc cho panel
// Tiến trình. Ví dụ "Read" → 📖 Đọc file, "mcp__atlassian__getJiraIssue" → 📋 Jira, "↳ agent: dev-master".
function stepLabel(name) {
  let n = String(name || "");
  if (n.startsWith("↳ agent:")) return { icon: "🤖", text: n.replace(/^↳\s*agent:\s*/, "Agent: ") };
  let sub = false;
  if (n.startsWith("↳ ")) { sub = true; n = n.slice(2); }
  const pre = sub ? "↳ " : "";
  if (n === "phiên bắt đầu") return { icon: "🚀", text: "Phiên bắt đầu" };
  const rules = [
    [/^Read$/i, "📖", "Đọc file"],
    [/^(Grep|Glob)$/i, "🔍", "Tìm trong code"],
    [/^Bash$/i, "💻", "Chạy lệnh"],
    [/^(Edit|Write|MultiEdit)$/i, "✏️", "Sửa file"],
    [/^Web(Search|Fetch)$/i, "🌐", "Tra web"],
    [/^(TodoWrite|TaskCreate|TaskUpdate)$/i, "🧾", "Cập nhật todo"],
    [/^(Task|Agent)$/i, "🤖", "Gọi agent"],
    [/snapshot/i, "📸", "Chụp màn hình"],
    [/atlassian/i, "📋", "Jira"],
    [/(mysql|postgres)/i, "🗄️", "Query DB"],
    [/gsheets/i, "📊", "Google Sheet"],
  ];
  for (const [re, icon, text] of rules) if (re.test(n)) return { icon, text: pre + text };
  const mcp = n.match(/^mcp__[^_]+__(.+)$/);
  if (mcp) return { icon: "🔌", text: pre + mcp[1] };
  return { icon: "🔧", text: pre + n };
}

// Định dạng thời lượng gọn: <60s → "2.3s", ngược lại → "1m05s".
function fmtDur(ms) {
  if (ms == null || ms < 0) return "";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${String(s).padStart(2, "0")}s`;
}

// Panel "Tiến trình" trong bubble của agent: liệt kê từng bước (tool/agent) agent đã thực hiện.
// Tự bung khi đang chạy (live) để thấy hoạt động real-time; tự thu lại khi xong (gọn màn hình),
// vẫn bấm mở lại được để xem đã làm gì. Mỗi bước hiện thời lượng = khoảng cách tới bước kế tiếp
// (bước cuối: tới lúc kết thúc `endedAt`, hoặc chạy live theo đồng hồ khi đang stream).
function ProcessLog({ steps, live, endedAt }) {
  const [open, setOpen] = useState(live);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setOpen(live); }, [live]);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 200); // tick để bước cuối + tổng chạy real-time
    return () => clearInterval(id);
  }, [live]);
  if (!steps || steps.length === 0) return null;
  // Mốc kết thúc chung cho bước cuối + tổng thời gian: đang chạy → đồng hồ; xong → endedAt.
  const stopAll = live ? now : endedAt;
  const total = steps[0]?.t != null && stopAll != null ? stopAll - steps[0].t : null;
  return (
    <div className="mb-2 rounded-md border border-line bg-bg/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-dim transition-colors hover:text-muted"
      >
        <span className={live ? "animate-pulse" : ""}>{live ? "⚙️" : "✓"}</span>
        <span>{live ? "Đang thực hiện" : "Tiến trình"} · {steps.length} bước</span>
        {total != null ? <span className="tabular-nums">· {fmtDur(total)}</span> : null}
        <span className="ml-auto">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-0.5 border-t border-line px-2 py-1.5">
          {steps.map((s, i) => {
            const { icon, text } = stepLabel(s.name);
            const isLast = i === steps.length - 1;
            const liveLast = live && isLast;
            const stop = i < steps.length - 1 ? steps[i + 1].t : stopAll;
            const dur = s.t != null && stop != null ? stop - s.t : null;
            return (
              <div key={i} className={`flex items-center gap-1.5 ${liveLast ? "text-muted" : "text-dim"}`}>
                <span className="shrink-0">{icon}</span>
                <span className="min-w-0 flex-1 truncate">{text}</span>
                {liveLast ? <span className="animate-pulse">…</span> : null}
                {dur != null ? <span className="shrink-0 tabular-nums text-dim">{fmtDur(dur)}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// Full-screen image viewer with zoom + pan: mouse wheel / +− buttons / double-click to zoom, drag to
// pan when zoomed, pinch on touch. Click the dark backdrop (or Esc / ✕) to close; clicking the image
// itself does not close so it can be zoomed and dragged freely.
function Lightbox({ src, onClose }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const wrapRef = useRef(null);
  const pointers = useRef(new Map()); // pointerId -> {x,y} for pinch/pan tracking
  const pinchRef = useRef(null); // {dist, scale} at start of a 2-finger pinch
  const panRef = useRef(null); // {px,py, x,y} at start of a drag
  const MIN = 1;
  const MAX = 6;
  const clamp = (s) => Math.min(MAX, Math.max(MIN, s));
  const zoomBy = (f) => setScale((s) => clamp(s * f));
  const reset = () => { setScale(1); setPos({ x: 0, y: 0 }); };

  // Snap back to centre whenever we're fully zoomed out.
  useEffect(() => { if (scale <= 1) setPos({ x: 0, y: 0 }); }, [scale]);

  // Native wheel listener (passive:false) so we can preventDefault page scroll while zooming.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale };
      panRef.current = null;
    } else if (scale > 1) {
      panRef.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
    }
  }
  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setScale(clamp(pinchRef.current.scale * (dist / pinchRef.current.dist)));
    } else if (panRef.current) {
      setPos({ x: panRef.current.x + (e.clientX - panRef.current.px), y: panRef.current.y + (e.clientY - panRef.current.py) });
    }
  }
  function onPointerUp(e) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) panRef.current = null;
  }

  const btn = "flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-lg leading-none text-white transition-colors hover:bg-black/80";

  return (
    <div
      ref={wrapRef}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/80 p-4"
    >
      <img
        src={src}
        alt=""
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => { e.stopPropagation(); scale > 1 ? reset() : setScale(2.5); }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          touchAction: "none",
          cursor: scale > 1 ? "grab" : "zoom-in",
        }}
        className="max-h-full max-w-full select-none rounded-md shadow-2xl"
      />
      <div onClick={(e) => e.stopPropagation()} className="absolute right-4 top-4 flex items-center gap-2">
        <button type="button" onClick={() => zoomBy(1 / 1.4)} title="Thu nhỏ" aria-label="Thu nhỏ" className={btn}>−</button>
        <span className="min-w-[3.5ch] select-none text-center text-sm text-white/90">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.4)} title="Phóng to" aria-label="Phóng to" className={btn}>+</button>
        <button type="button" onClick={reset} title="Vừa màn hình" aria-label="Vừa màn hình" className={`${btn} w-auto px-3 text-sm`}>Vừa</button>
        <button type="button" onClick={onClose} title="Đóng" aria-label="Đóng" className={btn}>✕</button>
      </div>
    </div>
  );
}

// config.sessionsPath và config.reconnect là HAI thứ khác nhau, đừng gộp:
//   - sessionsPath: bật panel "Phiên đã lưu" (liệt kê / mở lại / xoá phiên .jsonl). Console nào cũng
//     dùng được — chỉ cần đọc file, không đòi hỏi gì ở route.
//   - reconnect: khi rớt stream thì poll /api/chat/active rồi lấy đáp án từ .jsonl. CHỈ đúng với
//     console mà route chạy killOnDisconnect:false + đăng ký runId vào job-lock (/api/chat, /api/evidence, /api/release).
//     Bật cho console khác sẽ báo "đã khôi phục" trong khi run thật ra đã bị kill lúc socket đứt.
// Shared multi-turn console for every agent UI. Two modes via config.mode:
//   - "chat" (default): free text input (+ optional ✏️ Sửa code toggle), session resume — /chat, /release.
//   - "job": page supplies a composer (ticket/repo/task fields) + getSubmission(); one-shot run with
//     result/NEED-INFO handling + per-repo cancel — /auto, /feature.
// Streaming, message list, status, persistence and the header are shared across both.

// basePath when served behind the reverse proxy (e.g. "/ai"). Next prefixes Link/assets/API routes
// automatically, but NOT raw fetch()/EventSource — so we prefix those manually. Baked at build.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

// Help text for the client-side slash commands (shown by /help). Plain text — chat consoles render
// answers as pre-wrapped text unless config.renderMarkdown.
const SLASH_HELP =
  "Lệnh nhanh:\n" +
  "  /usage, /cost  — xem giới hạn token (phiên 5h + tuần)\n" +
  "  /context       — token context phiên hiện tại đang chiếm\n" +
  "  /clear, /new   — xoá hội thoại, bắt đầu phiên mới\n" +
  "  /help          — hiện danh sách lệnh này";

const ACCENT = {
  blue: {
    dot: "bg-blue", text: "text-blue", focus: "focus-within:border-blue", btn: "bg-blue",
    me: "bg-mebubble", check: "accent-blue", hover: "hover:border-blue/60", chip: "bg-blue/15 text-blue", ring: "border-blue",
  },
  purple: {
    dot: "bg-purple", text: "text-purple", focus: "focus-within:border-purple", btn: "bg-purple",
    me: "bg-mebubblestory", check: "accent-purple", hover: "hover:border-purple/60", chip: "bg-purple/15 text-purple", ring: "border-purple",
  },
  green: {
    dot: "bg-green", text: "text-green", focus: "focus-within:border-green", btn: "bg-green",
    me: "bg-mebubble", check: "accent-green", hover: "hover:border-green/60", chip: "bg-green/15 text-green", ring: "border-green",
  },
};

// Thời gian tương đối gọn cho danh sách phiên (vd "5 phút trước", "3 ngày trước").
function relTime(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return new Date(ms).toLocaleDateString("vi-VN");
}

// Field styles for job composers, so every page's inputs look identical.
export const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted";
export const FIELD_BASE = "w-full rounded-lg border border-fieldline bg-field px-3 text-ink outline-none transition-colors";

// Trần chiều cao của ô nhập chat (textarea auto-grow): ~6 dòng ở line-height 20px, quá thì cuộn
// trong ô thay vì đẩy khung chat lên — giữ chỗ cho nội dung hội thoại trên màn hình nhỏ.
const INPUT_MAX_PX = 120;

// Chống giật khi câu trả lời dài: server emit `delta` theo từng token (hàng trăm event/giây), nếu
// setState ngay mỗi event thì React render lại + remark parse lại TOÀN BỘ text ở mỗi token → chi phí
// bậc hai theo độ dài. Gom delta vào buffer, flush theo nhịp DELTA_FLUSH_MS.
const DELTA_FLUSH_MS = 120;
// Trong lúc còn stream, message dài quá ngưỡng này được render dạng text thuần (rẻ); parse Markdown
// một lần khi stream kết thúc.
const STREAM_PLAIN_CHARS = 20000;

export default function AgentConsole({ config }) {
  const isJob = config.mode === "job";
  const a = ACCENT[config.accent] || ACCENT.blue;
  const [messages, setMessages] = useState([]); // {role:'me'|'ai', text, status, errors:[]}
  const [input, setInput] = useState("");
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suggests, setSuggests] = useState([]); // follow-up chips for the latest answer (chat-mode)
  const [attachments, setAttachments] = useState([]); // uploaded images {name, path} for next turn
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null); // src of the image shown full-size in the overlay
  // Panel "Phiên đã lưu" (chat-mode, khi config.sessionsPath có): liệt kê + mở lại phiên .jsonl cũ.
  const [showSessions, setShowSessions] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  // Job-mode resume (config.resumable): after a ⛔ NEED-INFO stop, show an answer box and --resume
  // the same session instead of re-running the ticket from scratch.
  const [needInfoActive, setNeedInfoActive] = useState(false);
  const [answer, setAnswer] = useState("");
  const lastJobRef = useRef(null); // last submitted job {display, params, cancelKey} — reused on resume
  const sessionRef = useRef("");
  const esRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null); // textarea composer — auto-grow (xem growInput)
  const logRef = useRef(null);
  const messagesRef = useRef([]);
  const needInfoRef = useRef(false);
  const accRef = useRef("");
  const deltaBufRef = useRef(""); // text delta chưa flush vào state (xem DELTA_FLUSH_MS)
  const flushTimerRef = useRef(null);
  const cancelKeyRef = useRef(""); // chat: = runId (job-lock key); job: = repo cancel key
  const reconnectingRef = useRef(false); // chat: đang poll khôi phục sau khi mất kết nối
  // Completion-sound bookkeeping per turn: error seen? user-aborted? already chimed?
  const sawErrorRef = useRef(false);
  const abortedRef = useRef(false);
  const soundedRef = useRef(false);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Lightbox: open on the `chat-lightbox` event dispatched by a rendered <img>; close on Esc.
  useEffect(() => {
    const open = (e) => setLightbox(e.detail);
    const onKey = (e) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("chat-lightbox", open);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("chat-lightbox", open);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Lưới an toàn cho trường hợp tab bị FREEZE (Page Lifecycle) khiến es.onerror không kịp chạy: khi
  // quay lại mà đang busy nhưng stream đã chết → kích hoạt khôi phục. (Ẩn tab ngắn, socket còn sống
  // thì es vẫn OPEN → bỏ qua, các delta buffered tự flush bình thường.)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (!busy || isJob || !config.reconnect || reconnectingRef.current || abortedRef.current) return;
      const es = esRef.current;
      if (!es || es.readyState === 2) reconnectAndReload();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // restore saved conversation on mount / when the storage key changes (e.g. project or repo switch)
  useEffect(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    deltaBufRef.current = "";
    setBusy(false);
    let saved = null;
    try {
      const raw = localStorage.getItem(config.storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch {}
    sessionRef.current = saved?.session || "";
    setMessages(Array.isArray(saved?.messages) ? saved.messages : []);
    setSuggests([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.storageKey]);

  // persist when a stream finishes
  useEffect(() => {
    if (busy) return;
    try {
      if (messagesRef.current.length) {
        localStorage.setItem(
          config.storageKey,
          JSON.stringify({ messages: messagesRef.current, session: sessionRef.current })
        );
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // Auto-cuộn CHỈ khi người dùng đang ở gần cuối: câu trả lời dài mà ép scrollTop mỗi lần cập nhật
  // vừa tốn một lượt reflow, vừa kéo màn hình khi họ đang cuộn lên đọc lại.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function patchLast(fn) {
    setMessages((prev) => {
      if (!prev.length) return prev;
      const next = prev.slice();
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });
  }

  // Gom delta rồi flush theo nhịp — xem DELTA_FLUSH_MS. Mọi nhánh kết thúc/ngắt stream phải gọi
  // flushDelta() trước để không mất phần text còn trong buffer.
  function flushDelta() {
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    const buf = deltaBufRef.current;
    if (!buf) return;
    deltaBufRef.current = "";
    patchLast((m) => ({ ...m, text: m.text + buf, status: "" }));
  }

  function pushDelta(t) {
    deltaBufRef.current += t;
    if (!flushTimerRef.current) flushTimerRef.current = setTimeout(flushDelta, DELTA_FLUSH_MS);
  }

  // Reset chỉ phía client: đóng stream, quên session, xoá localStorage + state hiển thị.
  function resetLocal() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    deltaBufRef.current = "";
    sessionRef.current = "";
    lastJobRef.current = null;
    setMessages([]);
    setSuggests([]);
    setNeedInfoActive(false);
    setAnswer("");
    setBusy(false);
    try { localStorage.removeItem(config.storageKey); } catch {}
  }

  // "Xóa hội thoại": reset local, và khi console có sessionsPath thì XOÁ LUÔN file phiên phía server
  // (trước đây chỉ xoá localStorage nên phiên vẫn còn trong "Phiên đã lưu"). deleteServer=false = chỉ
  // bắt đầu phiên mới, GIỮ phiên cũ (dùng cho "＋ Phiên mới" / lệnh /new).
  function clearChat(deleteServer = false) {
    const id = sessionRef.current;
    resetLocal();
    if (deleteServer && id && config.sessionsPath) {
      fetch(BASE + config.sessionsPath + "/" + id + "?" + sessionsQuery(), { method: "DELETE" }).catch(() => {});
    }
  }

  // ── Phiên đã lưu (config.sessionsPath) ─────────────────────────────────────
  // API cần biết project để đọc đúng thư mục .jsonl (mỗi project có cwd riêng).
  function sessionsQuery() {
    return new URLSearchParams(config.params || {}).toString();
  }

  async function openSessions() {
    if (!config.sessionsPath) return;
    setShowSessions(true);
    setLoadingSessions(true);
    try {
      const res = await fetch(BASE + config.sessionsPath + "?" + sessionsQuery());
      const data = await res.json().catch(() => ({}));
      setSessions(res.ok ? data.sessions || [] : []);
    } catch {
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }

  // Mở lại 1 phiên cũ: dựng lại hội thoại + set session_id để lượt sau --resume nối tiếp context.
  async function loadSession(id) {
    if (!config.sessionsPath || busy) return;
    setShowSessions(false);
    try {
      const res = await fetch(BASE + config.sessionsPath + "/" + id + "?" + sessionsQuery());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessages((prev) => [...prev, { role: "ai", text: "", status: "✗ không tải được phiên", errors: [data.error || ""] }]);
        return;
      }
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      sessionRef.current = id;
      setMessages(msgs);
      // Chip gợi ý của lượt cuối đọc lại từ .jsonl — event `suggest` chỉ có trong stream đang chạy.
      setSuggests(Array.isArray(data.suggests) ? data.suggests : []);
      try { localStorage.setItem(config.storageKey, JSON.stringify({ messages: msgs, session: id })); } catch {}
    } catch {
      /* mạng lỗi — bỏ qua, người dùng bấm lại */
    }
  }

  async function deleteSession(id, e) {
    e?.stopPropagation();
    if (!config.sessionsPath) return;
    if (!confirm("Xoá vĩnh viễn phiên này? Không thể hoàn tác.")) return;
    try {
      const res = await fetch(BASE + config.sessionsPath + "/" + id + "?" + sessionsQuery(), { method: "DELETE" });
      if (!res.ok) return;
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
      if (sessionRef.current === id) resetLocal(); // đã xoá file server ở trên → chỉ cần reset local
    } catch {
      /* bỏ qua */
    }
  }

  // Client-side slash commands — handled in the browser, no server round-trip / no claude spawn.
  // (/usage and /cost are server-side — see lib/slashCommands.js — so they fall through to the API.)
  function handleClientSlash(typed) {
    const cmd = typed.toLowerCase();
    if (cmd === "/clear") { clearChat(true); return true; }  // xoá hẳn phiên hiện tại
    if (cmd === "/new") { clearChat(false); return true; }   // giữ phiên cũ, bắt đầu phiên mới
    if (cmd === "/help") {
      setMessages((prev) => [
        ...prev,
        { role: "me", text: typed },
        { role: "ai", text: SLASH_HELP, status: "", errors: [] },
      ]);
      return true;
    }
    return false;
  }

  function stopStream() {
    flushDelta();
    if (cancelKeyRef.current) {
      fetch(BASE + "/api/cancel?repo=" + encodeURIComponent(cancelKeyRef.current), { method: "POST" }).catch(() => {});
    }
    abortedRef.current = true; // user stopped → no completion chime
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    patchLast((m) => (m.role === "ai" ? { ...m, status: "⏹ đã dừng", endedAt: Date.now() } : m));
    setBusy(false);
  }

  // Chime once when a turn ends — "done" normally, "error" on failure; silent if the user aborted.
  function finalizeSound() {
    if (soundedRef.current || abortedRef.current) return;
    soundedRef.current = true;
    if (sawErrorRef.current) playErrorSound();
    else playDoneSound();
  }

  // Chat: mất kết nối giữa chừng (ẩn/minimize tab → browser drop socket). Run VẪN chạy tiếp ở server
  // (killOnDisconnect:false) và ghi vào session .jsonl. Ở đây poll /api/chat/active tới khi run xong,
  // rồi ĐIỀN NỐT text đáp án vào bong bóng cuối — GIỮ NGUYÊN m.steps + endedAt nên log tiến trình +
  // thời gian KHÔNG mất. Chỉ áp dụng chat-mode (job có cơ chế resume riêng).
  async function reconnectAndReload() {
    if (reconnectingRef.current || abortedRef.current || isJob || !config.reconnect) return;
    reconnectingRef.current = true;
    flushDelta();
    const rid = cancelKeyRef.current; // chat: cancelKey = runId
    const sid = sessionRef.current;
    patchLast((m) => (m.role === "ai" ? { ...m, status: "↻ mất kết nối — đang khôi phục…" } : m));
    let miss = 0; // số vòng chưa hỏi được trạng thái (mạng chưa lên lại) — chờ thêm, đừng bỏ cuộc sớm
    for (let i = 0; i < 900 && !abortedRef.current; i++) { // cap ~30' @ 2s/vòng
      let active = null; // null = chưa xác định (fetch lỗi vì còn offline)
      if (rid) {
        try {
          const r = await fetch(BASE + "/api/chat/active?runId=" + encodeURIComponent(rid));
          const d = await r.json();
          active = !!d.running;
        } catch { active = null; }
      } else {
        active = false;
      }
      if (active === false) break; // server xác nhận run đã xong
      if (active === null && ++miss > 30) break; // mạng chết ~60s liên tục → thôi, dùng nội dung hiện có
      if (active === true) miss = 0;
      await new Promise((res) => setTimeout(res, 2000));
    }
    if (sid && !abortedRef.current) {
      try {
        const res = await fetch(BASE + config.sessionsPath + "/" + sid + "?" + sessionsQuery());
        const data = await res.json().catch(() => ({}));
        const msgs = Array.isArray(data.messages) ? data.messages : [];
        const lastAi = [...msgs].reverse().find((m) => m.role === "ai");
        // Rớt kết nối giữa lượt → chip gợi ý của lượt đó không bao giờ tới qua SSE; lấy lại từ
        // phiên đã lưu, không thì sau mỗi lần khôi phục là mất hẳn khối gợi ý.
        if (Array.isArray(data.suggests) && data.suggests.length) setSuggests(data.suggests);
        patchLast((m) =>
          m.role === "ai"
            ? { ...m, text: lastAi ? lastAi.text : m.text, status: "", endedAt: m.endedAt || Date.now() }
            : m
        );
      } catch {
        patchLast((m) => (m.role === "ai" ? { ...m, status: "", endedAt: m.endedAt || Date.now() } : m));
      }
    }
    reconnectingRef.current = false;
    setBusy(false); // persist effect lưu lại messages (đã có text + steps) vào localStorage
    finalizeSound();
  }

  function watchNeedInfo(t) {
    if (needInfoRef.current) return;
    accRef.current += t;
    if (accRef.current.includes("NEED-INFO")) {
      needInfoRef.current = true;
      // Resumable job (auto): offer an answer box instead of asking the user to stop.
      const canResume = isJob && config.resumable;
      patchLast((m) => ({ ...m, status: canResume ? "⛔ Thiếu thông tin — trả lời bên dưới để chạy tiếp" : "⛔ Thiếu thông tin — bấm Dừng" }));
      if (canResume) setNeedInfoActive(true);
    }
  }

  // Open the stream for one turn/run. `url` is the full /api path with query string.
  function start(display, url, cancelKey) {
    needInfoRef.current = false;
    setNeedInfoActive(false);
    accRef.current = "";
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    deltaBufRef.current = "";
    cancelKeyRef.current = cancelKey || "";
    sawErrorRef.current = false;
    abortedRef.current = false;
    soundedRef.current = false;
    reconnectingRef.current = false;
    setSuggests([]);
    setMessages((prev) => [
      ...prev,
      { role: "me", text: display },
      { role: "ai", text: "", status: "…", errors: [], steps: [] },
    ]);
    setBusy(true);

    const es = new EventSource(BASE + url);
    esRef.current = es;

    es.addEventListener("session", (ev) => { sessionRef.current = JSON.parse(ev.data); });
    es.addEventListener("delta", (ev) => {
      const t = JSON.parse(ev.data);
      pushDelta(t);
      watchNeedInfo(t);
    });
    es.addEventListener("tool", (ev) => {
      const name = JSON.parse(ev.data);
      // Tích luỹ từng bước vào m.steps để render panel "Tiến trình" (lịch sử đầy đủ, không bị delta
      // kế tiếp xoá mất). Bỏ qua bước trùng liên tiếp. Xoá placeholder "…" ban đầu — ProcessLog lo
      // phần hiển thị hoạt động real-time từ đây.
      patchLast((m) => {
        const steps = (m.steps || []).slice();
        if (steps[steps.length - 1]?.name !== name) steps.push({ name, t: Date.now() });
        return { ...m, steps, status: m.status === "…" ? "" : m.status };
      });
    });
    es.addEventListener("result", (ev) => {
      const r = JSON.parse(ev.data);
      if (needInfoRef.current) return;
      const err = r.isError || (r.exitCode !== undefined && r.exitCode !== 0);
      if (err) { sawErrorRef.current = true; patchLast((m) => ({ ...m, status: "✗ lỗi" })); }
    });
    es.addEventListener("error_msg", (ev) => {
      const msg = JSON.parse(ev.data);
      patchLast((m) => ({ ...m, errors: [...(m.errors || []), msg] }));
    });
    // Server đã chạy lại lượt này bằng account khác (xem retry trong lib/claude.js): bỏ phần text
    // lượt hỏng đã stream ra — thường là chính câu báo hết hạn mức của CLI, không kết thúc bằng
    // newline nên đáp án mới bị nối đuôi vào đó và mất format Markdown (bảng dính 1 dòng).
    es.addEventListener("reset_text", () => {
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      deltaBufRef.current = "";
      accRef.current = "";
      needInfoRef.current = false;
      patchLast((m) => (m.role === "ai" ? { ...m, text: "" } : m));
    });
    es.addEventListener("suggest", (ev) => {
      try { const arr = JSON.parse(ev.data); if (Array.isArray(arr)) setSuggests(arr); } catch {}
    });
    es.addEventListener("end", () => { flushDelta(); setBusy(false); es.close(); esRef.current = null; finalizeSound(); patchLast((m) => (m.role === "ai" ? { ...m, endedAt: Date.now() } : m)); });
    es.onerror = () => {
      if (!esRef.current) return; // đã đóng bởi end/stopStream → bỏ qua
      flushDelta();
      esRef.current.close();
      esRef.current = null;
      // Chat: đừng đóng băng message. Run vẫn sống ở server → poll khôi phục rồi điền nốt đáp án
      // (giữ log tiến trình). Job giữ hành vi cũ (báo lỗi, dừng).
      if (!isJob && config.reconnect && !abortedRef.current) { reconnectAndReload(); return; }
      setBusy(false);
      sawErrorRef.current = true;
      finalizeSound();
      patchLast((m) => (m.role === "ai" ? { ...m, endedAt: Date.now() } : m));
    };
  }

  // Accepted attachment kinds: images, Excel. Anything else is dropped client-side so the user
  // gets the picker filter + a clean send.
  const isUploadable = (f) =>
    f.type.startsWith("image/") ||
    /\.(xlsx?|xlsm|xlsb)$/i.test(f.name || "") ||
    f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    f.type === "application/vnd.ms-excel";

  // Upload picked/pasted files → server saves them in the agent cwd, returns a path the agent can
  // Read. We hold the paths until the next send, then append them to the message.
  async function uploadFiles(files) {
    const list = Array.from(files || []).filter(isUploadable);
    if (!config.uploadPath || list.length === 0 || uploading) return;
    setUploading(true);
    try {
      const qs = new URLSearchParams(config.params || {});
      for (const file of list) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(BASE + config.uploadPath + "?" + qs.toString(), { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          patchLast((m) => (m.role === "ai" ? { ...m, errors: [...(m.errors || []), data.error || `Tải "${file.name}" thất bại`] } : m));
          continue;
        }
        setAttachments((prev) => [...prev, { name: data.name, path: data.path }]);
      }
    } catch (e) {
      // surfaced inline below the composer is overkill; ignore silently and let the user retry
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAttachment(path) {
    setAttachments((prev) => prev.filter((x) => x.path !== path));
  }

  // Composer là <textarea> auto-grow: cao 1 dòng khi rỗng, nở dần theo nội dung tới INPUT_MAX_PX rồi
  // mới cuộn trong ô. Phải reset height về "auto" trước khi đo scrollHeight, nếu không ô chỉ nở ra
  // chứ không bao giờ co lại. Chạy sau mỗi lần `input` đổi (gõ, dán, chèn ví dụ, xoá sau khi gửi).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, INPUT_MAX_PX) + "px";
  }, [input]);

  // Enter = gửi, Shift+Enter = xuống dòng. Bỏ qua khi IME đang compose (gõ tiếng Việt/Nhật bằng bộ gõ
  // của trình duyệt) — Enter lúc đó là chốt từ, không phải gửi.
  function onComposerKeyDown(e) {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submitChat();
  }

  function onPaste(e) {
    const files = Array.from(e.clipboardData?.files || []).filter(isUploadable);
    if (files.length && config.uploadPath) { e.preventDefault(); uploadFiles(files); }
  }

  function submitChat(text) {
    const typed = (text ?? input).trim();
    if ((!typed && attachments.length === 0) || busy || uploading) return;
    if (attachments.length === 0 && handleClientSlash(typed)) { setInput(""); return; }
    // Append uploaded file paths so the agent reads them via the Read tool. (Excel is already
    // converted to a multi-sheet Markdown file on the server, so the path points to that .md.)
    let q = typed;
    if (attachments.length > 0) {
      const lines = attachments.map((x) => `- ${x.path} (${x.name})`).join("\n");
      q = `${typed}\n\nTệp đính kèm (đọc bằng tool Read):\n${lines}`.trim();
    }
    const display = attachments.length > 0 ? `${typed} 📎${attachments.length}`.trim() : typed;
    // runId: định danh lượt chạy → server đăng ký job-lock để (1) nút Dừng huỷ được kể cả sau khi
    // socket drop, (2) client hỏi /api/chat/active xem run còn sống không khi khôi phục.
    const runId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const qs = new URLSearchParams({ msg: q, runId, ...(config.params || {}) });
    if (sessionRef.current) qs.set("session", sessionRef.current);
    if (config.editToggle && edit) qs.set("edit", "1");
    setInput("");
    setAttachments([]);
    start(display, config.apiPath + "?" + qs.toString(), runId); // cancelKey = runId
  }

  function submitJob() {
    if (busy) return;
    const sub = config.getSubmission?.();
    if (!sub) return;
    lastJobRef.current = sub; // remember for a possible NEED-INFO resume
    const qs = new URLSearchParams(sub.params);
    start(sub.display, config.apiPath + "?" + qs.toString(), sub.cancelKey || "");
  }

  // Missing-info items parsed from the latest ⛔ NEED-INFO block (each on its own `- ` line) —
  // rendered as chips that append to the answer box (no auto-run, so the user can edit/combine).
  const needInfoItems =
    isJob && config.resumable && needInfoActive
      ? (() => {
          const lastAi = [...messages].reverse().find((m) => m.role === "ai");
          const text = lastAi?.text || "";
          const idx = text.indexOf("NEED-INFO");
          if (idx < 0) return [];
          return text
            .slice(idx)
            .split("\n")
            .map((l) => l.trim().match(/^(?:[-*•]|\d+[.)])\s+(.+)$/))
            .map((mm) => (mm ? mm[1].trim() : null))
            .filter(Boolean)
            .slice(0, 6);
        })()
      : [];

  function addAnswerItem(item) {
    setAnswer((prev) => (prev.trim() ? prev.trim() + "; " + item : item));
  }

  // Resume a NEED-INFO'd job: send the user's answer as the next turn's `msg` + the captured
  // session id, so the backend --resumes the same run instead of restarting the ticket.
  function submitJobAnswer() {
    const text = answer.trim();
    const sub = lastJobRef.current;
    if (!text || busy || !sub || !sessionRef.current) return;
    const qs = new URLSearchParams({ ...sub.params, msg: text, session: sessionRef.current });
    setAnswer("");
    start("↳ " + text, config.apiPath + "?" + qs.toString(), sub.cancelKey || "");
  }

  function send(e) {
    e.preventDefault();
    if (isJob) submitJob();
    else submitChat();
  }

  const nav = config.nav || [{ href: "/auto", label: "⚙️ Auto" }, { href: "/", label: "⌂ Home" }];

  return (
    <div className="relative flex h-[100dvh] flex-col">
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      <BackToTop targetRef={logRef} btnClass={a.btn} />
      <header className="flex items-center gap-2.5 border-b border-line bg-panel px-5 py-3">
        <span className={`h-2 w-2 shrink-0 rounded-full ${a.dot}`} />
        <b className={`font-bold ${a.text}`}>{config.icon} {config.title}</b>
        <span className="flex items-center gap-1.5 max-sm:hidden" title={config.badge}>
          {config.badge ? (
            <>
              <span className="text-muted">·</span>
              <small className="text-muted">{config.badge}</small>
            </>
          ) : null}
          <span className="text-muted">·</span>
          <span className={`h-2 w-2 rounded-full ${busy ? `${a.dot} animate-pulse` : "bg-green"}`} />
          <small className="text-muted">{busy ? "Streaming…" : "Ready"}</small>
        </span>
        {messages.length ? (
          <small className="text-muted max-sm:hidden">· {messages.length} msg</small>
        ) : null}
        <span className="ml-auto flex items-center gap-3.5">
          {!isJob && config.sessionsPath ? (
            <button
              type="button"
              onClick={openSessions}
              disabled={busy}
              title="Phiên đã lưu"
              className="text-muted hover:text-ink disabled:opacity-40"
            >
              🕘 Phiên
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => clearChat(true)}
            disabled={busy || !messages.length}
            title={config.sessionsPath ? "Xóa hội thoại (xoá luôn phiên đã lưu)" : "Xóa hội thoại"}
            className="text-muted hover:text-ink disabled:opacity-40"
          >
            🗑 Xóa
          </button>
          {nav.map((n) => (
            <a key={n.href} href={BASE + n.href} className="text-blue hover:underline">{n.label}</a>
          ))}
          <ThemeToggle />
        </span>
      </header>

      {/* Panel danh sách phiên đã lưu — overlay phủ vùng nội dung */}
      {showSessions ? (
        <div className="absolute inset-0 z-20 flex flex-col bg-bg/95 backdrop-blur">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3">
            <b className={`font-bold ${a.text}`}>🕘 Phiên đã lưu</b>
            <div className="flex items-center gap-3.5">
              <button
                type="button"
                onClick={() => { clearChat(false); setShowSessions(false); }}
                className="text-muted hover:text-ink"
              >
                ＋ Phiên mới
              </button>
              <button type="button" onClick={() => setShowSessions(false)} title="Đóng" aria-label="Đóng" className="text-muted hover:text-ink">
                ✕
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4">
            {loadingSessions ? <p className="py-8 text-center text-sm text-muted">Đang tải…</p> : null}
            {!loadingSessions && sessions && sessions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">Chưa có phiên nào.</p>
            ) : null}
            {!loadingSessions && sessions
              ? sessions.map((s) => {
                  const active = s.id === sessionRef.current;
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-2 rounded-xl border bg-panel pr-2 transition-colors ${active ? a.ring : "border-line"} ${a.hover}`}
                    >
                      <button
                        type="button"
                        onClick={() => loadSession(s.id)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left"
                      >
                        <span className="shrink-0">{active ? "✅" : "💬"}</span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-[13px] font-medium text-ink">{s.title}</span>
                          <span className="text-xs text-dim">{relTime(s.mtime)} · {s.turns} lượt</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => deleteSession(s.id, e)}
                        title="Xoá phiên"
                        aria-label="Xoá phiên"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:text-err"
                      >
                        🗑
                      </button>
                    </div>
                  );
                })
              : null}
          </div>
        </div>
      ) : null}

      <div ref={logRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        {messages.length === 0 ? (
          <div className="m-auto flex max-w-lg flex-col items-center gap-4 text-center">
            <div className="text-4xl">{config.icon}</div>
            <p className="text-sm text-muted">{config.emptyText}</p>
            {!isJob && (config.examples || []).length ? (
              <div className="flex flex-col gap-2 self-stretch">
                {config.examples.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => submitChat(ex)}
                    className={`rounded-lg border border-line bg-panel px-3 py-2 text-left text-[13px] text-muted transition-colors hover:text-ink ${a.hover}`}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          messages.map((m, i) => {
            if (m.role === "me") {
              return (
                <div
                  key={i}
                  className={`max-w-[80%] self-end whitespace-pre-wrap break-words rounded-lg px-3 py-2.5 text-[13px] leading-normal text-mebubbleink ${a.me}`}
                >
                  {m.text}
                </div>
              );
            }
            const live = busy && i === messages.length - 1;
            // Đang stream mà text đã rất dài → render text thuần cho tới khi xong (xem STREAM_PLAIN_CHARS).
            const plain = config.renderMarkdown === false || (live && (m.text || "").length > STREAM_PLAIN_CHARS);
            return (
              <div
                key={i}
                className={`w-full self-stretch break-words rounded-lg border border-line bg-panel px-3 py-2.5 text-[13px] leading-normal ${plain ? "whitespace-pre-wrap" : ""}`}
              >
                <ProcessLog steps={m.steps} live={live} endedAt={m.endedAt} />
                {m.status ? <div className="text-xs text-dim">{m.status}</div> : null}
                {m.text ? (plain ? m.text : <Markdown text={m.text} />) : null}
                {(m.errors || []).map((er, j) => (
                  <div key={j} className="text-xs text-err">⚠ {er}</div>
                ))}
              </div>
            );
          })
        )}
      </div>

      {!isJob && suggests.length > 0 && !busy ? (
        <div className="flex flex-wrap gap-2 border-t border-line bg-bg px-4 pt-3">
          {suggests.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => submitChat(s)}
              className={`rounded-full border border-line bg-panel px-3 py-1.5 text-left text-[12px] text-muted transition-colors hover:text-ink ${a.hover}`}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <form onSubmit={send} className="border-t border-line bg-bg px-4 py-3">
        {isJob ? (
          <div className="flex flex-col gap-2">
            {typeof config.composer === "function" ? config.composer({ busy, a }) : config.composer}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-lg font-semibold text-field transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${a.btn}`}
              >
                {busy ? "Đang chạy…" : "▶ Run"}
              </button>
              <button
                type="button"
                onClick={stopStream}
                disabled={!busy}
                className="h-10 rounded-lg border border-fieldline px-4 text-ink transition-colors hover:border-err hover:text-err disabled:cursor-not-allowed disabled:opacity-40"
              >
                Dừng
              </button>
            </div>
            {config.resumable && needInfoActive && !busy && sessionRef.current ? (
              <div className="flex flex-col gap-2 rounded-lg border border-warnink/40 bg-warnbg p-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-warnink">
                  ⛔ Trả lời để chạy tiếp (giữ nguyên session)
                </span>
                {needInfoItems.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {needInfoItems.map((it, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => addAnswerItem(it)}
                        title="Bấm để thêm vào ô trả lời"
                        className="max-w-full truncate rounded-full border border-warnink/40 bg-panel px-2.5 py-1 text-left text-[12px] text-warnink transition-colors hover:opacity-80"
                      >
                        + {it}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitJobAnswer(); } }}
                    placeholder="Cung cấp thông tin còn thiếu…"
                    autoFocus
                    className={`${FIELD_BASE} h-10 flex-1 focus:border-blue`}
                  />
                  <button
                    type="button"
                    onClick={submitJobAnswer}
                    disabled={!answer.trim()}
                    className={`h-10 shrink-0 rounded-lg px-4 font-semibold text-field transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${a.btn}`}
                  >
                    ▶ Chạy tiếp
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
          {config.uploadPath && attachments.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {attachments.map((x) => (
                <span key={x.path} className={`flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[12px] ${a.chip}`}>
                  📎 <span className="max-w-[12rem] truncate">{x.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(x.path)}
                    aria-label="Bỏ ảnh"
                    className="ml-0.5 text-muted hover:text-ink"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className={`flex items-end gap-2 rounded-xl border border-fieldline bg-field px-2 py-1.5 transition-colors ${a.focus}`}>
            {config.uploadPath ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.xlsx,.xls,.xlsm,.xlsb"
                  multiple
                  className="hidden"
                  onChange={(e) => uploadFiles(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy || uploading}
                  title="Đính kèm tệp (ảnh / Excel)"
                  aria-label="Đính kèm tệp"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploading ? "⏳" : "📎"}
                </button>
              </>
            ) : null}
            {config.editToggle ? (
              <label
                title="Cho phép Claude sửa file / chạy lệnh (không merge/deploy/force-push)"
                className={`flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] transition-colors ${
                  edit ? a.chip : "text-muted hover:text-ink"
                }`}
              >
                <input
                  type="checkbox"
                  checked={edit}
                  onChange={(e) => setEdit(e.target.checked)}
                  disabled={busy}
                  className={`h-3.5 w-3.5 ${a.check} disabled:cursor-not-allowed disabled:opacity-50`}
                />
                <span className="max-sm:hidden">✏️ Sửa code</span>
                <span className="sm:hidden">✏️</span>
              </label>
            ) : null}
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKeyDown}
              onPaste={config.uploadPath ? onPaste : undefined}
              placeholder={busy ? "Đang chạy… nhấn ⏹ để dừng" : config.placeholder}
              disabled={busy}
              autoFocus
              autoComplete="off"
              className="min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-ink leading-5 outline-none placeholder:text-dim disabled:cursor-not-allowed disabled:opacity-60"
            />
            {busy ? (
              <button
                type="button"
                onClick={stopStream}
                aria-label="Dừng"
                title="Dừng"
                className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-err text-field transition-opacity hover:opacity-90"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() && attachments.length === 0}
                aria-label="Gửi"
                title="Gửi"
                className={`ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-field transition-opacity disabled:opacity-40 ${a.btn}`}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5" />
                  <path d="M5 12l7-7 7 7" />
                </svg>
              </button>
            )}
          </div>
          </div>
        )}
      </form>
    </div>
  );
}
