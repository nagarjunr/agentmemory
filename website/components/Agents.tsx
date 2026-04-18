import styles from "./Agents.module.css";

const AGENTS = [
  "CLAUDE CODE",
  "CURSOR",
  "CODEX CLI",
  "GEMINI CLI",
  "OPENCODE",
  "CLINE",
  "GOOSE",
  "KILO CODE",
  "ROO CODE",
  "WINDSURF",
  "AIDER",
  "ANY MCP CLIENT",
];

export function Agents() {
  return (
    <section className={styles.wrap} aria-labelledby="agents-title">
      <header className="section-head">
        <span className="section-eyebrow">WORKS WITH</span>
        <h2 id="agents-title" className="section-title">
          EVERY AGENT YOU ALREADY USE.
        </h2>
      </header>
      <ul className={styles.grid}>
        {AGENTS.map((a) => (
          <li key={a} className={styles.tile}>
            {a}
          </li>
        ))}
      </ul>
    </section>
  );
}
