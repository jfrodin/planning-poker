import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";

// Local Node runtime: rooms and CSV files live on the host computer.
export default defineConfig({
  plugins: [vinext(), sites()],
  server: {
    host: "127.0.0.1",
    watch: { useFsEvents: false, usePolling: process.env.CODEX_SANDBOX === "seatbelt" },
  },
});
