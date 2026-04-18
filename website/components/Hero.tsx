import { MemoryGraph } from "./MemoryGraph";
import styles from "./Hero.module.css";

export function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <MemoryGraph />
      <div className={styles.vignette} aria-hidden />
      <div className={styles.content}>
        <div className={styles.chip}>ZERO EXTERNAL DATABASES · v0.8.13</div>
        <h1 className={styles.title} id="hero-title">
          <span className={styles.word}>AGENT</span>
          <span className={`${styles.word} ${styles.accent}`}>MEMORY</span>
        </h1>
        <p className={styles.lede}>
          THE MEMORY LAYER YOUR CODING AGENT SHOULD HAVE HAD FROM DAY ONE.
          CAPTURE EVERY SESSION. RECALL IN MILLISECONDS. RUN ANYWHERE.
        </p>
        <div className={styles.cta}>
          <a href="#install" className="btn btn--accent">
            START IN 60 SECONDS
          </a>
          <a href="#live" className="btn btn--ghost">
            SEE IT MOVE
          </a>
        </div>
      </div>
    </section>
  );
}
