// Assemble src/template.html + bibliothèques + src/core.js en un seul fichier autonome : docs/index.html
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const safe = (s) => s.replace(/<\/script/gi, "<\\/script").replace(/\/\/# sourceMappingURL=.*$/gm, "");
let html = read("src/template.html");
const parts = {
  "/*QRCODE*/": safe(read("node_modules/qrcode-generator/dist/qrcode.js")),
  "/*JSQR*/": safe(read("node_modules/jsqr/dist/jsQR.js")),
  "/*CORE*/": safe(read("src/core.js")),
};
for (const [k, v] of Object.entries(parts)) html = html.split(k).join(v);
fs.mkdirSync(path.join(root, "docs"), { recursive: true });
fs.writeFileSync(path.join(root, "docs/index.html"), html);
console.log("docs/index.html généré (" + (html.length / 1024).toFixed(0) + " Ko)");
