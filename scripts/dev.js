// Sobe a API (porta 3001) e o site (porta 5180) juntos para `npm run dev`. Ctrl+C encerra os dois.
// Substitui o pacote "concurrently" (sem versão livre de vulnerabilidade conhecida no momento; era só ferramenta de desenvolvimento).
import { spawn, spawnSync } from "node:child_process";

const tasks = [
  ["api", "dev:api", "\x1b[36m"],
  ["web", "dev:web", "\x1b[35m"],
];
const children = [];
let stopping = false;

// No Windows, kill() mata só o "casco" do comando e deixa o servidor órfão ocupando a porta: encerra a árvore inteira.
const killTree = (child) => {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
};

const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) killTree(c);
  setTimeout(() => process.exit(code), 300);
};

for (const [name, script, color] of tasks) {
  const child = spawn(`npm run ${script}`, { stdio: ["ignore", "pipe", "pipe"], shell: true });
  children.push(child);
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) out.write(prefix + l + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!stopping) { console.error(`${prefix}encerrou (código ${code}); parando os demais.`); stop(code ?? 1); }
  });
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
