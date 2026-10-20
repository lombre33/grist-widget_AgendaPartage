# Planning de la Semaine de l’innovation 2026 — widget Grist

Widget personnalisé pour [Grist](https://www.getgrist.com) : le planning de la 3e Semaine de l’innovation (23 - 27 novembre 2026, métropole bordelaise), avec, pour chaque événement, les personnes qui comptent y aller (**présent** ou **à confirmer**) et le logo de leur établissement. Les changements des autres apparaissent en direct.

HTML, CSS et JavaScript natifs : la seule dépendance est le script officiel `grist-plugin-api.js`.

| Fichier | Rôle |
| --- | --- |
| `index.html`, `style.css`, `widget.js` | le widget (l’URL à donner à Grist est celle de `index.html`) |
| `assets/logo-semaine-innovation.jpg` | logo tiré du planning officiel |
| `data/Evenements_Semaine_Innovation_2026.xlsx` | les 30 séances, à importer dans Grist |
| `data/build_xlsx.py` | génère l’Excel (et les données de test) à partir de la liste des événements |
| `dev/` | faux Grist pour tester dans un navigateur, sans Grist |

## Mise en place

1. **Ajouter le widget** : sur une page, *Ajouter un widget* → *Personnalisé*, URL de `index.html` hébergé (voir plus bas), niveau d’accès **Accès complet au document**. Données : la table **`Participations`**. Rien n’est à associer dans le panneau du widget.
2. **L’ouvrir une fois avec un compte propriétaire** : le widget crée lui-même les colonnes de `Participations` (un message « Configuration terminée » s’affiche). Rien à créer à la main, pas de formule à écrire.
3. C’est tout, si les règles d’accès autorisent ce qui est listé dans « Règles d’accès » plus bas (c’est le cas tant qu’aucune règle ne restreint `Participations`).

## Tables Grist

| Table | Rôle | Colonnes utilisées par le widget |
| --- | --- | --- |
| `Evenements` | import de l’Excel | `Jour` (Date), `Debut`, `Fin`, `Titre`, `Sous_titre`, `Type`, `Temps_fort`, `Lieu`, `Ville`, `Adresse`, `Public`, `Description`, `Lien` |
| `Annuaire` | une ligne par personne, **en lecture seule pour le widget** | `email`, `nom`, `prenom`, `nom_de_domaine`, `Etablissement` (texte) |
| `Etablissement` | un logo par établissement | `Nom_complet`, `nom_de_domaine`, `Logo` (pièce jointe) |
| `Participations` | **une ligne par présence**, c’est la table liée au widget | colonnes ci-dessous, créées par le widget |

Colonnes créées par le widget dans `Participations` :

| Colonne | Type | Contenu |
| --- | --- | --- |
| `Evenement` | référence → `Evenements` | l’événement coché |
| `Statut` | choix : `présent`, `à confirmer` | écrit par le widget |
| `Email` | texte, formule « à la création » | `user.Email` : l’e-mail de la personne qui a coché |
| `Utilisateur` | référence → `Annuaire`, formule | la ligne de l’`Annuaire` qui a cet e-mail (sans tenir compte des majuscules) |

`Email` et `Utilisateur` se remplissent seuls à la création de la ligne : le widget ne les écrit pas, donc personne ne peut cocher à la place d’un autre. Le logo d’une personne est celui de son établissement, retrouvé par le nom de domaine (sinon par le nom de l’établissement). Le lieu de chaque événement est un lien vers Google Maps (recherche sur l’adresse, sinon sur le lieu et la ville), qui s’ouvre dans un nouvel onglet. Les présences arrivent dans le widget en direct, sans relecture. Dans `Participations`, vous pouvez régler l’affichage de `Evenement` sur `Titre` pour y lire les noms des événements.

**Pourquoi pas dans l’`Annuaire` ?** Si le document déclare un *attribut utilisateur* sur l’`Annuaire` (règles d’accès, par exemple `acl` : `user.Email` → `Annuaire.email`), Grist recharge la page de la personne dès que sa propre ligne de l’`Annuaire` change. Les présences ne passent donc jamais par l’`Annuaire`. Une première version y enregistrait deux colonnes (`Evenements_presents` et `Evenements_a_confirmer`) : si elles existent encore, vous pouvez les supprimer.

## Reconnaître la personne connectée

Grist ne dit pas au widget qui est connecté, mais il le donne aux formules évaluées à la création d’une ligne (`user.Email`). À l’ouverture, le widget ajoute donc une ligne dans `Participations`, lit le résultat des colonnes `Email` et `Utilisateur`, puis la supprime.

- Aucune règle d’accès particulière sur l’e-mail n’est nécessaire : il peut rester lisible par tous dans l’`Annuaire`.
- Si l’adresse de connexion n’est pas dans l’`Annuaire`, le widget affiche cette adresse et passe en lecture seule.
- Repli, si la ligne ne peut pas être ajoutée : le widget prend la ligne de l’`Annuaire` dont l’e-mail est le seul lisible (règle `rec.email == user.Email` sur la colonne `email`). Sinon un message en haut de page donne la raison.

## Règles d’accès

Le widget a seulement besoin que :

- tout le monde puisse **lire** `Annuaire`, `Etablissement`, `Evenements` et `Participations` ;
- chaque éditeur puisse **ajouter et supprimer des lignes** dans `Participations` (c’est le cas tant qu’aucune règle ne l’interdit).

Recommandé, pour qu’on ne puisse pas modifier ou supprimer les présences des autres : sur `Participations`, modification et suppression autorisées seulement si `rec.Email == user.Email` (les propriétaires : `user.Access in [OWNER]` en premier).

## Hébergement
GitHub Pages : *Settings* → *Pages* → *Deploy from a branch* → `main`, dossier `/ (root)`. L’URL du widget est alors `https://<compte>.github.io/<dépôt>/`.

## Changer un nom de table ou de colonne, ou un libellé
- Noms de tables et de colonnes (dont les deux colonnes de présence) : bloc `CONFIG` en haut de `widget.js`.
- Textes des boutons et des compteurs : `LIBELLES`, juste en dessous de `CONFIG`.

## Tester sans Grist
```sh
python3 -m http.server 8000
```
puis ouvrir <http://localhost:8000/dev/>. Le faux Grist reprend la structure des tables ci-dessus et simule des participants (bouton « Un autre participant bouge » pour voir la mise à jour en direct). Options d’URL : `?moi=2` (autre personne), `?restreint` (l’Annuaire ne montre que sa ligne), `?ambigu` (tous les e-mails lisibles, comme dans le vrai document), `?anonyme` (personne non connectée), `?inconnu` (connecté avec une adresse absente de l’Annuaire), `?sans-declencheur` (`user.Email` ne donne rien : repli sur l’e-mail lisible), `?declencheur-casse` (colonnes d’une version précédente, à recréer), `?sans-ajout` (impossible d’ajouter une ligne dans `Participations`), `?sans-colonnes` (les colonnes n’existent pas encore : le widget les crée), `?sans-droits` (… mais la structure n’est pas modifiable), `?ecriture-refusee` (les règles d’accès refusent d’enregistrer une présence), `?vide` (aucune présence).

## Mettre à jour les événements
Modifier la liste `EVENEMENTS` dans `data/build_xlsx.py` puis `python3 data/build_xlsx.py` (nécessite `openpyxl`), ou modifier directement la table `Evenements` dans Grist : le widget relit les événements chaque minute.

Sources : planning PDF « mise à jour 13-10 » et fiches de <https://www.u-bordeaux.fr/evenements/semaine-de-linnovation-2026-3e-edition>.
