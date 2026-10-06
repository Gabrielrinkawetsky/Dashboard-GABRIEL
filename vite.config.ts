import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/api": "http://127.0.0.1:3001" },
    // O servidor de desenvolvimento serve tudo que está na pasta do projeto. Bloqueia banco (e arquivos -wal/-shm),
    // backups, código do servidor, scripts e docs. Os padrões precisam começar com "**/" porque o Vite compara caminhos absolutos.
    fs: {
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/data/**", "**/server/**", "**/scripts/**", "**/*.md", "**/*.{db,db-wal,db-shm,sqlite,sqlite3,bak}"],
    },
  },
});
