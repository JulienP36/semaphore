const qrcode = require("qrcode-generator");
const jsQR = require("jsqr");
const Semaphore = require("../src/core.js");
function render(text) {
  const qr = qrcode(0, "L"); qr.addData(text, "Byte"); qr.make();
  const n = qr.getModuleCount(), q = 4, cell = 4, S = (n + 2*q) * cell;
  const d = new Uint8ClampedArray(S*S*4).fill(255);
  for (let r=0;r<n;r++) for (let c=0;c<n;c++) if (qr.isDark(r,c))
    for (let y=0;y<cell;y++) for (let x=0;x<cell;x++) {
      const i = (((r+q)*cell+y)*S + (c+q)*cell+x)*4; d[i]=d[i+1]=d[i+2]=0; }
  return {d, S};
}
(async () => {
  const data = new Uint8Array(20000);
  for (let i=0;i<data.length;i++) data[i] = (i*31 + (i>>5)*7) & 255 ^ (Math.random()*40|0);
  for (const chunk of [300, 800, 1500]) {
    const enc = await Semaphore.encodeFile(data, "mon fichier é|test.bin", chunk);
    const rx = new Semaphore.Receiver();
    // démarrage au milieu de la boucle, 2 tours, doublons
    const order = [];
    const start = Math.floor(enc.frames.length/2);
    for (let t=0;t<2*enc.frames.length;t++) order.push((start+t)%enc.frames.length);
    let maxv = 0;
    for (const idx of order) {
      const {d,S} = render(enc.frames[idx]);
      const res = jsQR(d,S,S);
      if (!res) throw new Error("QR illisible frame "+idx);
      rx.addFrame(res.data);
      if (rx.isComplete()) break;
    }
    const out = await rx.finish();
    const ok = Buffer.compare(Buffer.from(out.bytes), Buffer.from(data))===0 && out.name==="mon fichier é|test.bin";
    console.log("chunk", chunk, "frames", enc.frames.length, "comp", enc.compSize, ok ? "OK":"ECHEC");
    if (!ok) process.exit(1);
  }
  // corruption
  const enc = await Semaphore.encodeFile(data, "a.bin", 800);
  const rx = new Semaphore.Receiver();
  enc.frames.forEach((f,i)=>rx.addFrame(i===2 ? f.slice(0,-3)+"AAA" : f));
  try { await rx.finish(); console.log("corruption NON détectée"); process.exit(1);} catch(e){ console.log("corruption détectée:", e.message); }
})();
