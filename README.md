# Sémaphore

Transférer un fichier d'un écran (PC, LCD…) vers un téléphone, **sans câble ni appairage** : le fichier est affiché sous forme de QR codes qui défilent, et le téléphone les lit avec sa caméra.

**Utiliser :** https://julienp36.github.io/semaphore/

## Mode d'emploi

1. Sur le PC, ouvre la page, onglet **Envoyer (écran)**, choisis un fichier et clique sur **Démarrer**.
2. Sur le téléphone, ouvre la même page, onglet **Recevoir (caméra)**, clique sur **Démarrer la caméra** et vise l'écran.
3. Quand la barre est pleine, le fichier est vérifié (SHA-256) et un bouton de téléchargement apparaît.

Si le téléphone rate beaucoup d'images : réduis la taille des morceaux ou le nombre d'images par seconde côté PC.

## Fonctionnement

- Le fichier est compressé (deflate), découpé en morceaux, et chaque morceau est encodé en base64 dans un QR code (correction d'erreur faible, QR gros et lisibles).
- Chaque trame : `SMP1|<session>|<numéro>|<total>|<données>`. La trame 0 contient le nom, la taille, le hash et la taille compressée.
- Les trames tournent en boucle : le téléphone peut démarrer à n'importe quel moment et reçoit les trames dans n'importe quel ordre.
- Tout se passe dans le navigateur, rien n'est envoyé sur un serveur.

Limites de la v0.1 : il faut avoir vu chaque trame au moins une fois (pas de codes correcteurs de type fountain codes pour l'instant), et le débit est de l'ordre de quelques dizaines de Ko/s.

## Développer

```
npm install
npm run build   # génère docs/index.html (fichier autonome, publié par GitHub Pages)
npm test        # test aller-retour : encodage → QR → décodage → comparaison
```

Sources : `src/core.js` (protocole), `src/template.html` (interface). Le fichier `docs/index.html` est généré, ne pas le modifier à la main.
