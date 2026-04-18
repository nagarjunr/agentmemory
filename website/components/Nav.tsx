import styles from "./Nav.module.css";

export function Nav() {
  return (
    <header className={styles.nav}>
      <button className={styles.menu} aria-label="Menu">
        <span className={styles.bar} />
        <span className={styles.bar} />
        <span className={styles.bar} />
        <span className={styles.label}>MENU</span>
      </button>
      <a href="#top" className={styles.mark} aria-label="agentmemory home">
        <svg viewBox="0 0 120 120" width="44" height="44" aria-hidden>
          <polygon
            points="60,6 111,34 111,86 60,114 9,86 9,34"
            fill="none"
            stroke="#fff"
            strokeWidth="2.5"
          />
          <polygon
            points="60,28 90,44 90,76 60,92 30,76 30,44"
            fill="none"
            stroke="#FFC000"
            strokeWidth="2.5"
          />
          <circle cx="60" cy="60" r="6" fill="#FFC000" />
        </svg>
      </a>
      <div className={styles.right}>
        <a href="#install" className={styles.link}>
          INSTALL
        </a>
        <a
          href="https://github.com/rohitg00/agentmemory"
          target="_blank"
          rel="noopener"
          className={styles.link}
        >
          GITHUB
        </a>
      </div>
    </header>
  );
}
