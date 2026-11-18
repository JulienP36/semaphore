// Sémaphore v0.2 : protocole de transfert par QR codes avec fountain codes.
//
// Principe : le fichier est compressé (si ça aide), découpé en k blocs de B octets.
// L'émetteur produit un flux infini de paquets numérotés n = 0, 1, 2, …
//   n < k  : paquet "systématique" = le bloc n tel quel
//   n >= k : paquet "de réparation" = XOR d'un petit nombre de blocs tirés au hasard
//            (loi de degré "robust soliton"), reproductible à partir de n et k.
// Le récepteur n'a besoin d'aucun paquet en particulier : il lui suffit d'en recevoir
// un peu plus que k, dans n'importe quel ordre, à partir de n'importe quel moment.
//
// Tout est en texte "alphanumérique QR" (0-9 A-Z espace $%*+-./:) : les octets sont
// convertis en Base45, ce qui remplit presque aussi bien un QR que du binaire brut
// (97 %) tout en restant lisible par tous les décodeurs (y compris celui du téléphone).
//
// Trames :
//   "SM2D" + sid(4 hex) + k(5 hex) + n(6 hex) + base45(bloc de B octets)     paquet de données
//   "SM2M" + sid(4 hex) + base45(JSON utf-8 des métadonnées)                 métadonnées
var Semaphore = (function () {
  var qrlib = (typeof qrcode !== "undefined") ? qrcode : require("qrcode-generator");

  var A45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  var D45 = {};
  for (var ai = 0; ai < A45.length; ai++) D45[A45.charAt(ai)] = ai;

  var META_EVERY = 16;      // 1 emplacement sur 16 porte les métadonnées
  var GE_MAX_UNKNOWN = 300; // au-delà, pas d'élimination de Gauss (trop coûteuse)

  // ---------- utilitaires ----------
  function b45enc(bytes) {
    var out = [], n, i;
    for (i = 0; i + 1 < bytes.length; i += 2) {
      n = bytes[i] * 256 + bytes[i + 1];
      out.push(A45.charAt(n % 45), A45.charAt(((n / 45) | 0) % 45), A45.charAt((n / 2025) | 0));
    }
    if (bytes.length % 2) {
      n = bytes[bytes.length - 1];
      out.push(A45.charAt(n % 45), A45.charAt((n / 45) | 0));
    }
    return out.join("");
  }
  function b45dec(str) {
    var len = str.length, rem = len % 3;
    if (rem === 1) throw new Error("base45 invalide");
    var out = new Uint8Array(Math.floor(len / 3) * 2 + (rem ? 1 : 0)), o = 0, i, a, b, c, n;
    for (i = 0; i + 2 < len; i += 3) {
      a = D45[str.charAt(i)]; b = D45[str.charAt(i + 1)]; c = D45[str.charAt(i + 2)];
      if (a === undefined || b === undefined || c === undefined) throw new Error("base45 invalide");
      n = a + b * 45 + c * 2025;
      if (n > 65535) throw new Error("base45 invalide");
      out[o++] = n >> 8; out[o++] = n & 255;
    }
    if (rem) {
      a = D45[str.charAt(len - 2)]; b = D45[str.charAt(len - 1)];
      if (a === undefined || b === undefined) throw new Error("base45 invalide");
      n = a + b * 45;
      if (n > 255) throw new Error("base45 invalide");
      out[o++] = n;
    }
    return out;
  }
  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("").toUpperCase();
  }
  function hexn(n, width) { return (n >>> 0).toString(16).toUpperCase().padStart(width, "0"); }
  async function sha256(bytes) { return hex(await crypto.subtle.digest("SHA-256", bytes)); }
  async function pipe(bytes, stream) {
    var res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }
  function compress(bytes) { return pipe(bytes, new CompressionStream("deflate-raw")); }
  function decompress(bytes) { return pipe(bytes, new DecompressionStream("deflate-raw")); }
  function xor(dst, src) { for (var i = 0, n = dst.length; i < n; i++) dst[i] ^= src[i]; }

  // ---------- fountain code (LT) ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var cdfCache = {};
  function solitonCdf(k) {
    if (cdfCache[k]) return cdfCache[k];
    var c = 0.1, delta = 0.5;
    var R = c * Math.log(k / delta) * Math.sqrt(k);
    var spike = Math.max(1, Math.min(k, Math.round(k / R)));
    var p = new Float64Array(k + 1), sum = 0, d, rho, tau;
    for (d = 1; d <= k; d++) {
      rho = d === 1 ? 1 / k : 1 / (d * (d - 1));
      tau = 0;
      if (d < spike) tau = R / (d * k);
      else if (d === spike) tau = Math.max(0, R * Math.log(R / delta) / k);
      p[d] = rho + tau; sum += p[d];
    }
    var cdf = new Float64Array(k + 1), acc = 0;
    for (d = 1; d <= k; d++) { acc += p[d] / sum; cdf[d] = acc; }
    cdf[k] = 1;
    cdfCache[k] = cdf;
    return cdf;
  }
  // Blocs combinés dans le paquet de réparation n (identique côté émetteur et récepteur).
  function neighbors(n, k) {
    if (k === 1) return [0];
    var rng = mulberry32((Math.imul(n + 1, 0x9E3779B1) ^ Math.imul(k + 7, 0x85EBCA6B)) | 0);
    rng();
    var cdf = solitonCdf(k), u = rng(), lo = 1, hi = k;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (cdf[mid] >= u) hi = mid; else lo = mid + 1; }
    var d = lo, out = [], i;
    if (d * 2 > k) {
      var all = new Array(k);
      for (i = 0; i < k; i++) all[i] = i;
      for (i = 0; i < d; i++) {
        var j = i + Math.floor(rng() * (k - i)), tmp = all[i]; all[i] = all[j]; all[j] = tmp;
      }
      return all.slice(0, d);
    }
    var seen = {};
    while (out.length < d) {
      var x = Math.floor(rng() * k);
      if (!seen[x]) { seen[x] = 1; out.push(x); }
    }
    return out;
  }

  // ---------- émetteur ----------
  async function makeSession(bytes, name, blockSize) {
    var B = Math.max(2, Math.min(2400, blockSize & ~1));
    var comp = await compress(bytes);
    var z = comp.length < bytes.length;
    var payload = z ? comp : bytes;
    var k = Math.max(1, Math.ceil(payload.length / B));
    var blocks = new Uint8Array(k * B);
    blocks.set(payload);
    var sid = hex(crypto.getRandomValues(new Uint8Array(2)));
    var meta = { n: name, s: bytes.length, h: await sha256(bytes), c: payload.length, k: k, b: B, z: z ? 1 : 0 };
    var metaText = "SM2M" + sid + b45enc(new TextEncoder().encode(JSON.stringify(meta)));
    function dataText(n) {
      n = n & 0xFFFFFF;
      var idx = n < k ? [n] : neighbors(n, k);
      var out = new Uint8Array(B), i;
      for (i = 0; i < idx.length; i++) xor(out, blocks.subarray(idx[i] * B, (idx[i] + 1) * B));
      return "SM2D" + sid + hexn(k, 5) + hexn(n, 6) + b45enc(out);
    }
    return { sid: sid, k: k, B: B, rawSize: bytes.length, payloadSize: payload.length, compressed: z,
             metaText: metaText, dataText: dataText, metaEvery: META_EVERY };
  }

  // ---------- récepteur ----------
  function Receiver() { this.reset(); }
  Receiver.prototype.reset = function () {
    this.sid = null; this.k = 0; this.B = 0; this.meta = null;
    this.known = null; this.byIdx = null; this.eqList = [];
    this.seen = {}; this.solved = 0; this.unique = 0; this.dups = 0; this.lastGE = 0;
    this.t0 = 0; this.tLast = 0;
  };
  Receiver.prototype._init = function (k, B) {
    if (this.known) return this.k === k && this.B === B;
    this.k = k; this.B = B;
    this.known = new Array(k).fill(null);
    this.byIdx = new Array(k).fill(null);
    return true;
  };
  // Retourne "bad" | "dup" | "new" | "meta".
  Receiver.prototype.addText = function (text, nowMs) {
    if (typeof text !== "string" || text.length < 8 || text.substr(0, 3) !== "SM2") return "bad";
    var type = text.charAt(3), sid = text.substr(4, 4);
    if (!/^[0-9A-F]{4}$/.test(sid)) return "bad";
    if (sid !== this.sid) { this.reset(); this.sid = sid; }
    var now = nowMs === undefined ? Date.now() : nowMs;
    if (!this.t0) this.t0 = now;
    this.tLast = now;
    try {
      if (type === "M") {
        if (this.meta) return "dup";
        var m = JSON.parse(new TextDecoder().decode(b45dec(text.substr(8))));
        if (!(m.k >= 1 && m.b >= 2 && m.c > 0)) return "bad";
        if (!this._init(m.k, m.b)) return "bad";
        this.meta = m;
        return "meta";
      }
      if (type !== "D") return "bad";
      var k = parseInt(text.substr(8, 5), 16), n = parseInt(text.substr(13, 6), 16);
      if (!(k >= 1) || isNaN(n)) return "bad";
      var data = b45dec(text.substr(19));
      if (!this._init(k, data.length)) return "bad";
      if (this.seen[n]) { this.dups++; return "dup"; }
      this.seen[n] = 1;
      this.unique++;
      var idx = n < k ? [n] : neighbors(n, k), unk = [], i;
      for (i = 0; i < idx.length; i++) {
        if (this.known[idx[i]]) xor(data, this.known[idx[i]]); else unk.push(idx[i]);
      }
      if (unk.length === 1) {
        this._solve(unk[0], data);
      } else if (unk.length > 1) {
        var eq = { unk: unk, data: data, dead: false };
        this.eqList.push(eq);
        for (i = 0; i < unk.length; i++) (this.byIdx[unk[i]] || (this.byIdx[unk[i]] = [])).push(eq);
      }
      this._maybeGE();
      return "new";
    } catch (e) {
      return "bad";
    }
  };
  // Propagation : un bloc connu est retiré de toutes les équations qui le contiennent.
  Receiver.prototype._solve = function (idx, data) {
    var stack = [[idx, data]];
    while (stack.length) {
      var it = stack.pop(), i = it[0], d = it[1];
      if (this.known[i]) continue;
      this.known[i] = d; this.solved++;
      var list = this.byIdx[i]; this.byIdx[i] = null;
      if (!list) continue;
      for (var j = 0; j < list.length; j++) {
        var eq = list[j];
        if (eq.dead) continue;
        xor(eq.data, d);
        var p = eq.unk.indexOf(i);
        eq.unk[p] = eq.unk[eq.unk.length - 1]; eq.unk.pop();
        if (eq.unk.length === 1) { eq.dead = true; stack.push([eq.unk[0], eq.data]); }
        else if (eq.unk.length === 0) eq.dead = true;
      }
    }
    if (this.eqList.length > 2000) this.eqList = this.eqList.filter(function (e) { return !e.dead; });
  };
  Receiver.prototype._maybeGE = function () {
    var u = this.k - this.solved;
    if (u <= 0 || u > GE_MAX_UNKNOWN || this.unique < this.k) return;
    if (this.unique - this.lastGE < Math.max(1, Math.min(16, Math.floor(u / 10)))) return;
    this.lastGE = this.unique;
    this._gauss();
  };
  // Élimination de Gauss-Jordan sur GF(2) pour les blocs restants quand l'épluchage est bloqué.
  Receiver.prototype._gauss = function () {
    var U = [], pos = new Int32Array(this.k).fill(-1), i;
    for (i = 0; i < this.k; i++) if (!this.known[i]) { pos[i] = U.length; U.push(i); }
    var u = U.length, W = (u + 31) >>> 5, rows = [];
    for (i = 0; i < this.eqList.length; i++) {
      var eq = this.eqList[i];
      if (eq.dead) continue;
      var bits = new Uint32Array(W);
      for (var j = 0; j < eq.unk.length; j++) { var q = pos[eq.unk[j]]; bits[q >>> 5] |= (1 << (q & 31)); }
      rows.push({ bits: bits, data: new Uint8Array(eq.data) });
    }
    if (rows.length === 0) return;
    var r = 0, pivotCol = [], c, p, j2, row, t;
    for (c = 0; c < u && r < rows.length; c++) {
      var w = c >>> 5, m = (1 << (c & 31));
      p = -1;
      for (j2 = r; j2 < rows.length; j2++) if (rows[j2].bits[w] & m) { p = j2; break; }
      if (p < 0) continue;
      t = rows[p]; rows[p] = rows[r]; rows[r] = t;
      for (j2 = 0; j2 < rows.length; j2++) {
        if (j2 === r || !(rows[j2].bits[w] & m)) continue;
        row = rows[j2];
        for (var x = 0; x < W; x++) row.bits[x] ^= rows[r].bits[x];
        xor(row.data, rows[r].data);
      }
      pivotCol[r] = c; r++;
    }
    for (i = 0; i < r; i++) {
      var cnt = 0;
      for (var y = 0; y < W; y++) { var v = rows[i].bits[y]; while (v) { v &= v - 1; cnt++; } }
      if (cnt === 1) this._solve(U[pivotCol[i]], rows[i].data);
    }
  };
  Receiver.prototype.isComplete = function () {
    return !!this.known && this.solved === this.k && !!this.meta;
  };
  Receiver.prototype.elapsedMs = function () { return Math.max(1, this.tLast - this.t0); };
  // Reconstruit le fichier ; lève une erreur si le hash ne correspond pas.
  Receiver.prototype.finish = async function () {
    var m = this.meta, buf = new Uint8Array(this.k * this.B), i;
    for (i = 0; i < this.k; i++) buf.set(this.known[i], i * this.B);
    var raw = buf.subarray(0, m.c);
    if (m.z) {
      try { raw = await decompress(raw); }
      catch (e) { throw new Error("Fichier corrompu (décompression impossible). Recommence la réception."); }
    }
    if (raw.length !== m.s || (await sha256(raw)) !== m.h) {
      throw new Error("Fichier corrompu (hash différent). Recommence la réception.");
    }
    return { name: m.n, bytes: raw };
  };

  // ---------- affichage : grille de QR codes ----------
  // Plus petite version QR (1..40) qui contient tous les textes donnés (niveau de correction L).
  function chooseVersion(texts) {
    var best = 1;
    texts.forEach(function (t) {
      var q = qrlib(0, "L"); q.addData(t, "Alphanumeric"); q.make();
      var v = (q.getModuleCount() - 17) / 4;
      if (v > best) best = v;
    });
    // La version 23 n'est pas relue par jsQR (lecteur de secours) : on passe à la 24.
    return best === 23 ? 24 : best;
  }
  // Dessine g×g QR codes dans une image carrée de `size` pixels. Retourne les pixels RGBA (Uint32Array).
  function renderScreen(texts, g, size, version) {
    var quiet = 3, tilePx = Math.floor(size / g), modules = version * 4 + 17;
    var cell = Math.max(1, Math.floor(tilePx / (modules + 2 * quiet)));
    var off = Math.floor((tilePx - modules * cell) / 2);
    var px = new Uint32Array(size * size).fill(0xFFFFFFFF);
    for (var t = 0; t < g * g && t < texts.length; t++) {
      var q = qrlib(version, "L"); q.addData(texts[t], "Alphanumeric"); q.make();
      var tx = (t % g) * tilePx + off, ty = Math.floor(t / g) * tilePx + off;
      for (var r = 0; r < modules; r++) {
        for (var c = 0; c < modules; c++) {
          if (!q.isDark(r, c)) continue;
          for (var y = 0; y < cell; y++) {
            var base = (ty + r * cell + y) * size + tx + c * cell;
            for (var x = 0; x < cell; x++) px[base + x] = 0xFF000000;
          }
        }
      }
    }
    return { pixels: px, cell: cell, modules: modules };
  }
  // Lecture des QR d'une image avec jsQR (lecteur de secours quand BarcodeDetector n'existe pas).
  // jsQR se perd dès qu'il y a plusieurs QR dans la même image. On repère donc d'abord les zones
  // "à damier" (blocs de pixels où noir et blanc alternent), séparées par du blanc ou du noir uni,
  // puis on fait lire chaque zone à jsQR séparément. Ça marche quel que soit le cadrage.
  function findBlobs(rgba, w, h) {
    var f = Math.max(2, Math.round(w / 480));
    var bw = Math.floor(w / f), bh = Math.floor(h / f), bx, by, x, y, i;
    if (bw < 8 || bh < 8) return [];
    var ink = new Uint8Array(bw * bh);
    for (by = 0; by < bh; by++) {
      for (bx = 0; bx < bw; bx++) {
        var mn = 255, mx = 0;
        for (y = 0; y < f; y++) {
          i = ((by * f + y) * w + bx * f) * 4;
          for (x = 0; x < f; x++, i += 4) {
            var lum = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
            if (lum < mn) mn = lum; if (lum > mx) mx = lum;
          }
        }
        ink[by * bw + bx] = (mx - mn >= 70) ? 1 : 0;
      }
    }
    var dil = new Uint8Array(bw * bh);
    for (by = 0; by < bh; by++) for (bx = 0; bx < bw; bx++) {
      if (!ink[by * bw + bx]) continue;
      for (y = Math.max(0, by - 1); y <= Math.min(bh - 1, by + 1); y++)
        for (x = Math.max(0, bx - 1); x <= Math.min(bw - 1, bx + 1); x++) dil[y * bw + x] = 1;
    }
    var seen = new Uint8Array(bw * bh), blobs = [], stack = [];
    for (i = 0; i < bw * bh; i++) {
      if (!dil[i] || seen[i]) continue;
      var x0 = bw, x1 = 0, y0 = bh, y1 = 0, area = 0;
      stack.push(i); seen[i] = 1;
      while (stack.length) {
        var c = stack.pop(), cx = c % bw, cy = (c - cx) / bw;
        area++;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
        if (cx > 0 && dil[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; stack.push(c - 1); }
        if (cx < bw - 1 && dil[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; stack.push(c + 1); }
        if (cy > 0 && dil[c - bw] && !seen[c - bw]) { seen[c - bw] = 1; stack.push(c - bw); }
        if (cy < bh - 1 && dil[c + bw] && !seen[c + bw]) { seen[c + bw] = 1; stack.push(c + bw); }
      }
      if (x1 - x0 >= 12 && y1 - y0 >= 12 && area >= 150) blobs.push({ x0: x0, x1: x1, y0: y0, y1: y1, area: area });
    }
    blobs.sort(function (a, b) { return b.area - a.area; });
    return blobs.slice(0, 9).map(function (b) {
      return { x0: Math.max(0, b.x0 * f - f), x1: Math.min(w, (b.x1 + 1) * f + f),
               y0: Math.max(0, b.y0 * f - f), y1: Math.min(h, (b.y1 + 1) * f + f) };
    });
  }
  // Redimensionnement bilinéaire d'une image RGBA.
  function resample(src, w, h, nw, nh) {
    var dst = new Uint8ClampedArray(nw * nh * 4), xr = w / nw, yr = h / nh;
    for (var y = 0; y < nh; y++) {
      var sy = (y + 0.5) * yr - 0.5, y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(h - 1, y0 + 1);
      var fy = Math.min(1, Math.max(0, sy - y0));
      for (var x = 0; x < nw; x++) {
        var sx = (x + 0.5) * xr - 0.5, x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(w - 1, x0 + 1);
        var fx = Math.min(1, Math.max(0, sx - x0)), o = (y * nw + x) * 4;
        var a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
        for (var k = 0; k < 3; k++) {
          dst[o + k] = (src[a + k] * (1 - fx) + src[b + k] * fx) * (1 - fy) + (src[c + k] * (1 - fx) + src[d + k] * fx) * fy;
        }
        dst[o + 3] = 255;
      }
    }
    return dst;
  }
  // jsQR échoue de façon systématique pour certaines tailles de module (ex. 9 px) alors qu'il lit
  // la même image à une autre échelle : si la lecture échoue, on réessaie à 1,5× puis à 0,67×.
  function decodeCrop(sub, ww, hh, jsQRfn) {
    var opts = { inversionAttempts: "dontInvert" };
    var res = jsQRfn(sub, ww, hh, opts);
    if (res || Math.min(ww, hh) < 150) return res;
    var scales = [1.5, 0.67];
    for (var i = 0; i < scales.length && !res; i++) {
      var nw = Math.round(ww * scales[i]), nh = Math.round(hh * scales[i]);
      res = jsQRfn(resample(sub, ww, hh, nw, nh), nw, nh, opts);
    }
    return res;
  }
  function scanImage(rgba, w, h, jsQRfn) {
    var out = [];
    function add(t) { if (out.indexOf(t) < 0) out.push(t); }
    var opts = { inversionAttempts: "dontInvert" };
    var blobs = findBlobs(rgba, w, h);
    if (blobs.length === 0) { // rien repéré : dernière chance, on laisse jsQR chercher dans toute l'image
      var r0 = decodeCrop(rgba, w, h, jsQRfn);
      if (r0) add(r0.data);
      return out;
    }
    blobs.forEach(function (b) {
      var ww = b.x1 - b.x0, hh = b.y1 - b.y0, sub = new Uint8ClampedArray(ww * hh * 4);
      for (var y = 0; y < hh; y++) sub.set(rgba.subarray(((b.y0 + y) * w + b.x0) * 4, ((b.y0 + y) * w + b.x1) * 4), y * ww * 4);
      var res = decodeCrop(sub, ww, hh, jsQRfn);
      if (res) add(res.data);
    });
    return out;
  }

  return { makeSession: makeSession, Receiver: Receiver, chooseVersion: chooseVersion,
           renderScreen: renderScreen, scanImage: scanImage, resample: resample, neighbors: neighbors,
           b45enc: b45enc, b45dec: b45dec, sha256: sha256, META_EVERY: META_EVERY };
})();
if (typeof module !== "undefined") module.exports = Semaphore;
