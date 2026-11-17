# Changelog

## 0.1.0 – 17/11/2026

Première version utilisable.

- Envoi d'un fichier depuis un écran sous forme de QR codes qui défilent en boucle (taille des morceaux et images par seconde réglables).
- Réception avec la caméra du téléphone : lecture en direct, barre de progression, vérification du fichier (SHA-256), bouton de téléchargement.
- Compression automatique avant l'envoi.
- Les images peuvent être reçues dans n'importe quel ordre, et on peut démarrer à n'importe quel moment de la boucle.
- Fichier corrompu détecté avec un message clair.
- Une seule page HTML autonome, aucune installation, aucun serveur : tout reste dans le navigateur.

Limites connues : le téléphone doit voir chaque image au moins une fois ; la caméra exige que la page soit servie en HTTPS.
