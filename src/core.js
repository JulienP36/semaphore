// Semaphore v1 : protocole de transfert par QR codes en boucle (sans fountain codes).
// Trame texte : "SMP1|<sid>|<i>|<n>|<payload>"
//   i = 0   : méta  -> payload = nom(encodeURIComponent) | tailleBrute | sha256 hex | tailleCompressée
//   i = 1.. : données -> payload = tranche de base64 du flux compressé (deflate-raw)
var Semaphore = (function () {
  var PREFIX = "SMP1";

  function toB64(bytes) {
    var s = "", step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return btoa(s);
  }
  function fromB64(b64) {
    var s = atob(b64), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }
  async function sha256(bytes) {
    return hex(await crypto.subtle.digest("SHA-256", bytes));
  }
  async function pipe(bytes, stream) {
    var res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }
  function compress(bytes) { return pipe(bytes, new CompressionStream("deflate-raw")); }
  function decompress(bytes) { return pipe(bytes, new DecompressionStream("deflate-raw")); }

  function randomSid() {
    var a = new Uint8Array(3);
    crypto.getRandomValues(a);
    return hex(a);
  }

  // Prépare la liste des trames (chaînes) pour un fichier.
  async function encodeFile(bytes, name, chunkChars) {
    var comp = await compress(bytes);
    var b64 = toB64(comp);
    var hash = await sha256(bytes);
    var sid = randomSid();
    var parts = Math.max(1, Math.ceil(b64.length / chunkChars));
    var n = parts + 1;
    var frames = [];
    frames.push([PREFIX, sid, 0, n,
      [encodeURIComponent(name), bytes.length, hash, comp.length].join("|")].join("|"));
    for (var k = 0; k < parts; k++) {
      frames.push([PREFIX, sid, k + 1, n, b64.substr(k * chunkChars, chunkChars)].join("|"));
    }
    return { frames: frames, sid: sid, rawSize: bytes.length, compSize: comp.length };
  }

  // Récepteur : on lui donne les trames décodées, dans n'importe quel ordre.
  function Receiver() { this.reset(); }
  Receiver.prototype.reset = function () {
    this.sid = null; this.n = 0; this.parts = {}; this.got = 0; this.meta = null;
  };
  // Retourne false si la trame est ignorée, true si elle est nouvelle, null si déjà vue.
  Receiver.prototype.addFrame = function (text) {
    var p = text.split("|");
    if (p[0] !== PREFIX || p.length < 5) return false;
    var sid = p[1], i = parseInt(p[2], 10), n = parseInt(p[3], 10);
    if (!(i >= 0 && n >= 2 && i < n)) return false;
    var payload = p.slice(4).join("|");
    if (this.sid !== sid) { this.reset(); this.sid = sid; this.n = n; }
    if (this.n !== n) return false;
    if (this.parts[i] !== undefined) return null;
    this.parts[i] = payload;
    this.got++;
    if (i === 0) {
      var m = payload.split("|");
      this.meta = {
        name: decodeURIComponent(m[0]), rawSize: parseInt(m[1], 10),
        hash: m[2], compSize: parseInt(m[3], 10)
      };
    }
    return true;
  };
  Receiver.prototype.isComplete = function () {
    return this.sid !== null && this.got === this.n;
  };
  // Reconstruit le fichier ; lève une erreur si le hash ne correspond pas.
  Receiver.prototype.finish = async function () {
    var b64 = "";
    for (var k = 1; k < this.n; k++) b64 += this.parts[k];
    var raw;
    try {
      raw = await decompress(fromB64(b64));
    } catch (e) {
      throw new Error("Fichier corrompu (décompression impossible). Recommence la réception.");
    }
    var h = await sha256(raw);
    if (h !== this.meta.hash || raw.length !== this.meta.rawSize) {
      throw new Error("Fichier corrompu (hash différent). Recommence la réception.");
    }
    return { name: this.meta.name, bytes: raw };
  };

  return { encodeFile: encodeFile, Receiver: Receiver, sha256: sha256 };
})();
if (typeof module !== "undefined") module.exports = Semaphore;
