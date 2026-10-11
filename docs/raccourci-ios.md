# Partager une recette vers Clarté depuis l'iPhone

Sur iPhone, une app ajoutée depuis Safari ne peut pas apparaître dans le menu
**Partager**. On passe donc par un **Raccourci iOS** qui envoie le lien à
`/api/share` : le serveur récupère la recette (un pin Pinterest est suivi
jusqu'au blog d'origine), l'IA la met en fiche, et elle est enregistrée avec sa
photo. Ça marche depuis Pinterest, Safari, Instagram ou n'importe quelle app
qui partage un lien.

## Créer le raccourci (une seule fois, environ 2 minutes)

1. Ouvre l'app **Raccourcis**, puis touche **+** en haut à droite.
2. Renomme le raccourci **Ajouter à Clarté** (touche le nom en haut).
3. Touche l'icône **ⓘ** en bas, puis active **Afficher dans la feuille de
   partage**. Ferme ce panneau.
4. Le premier bloc affiche « Recevoir **N'importe quoi** de **Feuille de
   partage** ». Touche « N'importe quoi » et ne garde que **URL** et **Texte**.
   Touche ensuite « Si aucune entrée » et choisis **Arrêter et répondre**.
5. Ajoute l'action **Obtenir le contenu de l'URL** :
   - URL : `https://TON-DOMAINE/api/share` (l'adresse de ton site Clarté) ;
   - touche **Afficher plus** :
     - Méthode : **POST** ;
     - En-têtes : ajoute `x-access-code` avec ton **code d'accès** (le même que
       sur l'écran « Entre le code d'accès ») ;
     - Corps de la requête : **JSON**, ajoute un champ **Texte** nommé `text`
       et mets-y la variable **Entrée du raccourci**.
6. Ajoute l'action **Obtenir la valeur du dictionnaire** : Valeur de `message`
   dans **Contenu de l'URL**.
7. Ajoute l'action **Afficher la notification** avec la variable **Valeur du
   dictionnaire**.
8. Touche **OK**.

## Utilisation

Dans Pinterest, ouvre un pin, touche **Partager** puis **Ajouter à Clarté**.
Si l'icône n'apparaît pas, touche **Plus** au bout de la ligne des apps ou des
actions.

Une notification s'affiche :
- « « Tarte au citron » ajoutée à Clarté. » : la recette est dans ton carnet ;
- « Import en cours… » : l'IA est lente, la recette apparaîtra d'ici une
  minute ;
- sinon, le message explique pourquoi (code incorrect, page illisible…).

La première fois, iOS demande l'autorisation d'envoyer des données à ton
domaine : choisis **Toujours autoriser**.

## Sur Android

Rien à configurer : une fois l'app installée depuis Chrome (« Ajouter à
l'écran d'accueil »), **Clarté** apparaît directement dans le menu Partager.
