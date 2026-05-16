import fs from "node:fs";
import path from "node:path";

/** Remove legacy IPC fetch shim — desktop loads UI over http://127.0.0.1:3847 (same-origin fetch). */
const indexPath = path.join("dist", "index.html");
if (!fs.existsSync(indexPath)) {
  console.error("patch-electron-index: missing", indexPath);
  process.exit(1);
}

let html = fs.readFileSync(indexPath, "utf8");
const before = html;
html = html.replace(/<script>\(function\(\)\{var API=[\s\S]*?<\/script>/, "");
if (html !== before) {
  fs.writeFileSync(indexPath, html, "utf8");
  console.log("patch-electron-index: removed IPC fetch shim from", indexPath);
} else {
  console.log("patch-electron-index: index already clean");
}
