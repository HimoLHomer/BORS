import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT) || 3847;
const api = `http://127.0.0.1:${PORT}`;
const indexPath = path.join("dist", "index.html");

if (!fs.existsSync(indexPath)) {
  console.error("patch-electron-index: missing", indexPath);
  process.exit(1);
}

let html = fs.readFileSync(indexPath, "utf8");
if (html.includes("__borsIpcFetch")) {
  console.log("patch-electron-index: already patched");
  process.exit(0);
}

const patch = [
  "<script>",
  `(function(){var API=${JSON.stringify(api)};`,
  "var ipc=window.__borsIpcFetch;",
  "if(!ipc)return;",
  "var native=window.fetch.bind(window);",
  "window.fetch=function(i,o){",
  "var u=typeof i==='string'?i:(i&&i.url?i.url:'');",
  "if(typeof u==='string'&&u.indexOf('/api/')===0)return ipc(API+u,o);",
  "return native(i,o);};",
  "})();",
  "</script>",
].join("");

html = html.replace("<head>", `<head>${patch}`);
fs.writeFileSync(indexPath, html, "utf8");
console.log("patch-electron-index: patched", indexPath);
