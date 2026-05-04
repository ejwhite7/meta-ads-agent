import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: "http://localhost:3001",
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: "dist",
		/* Source maps inflate the bundled CLI tarball ~4x. Re-enable
		 * locally with VITE_SOURCEMAP=true if you need to debug a build. */
		sourcemap: process.env.VITE_SOURCEMAP === "true",
	},
});
