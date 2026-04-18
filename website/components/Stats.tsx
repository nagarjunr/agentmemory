"use client";

import { useEffect, useRef } from "react";
import styles from "./Stats.module.css";

interface StatItem {
  target: number;
  suffix?: string;
  label: string;
  float?: boolean;
}

const STATS: StatItem[] = [
  { target: 95.2, suffix: "%", label: "RETRIEVAL R@5 · LONGMEMEVAL-S", float: true },
  { target: 92, suffix: "%", label: "FEWER INPUT TOKENS PER SESSION" },
  { target: 44, label: "MCP TOOLS" },
  { target: 12, label: "AUTOHOOKS" },
  { target: 0, label: "EXTERNAL DATABASES" },
  { target: 769, label: "TESTS PASSING" },
];

export function Stats() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;
    const numEls = rootRef.current.querySelectorAll<HTMLDivElement>(
      "[data-num]",
    );

    const count = (el: HTMLDivElement) => {
      const target = Number(el.dataset.target);
      const suffix = el.dataset.suffix || "";
      const isFloat = el.dataset.float === "1";
      const startAt = performance.now();
      const duration = 1400;
      const tick = (now: number) => {
        const t = Math.min(1, (now - startAt) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const v = target * eased;
        el.textContent = isFloat
          ? `${v.toFixed(1)}${suffix}`
          : `${Math.round(v)}${suffix}`;
        if (t < 1) requestAnimationFrame(tick);
        else
          el.textContent = isFloat
            ? `${target.toFixed(1)}${suffix}`
            : `${target}${suffix}`;
      };
      requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLDivElement;
          const num = el.querySelector<HTMLDivElement>("[data-num]");
          if (num && !num.dataset.done) {
            num.dataset.done = "1";
            count(num);
          }
          io.unobserve(el);
        }
      },
      { threshold: 0.5 },
    );

    rootRef.current
      .querySelectorAll<HTMLDivElement>("[data-stat]")
      .forEach((el) => io.observe(el));

    return () => io.disconnect();
  }, []);

  return (
    <section className={styles.stats} aria-label="Benchmarks">
      <div className={styles.row} ref={rootRef}>
        {STATS.map((s) => (
          <article key={s.label} className={styles.stat} data-stat>
            <div
              className={styles.num}
              data-num
              data-target={s.target}
              data-suffix={s.suffix || ""}
              data-float={s.float ? "1" : "0"}
            >
              0{s.suffix || ""}
            </div>
            <div className={styles.label}>{s.label}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
