# Sémaphore

Transférer un fichier d'un écran (PC, LCD…) vers un téléphone, **sans câble ni appairage** : le fichier est affiché sous forme de QR codes qui défilent, et le téléphone les lit avec sa caméra.

**Utiliser :** https://julienp36.github.io/semaphore/

## Mode d'emploi

1. Sur le PC, ouvre la page, onglet **Envoyer (écran)**, choisis un fichier (ou **Utiliser un fichier de test**) et clique sur **Démarrer**.
2. Sur le téléphone, ouvre la même page, onglet **Recevoir (caméra)**, clique sur **Démarrer la caméra** et vise l'écran. Tu peux le faire à n'importe quel moment : pas besoin de commencer au début.
3. Quand la barre est pleine, le fichier est vérifié (SHA-256) et un bouton de téléchargement apparaît. Les statistiques de débit s'affichent sous la barre.

## Régler la vitesse

Le débit dépend de ce que ta caméra arrive à lire. Utilise le **fichier de test** et regarde le débit affiché sur le téléphone pendant que tu changes les réglages :

- **Grille de QR** (1×1, 2×2, 3×3) : plus il y a de QR par écran, plus ça va vite. Passe en **plein écran** et garde des modules d'au moins 4 px.
- **Taille d'un paquet** : des paquets plus gros transportent plus par QR, mais le QR devient plus dense.
- **Écrans par seconde** : limité par la caméra (souvent 30 images/s) et par l'écran.

Le débit théorique maximal est affiché côté PC. En pratique, fie-toi au « débit reçu » mesuré par le téléphone.

## Fonctionnement

- Le fichier est compressé (si ça le réduit), puis découpé en *k* blocs de même taille.
- L'émetteur produit un flux infini de paquets numérotés. Les *k* premiers sont les blocs eux-mêmes, les suivants sont des **paquets de rattrapage** : chacun combine (XOR) quelques blocs choisis au hasard de façon reproductible (*fountain code*, loi robust soliton).
- Le récepteur reconstitue le fichier dès qu'il a reçu un peu plus de *k* paquets, **dans n'importe quel ordre et à partir de n'importe quel moment** : une image ratée par la caméra n'oblige pas à attendre un tour complet.
- Les octets sont écrits en Base45 dans des QR en mode alphanumérique : presque aussi dense que du binaire, et lisible par tous les décodeurs de QR.
- Un emplacement sur 16 transporte les métadonnées (nom, taille, hash SHA-256…). Les trames : `SM2D<session><k><n><données>` et `SM2M<session><métadonnées>`.
- Lecture : le lecteur natif du navigateur (`BarcodeDetector`, Android/Chrome) quand il existe, sinon un lecteur de secours en JavaScript (iPhone, Firefox) qui repère d'abord chaque QR de la grille puis le lit.
- Tout se passe dans le navigateur, rien n'est envoyé sur un serveur.

## Développer

```
npm install
npm run build   # génère docs/index.html (fichier autonome, publié par GitHub Pages)
npm test        # protocole, pertes de paquets, corruption, et lecture de vrais écrans de QR
```

Sources : `src/core.js` (protocole, fountain codes, affichage et lecture des grilles), `src/template.html` (interface). Le fichier `docs/index.html` est généré, ne pas le modifier à la main.
