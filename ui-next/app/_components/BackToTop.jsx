"use client";

import { useEffect, useState } from "react";

// Cặp nút "lên đầu trang" / "xuống cuối trang" — xếp dọc ở giữa cạnh phải, hợp cho hội thoại dài.
// Nút ↑ hiện khi đã cuộn xuống >300px; nút ↓ hiện khi còn cách cuối >300px.
// Giống /dev bên elearning, nhưng cuộn TRONG container (targetRef) chứ không phải window: layout chat
// là h-[100dvh] nên chỉ vùng log (overflow-auto) cuộn. btnClass: màu nền theo accent từng project.
const THRESHOLD = 300;

export default function BackToTop({ targetRef, btnClass = "bg-blue" }) {
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);

  useEffect(() => {
    const el = targetRef?.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setShowTop(el.scrollTop > THRESHOLD);
      setShowBottom(el.scrollHeight - el.scrollTop - el.clientHeight > THRESHOLD);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    el.addEventListener("scroll", schedule, { passive: true });
    // Nội dung dài ra mà không có sự kiện cuộn (stream đang chạy, mở lại phiên cũ) → vẫn phải tính lại
    // để nút ↓ hiện đúng lúc.
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule);
    return () => {
      el.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [targetRef]);

  if (!showTop && !showBottom) return null;

  const cls = `flex h-9 w-9 items-center justify-center rounded-full text-lg text-field shadow-lg transition hover:opacity-90 active:scale-95 ${btnClass}`;
  const go = (top) => {
    const el = targetRef?.current;
    if (el) el.scrollTo({ top: top ? 0 : el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="fixed right-5 top-1/2 z-50 flex -translate-y-1/2 flex-col gap-2">
      {showTop && (
        <button type="button" onClick={() => go(true)} aria-label="Lên đầu trang" title="Lên đầu trang" className={cls}>
          ↑
        </button>
      )}
      {showBottom && (
        <button type="button" onClick={() => go(false)} aria-label="Xuống cuối trang" title="Xuống cuối trang" className={cls}>
          ↓
        </button>
      )}
    </div>
  );
}
