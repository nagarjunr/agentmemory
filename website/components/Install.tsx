"use client";

import { useState } from "react";
import styles from "./Install.module.css";

const CMDS = [
  {
    cmd: "npx @agentmemory/agentmemory",
    hint: "CLICK TO COPY",
  },
  {
    cmd: "curl -fsSL https://install.iii.dev/console/main/install.sh | sh",
    hint: "CLICK TO COPY · OPTIONAL DEV CONSOLE",
  },
];

function CopyBox({ cmd, hint }: { cmd: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const [label, setLabel] = useState(hint);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setLabel("COPIED");
      setTimeout(() => {
        setCopied(false);
        setLabel(hint);
      }, 1600);
    } catch {
      setLabel("CLIPBOARD BLOCKED");
    }
  };

  return (
    <button
      className={`${styles.box} ${copied ? styles.boxCopied : ""}`}
      onClick={onClick}
    >
      <span className={styles.prompt}>$</span>
      <span className={styles.cmd}>{cmd}</span>
      <span className={styles.hint}>{label}</span>
    </button>
  );
}

export function Install() {
  return (
    <section className={styles.install} id="install" aria-labelledby="install-title">
      <header className="section-head">
        <span className="section-eyebrow">SHIP IT</span>
        <h2 id="install-title" className="section-title">
          ONE COMMAND. ZERO CONFIG.
        </h2>
        <p className="section-lede">
          RUNS ON YOUR MACHINE. YOUR DATA STAYS LOCAL. BRING YOUR OWN CLAUDE
          SUBSCRIPTION OR API KEY.
        </p>
      </header>
      <div className={styles.cards}>
        {CMDS.map((c) => (
          <CopyBox key={c.cmd} cmd={c.cmd} hint={c.hint} />
        ))}
      </div>
      <div className={styles.cta}>
        <a
          className="btn btn--accent"
          href="https://github.com/rohitg00/agentmemory#quick-start"
          target="_blank"
          rel="noopener"
        >
          READ THE QUICKSTART
        </a>
        <a
          className="btn btn--ghost"
          href="https://www.npmjs.com/package/@agentmemory/agentmemory"
          target="_blank"
          rel="noopener"
        >
          NPM PACKAGE
        </a>
      </div>
    </section>
  );
}
