# Changelog

## 0.2.0 – 17/11/2026

Version centrée sur la vitesse et la fiabilité du transfert.

**Nouveautés**
- **Plus de ratés qui coûtent cher.** Le fichier est maintenant envoyé comme un flux continu de paquets de rattrapage (« fountain codes ») : le téléphone n'a plus besoin de voir chaque image, ni de démarrer au début. Il suffit qu'il reçoive un peu plus de paquets que nécessaire, dans n'importe quel ordre.
- **Plusieurs QR par écran** : grille 1×1, 2×2 ou 3×3, pour multiplier le débit.
- **QR plus denses** : les données sont écrites en Base45 en mode alphanumérique, ce qui remplit presque autant un QR que du binaire (environ +30 % par rapport à la version 0.1).
- **Fichier de test** : un bouton génère un fichier aléatoire de la taille voulue. Le téléphone affiche le débit reçu pendant le transfert et le débit moyen à la fin, pour régler les paramètres selon ta caméra.
- **Bouton Plein écran** côté envoi, nécessaire pour que les grilles de QR restent lisibles.
- Les fichiers qui ne se compressent pas sont envoyés tels quels (plus de perte de place).
- Le débit théorique maximal est affiché côté envoi.

**Améliorations**
- Le lecteur de secours (utilisé quand le navigateur n'a pas de lecteur de QR natif, par exemple sur iPhone) sait maintenant lire plusieurs QR en même temps, quel que soit le cadrage.
- Les images de la caméra sont analysées jusqu'à 1920 px de large (au lieu de 960) pour mieux lire les QR denses.

**Compatibilité**
- Le format des QR a changé : l'émetteur et le récepteur doivent tous les deux être en 0.2. Pense à recharger la page sur le téléphone.

## 0.1.0 – 17/11/2026

Première version utilisable.

- Envoi d'un fichier depuis un écran sous forme de QR codes qui défilent en boucle (taille des morceaux et images par seconde réglables).
- Réception avec la caméra du téléphone : lecture en direct, barre de progression, vérification du fichier (SHA-256), bouton de téléchargement.
- Compression automatique avant l'envoi.
- Une seule page HTML autonome, aucune installation, aucun serveur : tout reste dans le navigateur.

Limites connues : le téléphone doit voir chaque image au moins une fois ; la caméra exige que la page soit servie en HTTPS.
