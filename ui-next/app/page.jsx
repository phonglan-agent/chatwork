import Link from "next/link";
import ThemeToggle from "./ThemeToggle";

// Literal class strings per accent (Tailwind JIT only sees static classes).
const ACCENT = {
  blue: { chip: "bg-blue/15 text-blue", dot: "bg-blue", hover: "hover:border-blue/60" },
  purple: { chip: "bg-purple/15 text-purple", dot: "bg-purple", hover: "hover:border-purple/60" },
};

const GROUPS = [
  {
    name: "REZIL",
    accent: "blue",
    tag: "rezil-esms · Fix-Bug / Feature / Release",
    cards: [
      { href: "/auto", icon: "⚙️", title: "Auto (Fix-Bug)", body: "Ticket REZIL-xxxx → fix tối thiểu → PR" },
      { href: "/investigate", icon: "🔍", title: "Điều tra ticket", body: "Ticket → nguyên nhân gốc (file:line) · DEV/SQA đánh giá · phương án khắc phục — chỉ đọc" },
      { href: "/feature", icon: "🏗️", title: "Feature", body: "BD + Figma → 16 phase → Scala/Svelte → PR" },
      { href: "/release", icon: "🚀", title: "Release", body: "Deploy DEV1 / PR / tag — agent github-ops" },
      { href: "/rebase", icon: "🔀", title: "Rebase / Merge", body: "Đo diverge → rebase hoặc merge develop vào nhánh, resolve conflict, build verify — agent git-rebaser" },
      { href: "/report", icon: "📊", title: "Report", body: "Chat báo cáo Jira — Claude dựng JQL, lấy data qua REST API, tự phân tích" },
      { href: "/sprint", icon: "📉", title: "Sprint giờ âm", body: "Upload Excel burndown → report Actual giờ âm (Chatwork)" },
      { href: "/kloc", icon: "📐", title: "KLOC", body: "Đọc PR merge 4 repo rezil → append LoC/KLoC vào Google Sheet KLoC-MVP2" },
      { href: "/translate", icon: "🈳", title: "Translate", body: "Đối chiếu Basic Design bản VN ↔ bản JP trên Google Sheet — dịch thiếu, sót tiếng Việt, nghi sai nghĩa" },
      { href: "/evidence", icon: "📸", title: "Evidence", body: "Chụp/gán evidence test case lên Google Sheet SQA — đối chiếu Drive, chụp web mobile, ghi cột Evidence" },
      { href: "/chat?project=rezil", icon: "💬", title: "Chat", body: "Hỏi/sửa code · gõ /usage xem giới hạn" },
    ],
  },
  {
    name: "Toàn năng",
    accent: "purple",
    tag: "Mọi project · không giới hạn",
    cards: [
      { href: "/chat?project=free", icon: "🛸", title: "Toàn năng", body: "Mọi project trong ~/IdeaProjects · full tool, không rào chắn" },
    ],
  },
];

function Card({ href, icon, title, body, accent }) {
  const a = ACCENT[accent];
  return (
    <Link
      href={href}
      className={`group relative flex items-start gap-4 rounded-2xl border border-line bg-panel p-5 no-underline transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/20 ${a.hover}`}
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl ${a.chip}`}>{icon}</div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-semibold text-ink">
          {title}
          <span className="text-muted opacity-0 transition-all duration-200 group-hover:translate-x-1 group-hover:opacity-100">→</span>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
      </div>
    </Link>
  );
}

export default function Home() {
  return (
    <main className="relative flex min-h-[100dvh] flex-col overflow-hidden">
      {/* glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-72 w-[42rem] max-w-[90vw] -translate-x-1/2 rounded-full bg-gradient-to-r from-blue to-purple opacity-20 blur-[110px]"
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-blue to-purple" />
          <span className="font-semibold text-ink">AI Agent</span>
        </div>
        <ThemeToggle />
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 pb-16">
        <h1 className="bg-gradient-to-r from-blue to-purple bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl">
          Giao việc cho Claude.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
          Đưa một ticket hoặc task — Claude tự implement đến tận khi mở PR, theo đúng convention.
          Không merge, không deploy. Chạy local.
        </p>

        <div className="mt-10 space-y-8">
          {GROUPS.map((g) => (
            <section key={g.name}>
              <div className="mb-3 flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${ACCENT[g.accent].dot}`} />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">{g.name}</h2>
                <span className="text-xs text-dim">· {g.tag}</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {g.cards.map((c) => <Card key={c.href} accent={g.accent} {...c} />)}
              </div>
            </section>
          ))}
        </div>
      </div>

      <footer className="relative z-10 border-t border-line px-6 py-4 text-center text-xs text-dim">
        Next.js · localhost:5000 · auto mode tạo PR thật — review trước khi merge.
      </footer>
    </main>
  );
}
