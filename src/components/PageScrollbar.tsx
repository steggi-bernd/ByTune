/**
 * The content panel's scrollbar, floating over the page. A native one takes
 * its width out of what it scrolls, so no header or shelf could reach the
 * panel's edge past it (the scroller's own is hidden, see .scroll-host). Drag
 * the pill, or press beside it to move a page, as on a native one; wheel and
 * keyboard stay the scroller's own. Hidden while the page fits.
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

const MIN_THUMB_PX = 40;

export function PageScrollbar({ scrollerId }: { scrollerId: string }) {
  const barRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  // Scrolling writes straight to the styles: no render per scroll event.
  useEffect(() => {
    const el = document.getElementById(scrollerId);
    if (!el) return;
    const update = (): void => {
      const bar = barRef.current;
      const thumb = thumbRef.current;
      if (!bar || !thumb) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      const range = scrollHeight - clientHeight;
      bar.style.display = range > 1 ? "" : "none";
      if (range <= 1) return;
      const height = Math.max(MIN_THUMB_PX, (clientHeight * clientHeight) / scrollHeight);
      thumb.style.height = `${height}px`;
      thumb.style.transform = `translateY(${(scrollTop / range) * (clientHeight - height)}px)`;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // The panel resizes with the window, the page with what it loads; the
    // scroller's one child stays while the views inside it come and go.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollerId]);

  const movePage = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget || !thumbRef.current) return;
    const el = document.getElementById(scrollerId);
    const above = e.clientY < thumbRef.current.getBoundingClientRect().top;
    el?.scrollBy({ top: (above ? -0.9 : 0.9) * el.clientHeight, behavior: "smooth" });
  };

  const drag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = document.getElementById(scrollerId);
    if (!el) return;
    e.preventDefault();
    const thumb = e.currentTarget;
    thumb.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startTop = el.scrollTop;
    const perPixel = (el.scrollHeight - el.clientHeight) / (el.clientHeight - thumb.offsetHeight);
    const move = (ev: PointerEvent): void => {
      el.scrollTop = startTop + (ev.clientY - startY) * perPixel;
    };
    const end = (): void => {
      thumb.removeEventListener("pointermove", move);
      thumb.removeEventListener("pointerup", end);
      thumb.removeEventListener("pointercancel", end);
    };
    thumb.addEventListener("pointermove", move);
    thumb.addEventListener("pointerup", end);
    thumb.addEventListener("pointercancel", end);
  };

  return (
    <div ref={barRef} aria-hidden className="page-scrollbar" onPointerDown={movePage}>
      <div ref={thumbRef} className="page-scrollbar__thumb" onPointerDown={drag} />
    </div>
  );
}
