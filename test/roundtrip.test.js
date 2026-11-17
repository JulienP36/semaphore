// Tests de Sémaphore : npm test
const assert = require("assert");
const jsQR = require("jsqr");
const S = require("../src/core.js");

function randomBytes(n, compressible) {
  const d = new Uint8Array(n);
  for (let i = 0; i < n; i++) d[i] = compressible ? (i * 7) & 31 : (Math.random() * 256) | 0;
  return d;
}
const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

async function testBase45() {
  for (const len of [0, 1, 2, 3, 100, 1001]) {
    const b = randomBytes(len);
    assert(same(S.b45dec(S.b45enc(b)), b), "base45 aller-retour, longueur " + len);
  }
  assert(/^[0-9A-Z $%*+\-./:]*$/.test(S.b45enc(randomBytes(500))), "base45 reste dans l'alphabet QR alphanumérique");
  console.log("OK  base45");
}

// Simule un récepteur qui perd une partie des paquets et démarre à n'importe quel moment.
async function testFountain(k, loss, start) {
  const B = 200, size = k * B - 17 > 0 ? k * B - 17 : 1;
  const data = randomBytes(size);
  const s = await S.makeSession(data, "é test|x.bin", B);
  assert.strictEqual(s.k, k);
  const rx = new S.Receiver();
  rx.addText(s.metaText);
  let n = start, received = 0;
  while (!rx.isComplete() && received < 5 * k + 100) {
    if (Math.random() >= loss) { rx.addText(s.dataText(n)); received++; }
    n++;
  }
  assert(rx.isComplete(), `décodage impossible (k=${k}, pertes=${loss}, départ=${start})`);
  const out = await rx.finish();
  assert.strictEqual(out.name, "é test|x.bin");
  assert(same(out.bytes, data), "contenu identique");
  return received / k;
}

async function testCompression() {
  const data = randomBytes(30000, true);
  const s = await S.makeSession(data, "c.bin", 1000);
  assert(s.compressed && s.payloadSize < 2000, "un fichier compressible est compressé");
  const rx = new S.Receiver();
  rx.addText(s.metaText);
  for (let n = 0; !rx.isComplete(); n++) rx.addText(s.dataText(n));
  assert(same((await rx.finish()).bytes, data));
  const r = await S.makeSession(randomBytes(5000), "r.bin", 1000);
  assert(!r.compressed, "un fichier incompressible est envoyé tel quel");
  console.log("OK  compression");
}

async function testCorruption() {
  const data = randomBytes(5000);
  const s = await S.makeSession(data, "a.bin", 1000);
  const rx = new S.Receiver();
  rx.addText(s.metaText);
  for (let n = 0; n < s.k; n++) {
    let t = s.dataText(n);
    if (n === 2) t = t.slice(0, 19) + S.b45enc(randomBytes(s.B));
    rx.addText(t);
  }
  assert(rx.isComplete());
  await assert.rejects(rx.finish(), /corrompu/);
  console.log("OK  corruption détectée");
}

// Affiche de vrais écrans de QR (grille g×g), les relit avec jsQR, et reconstruit le fichier.
async function testScreens(g, B, size, label) {
  const data = randomBytes(40000);
  const s = await S.makeSession(data, "grille.bin", B);
  const version = S.chooseVersion([s.metaText, s.dataText(0), s.dataText(s.k + 5)]);
  const rx = new S.Receiver();
  let slot = 0, n = 0, screens = 0, lost = 0, lastCell = 0;
  const t0 = Date.now();
  while (!rx.isComplete() && screens < 3 * Math.ceil(s.k / (g * g)) + 20) {
    const texts = [];
    for (let i = 0; i < g * g; i++) {
      if (slot % s.metaEvery === 0) texts.push(s.metaText); else texts.push(s.dataText(n++));
      slot++;
    }
    const scr = S.renderScreen(texts, g, size, version);
    lastCell = scr.cell;
    screens++;
    if (Math.random() < 0.15) { lost++; continue; } // 15 % d'écrans ratés par la caméra
    const rgba = new Uint8ClampedArray(scr.pixels.buffer.slice(0));
    const found = S.scanImage(rgba, size, size, jsQR);
    found.forEach(t => rx.addText(t));
  }
  assert(rx.isComplete(), `${label} : fichier non reconstruit`);
  assert(same((await rx.finish()).bytes, data));
  console.log(`OK  écrans ${label} : k=${s.k}, version QR ${version}, module ${lastCell}px, ${screens} écrans (${lost} ratés), ${Date.now() - t0} ms`);
}

(async () => {
  await testBase45();
  for (const [k, loss, start] of [[1, 0, 0], [2, 0.3, 0], [3, 0.3, 7], [10, 0.3, 0], [50, 0.3, 50], [300, 0.3, 0], [1000, 0.2, 1000]]) {
    const ov = await testFountain(k, loss, start);
    console.log(`OK  fountain k=${k} pertes ${loss * 100}% départ n=${start} : ${ov.toFixed(2)}×k paquets reçus`);
  }
  await testCompression();
  await testCorruption();
  await testScreens(1, 1000, 1440, "1×1 (1000 o/paquet)");
  await testScreens(2, 600, 1440, "2×2 (600 o/paquet)");
  console.log("Tous les tests passent.");
})().catch(e => { console.error("ÉCHEC :", e.message); process.exit(1); });
