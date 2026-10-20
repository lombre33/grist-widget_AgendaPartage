# Planning de la Semaine de l’innovation 2026 — widget Grist

Widget personnalisé pour [Grist](https://www.getgrist.com) : le planning de la 3e Semaine de l’innovation (23 - 27 novembre 2026, métropole bordelaise), avec, pour chaque événement, les personnes qui comptent y aller (**présent** ou **à confirmer**) et le logo de leur établissement. Les changements des autres apparaissent en quelques secondes.

HTML, CSS et JavaScript natifs : la seule dépendance est le script officiel `grist-plugin-api.js`.

| Fichier | Rôle |
| --- | --- |
| `index.html`, `style.css`, `widget.js` | le widget (l’URL à donner à Grist est celle de `index.html`) |
| `assets/logo-semaine-innovation.jpg` | logo tiré du planning officiel |
| `data/Evenements_Semaine_Innovation_2026.xlsx` | les 30 séances, à importer dans Grist |
| `data/build_xlsx.py` | génère l’Excel (et les données de test) à partir de la liste des événements |
| `dev/` | faux Grist pour tester dans un navigateur, sans Grist |

## Mise en place

1. **Ajouter le widget** : sur une page, *Ajouter un widget* → *Personnalisé*, URL de `index.html` hébergé (voir plus bas), niveau d’accès **Accès complet au document**. Données : la table **`Participations`** (un simple support : elle ne garde aucune donnée). Rien n’est à associer dans le panneau du widget.
2. **L’ouvrir une fois avec un compte propriétaire** : le widget ajoute lui-même les colonnes dont il a besoin (un message « Configuration terminée » s’affiche) : deux dans l’`Annuaire` pour les présences, deux dans `Participations` pour reconnaître la personne connectée. Rien à créer à la main, pas de formule à écrire.
3. C’est tout, si les règles d’accès autorisent ce qui est listé dans « Règles d’accès » plus bas (c’est déjà le cas avec les règles actuelles du document).

## Tables Grist

| Table | Rôle | Colonnes utilisées par le widget |
| --- | --- | --- |
| `Evenements` | import de l’Excel | `Jour` (Date), `Debut`, `Fin`, `Titre`, `Sous_titre`, `Type`, `Temps_fort`, `Lieu`, `Ville`, `Adresse`, `Public`, `Description`, `Lien` |
| `Annuaire` | une ligne par personne | `email`, `nom`, `prenom`, `nom_de_domaine`, `Etablissement` (texte), et les deux colonnes de présence ci-dessous |
| `Etablissement` | un logo par établissement | `Nom_complet`, `nom_de_domaine`, `Logo` (pièce jointe) |

Colonnes ajoutées par le widget à l’`Annuaire` (type *liste de références* vers `Evenements`) :

| Colonne | Contenu |
| --- | --- |
| `Evenements_presents` | les événements où la personne est **présente** |
| `Evenements_a_confirmer` | les événements où sa présence est **à confirmer** |

Le logo d’une personne est celui de son établissement, retrouvé par le nom de domaine (sinon par le nom de l’établissement). La table liée au widget n’est qu’un support : seule la ligne de la personne connectée est modifiée dans l’`Annuaire`, et jamais ses autres colonnes. Dans l’`Annuaire`, vous pouvez régler l’affichage de ces deux colonnes sur `Titre` pour y lire les noms des événements.

Les présences des autres sont relues toutes les 5 secondes (`CONFIG.directMs`) : Grist ne prévient le widget que des changements de la table à laquelle il est lié.

## Reconnaître la personne connectée

Grist ne dit pas au widget qui est connecté, mais il le donne aux formules évaluées à la création d’une ligne (`user.Email`). À l’ouverture, le widget ajoute donc une ligne dans `Participations`, lit le résultat puis la supprime :

| Colonne de `Participations` | Contenu |
| --- | --- |
| `Email` | formule « à la création » : `user.Email` |
| `Utilisateur` | formule : la ligne de l’`Annuaire` qui a cet e-mail (sans tenir compte des majuscules) |

- Aucune règle d’accès particulière sur l’e-mail n’est nécessaire : il peut rester lisible par tous dans l’`Annuaire`.
- Si l’adresse de connexion n’est pas dans l’`Annuaire`, le widget affiche cette adresse et passe en lecture seule.
- Repli, si la ligne ne peut pas être ajoutée : le widget prend la ligne de l’`Annuaire` dont l’e-mail est le seul lisible (règle `rec.email == user.Email` sur la colonne `email`). Si plusieurs e-mails sont lisibles, il le dit en haut de page.

## Règles d’accès

Le widget a seulement besoin que :

- tout le monde puisse **lire** `Annuaire`, `Etablissement` et `Evenements` ;
- chaque éditeur puisse **modifier sa propre ligne** de l’`Annuaire` (règle `rec.email == user.Email` → modification autorisée, les autres → refusée, ce qui empêche de cocher à la place d’un autre ; elle peut être limitée aux colonnes `Evenements_presents` et `Evenements_a_confirmer`) ;
- chaque éditeur puisse **ajouter et supprimer des lignes** dans `Participations` (c’est le cas tant qu’aucune règle ne l’interdit).

Si une synchronisation réécrit des lignes entières de l’`Annuaire`, vérifier qu’elle ne vide pas les deux colonnes de présence (elles ne font pas partie des colonnes synchronisées).

## Hébergement
GitHub Pages : *Settings* → *Pages* → *Deploy from a branch* → `main`, dossier `/ (root)`. L’URL du widget est alors `https://<compte>.github.io/<dépôt>/`.

## Changer un nom de table ou de colonne, ou un libellé
- Noms de tables et de colonnes (dont les deux colonnes de présence) : bloc `CONFIG` en haut de `widget.js`.
- Textes des boutons et des compteurs : `LIBELLES`, juste en dessous de `CONFIG`.

## Tester sans Grist
```sh
python3 -m http.server 8000
```
puis ouvrir <http://localhost:8000/dev/>. Le faux Grist reprend la structure des tables ci-dessus et simule des participants (bouton « Un autre participant bouge » pour voir la mise à jour en direct, dans les 5 secondes). Options d’URL : `?moi=2` (autre personne), `?restreint` (l’Annuaire ne montre que sa ligne), `?ambigu` (tous les e-mails lisibles, comme dans le vrai document), `?anonyme` (personne non connectée), `?inconnu` (connecté avec une adresse absente de l’Annuaire), `?sans-declencheur` (`user.Email` ne donne rien : repli sur l’e-mail lisible), `?sans-ajout` (impossible d’ajouter une ligne dans `Participations`), `?sans-colonnes` (les colonnes de présence n’existent pas encore : le widget les crée), `?sans-droits` (… mais la structure n’est pas modifiable), `?ecriture-refusee` (les règles d’accès refusent l’écriture), `?vide` (aucune présence).

## Mettre à jour les événements
Modifier la liste `EVENEMENTS` dans `data/build_xlsx.py` puis `python3 data/build_xlsx.py` (nécessite `openpyxl`), ou modifier directement la table `Evenements` dans Grist : le widget relit les événements chaque minute.

Sources : planning PDF « mise à jour 13-10 » et fiches de <https://www.u-bordeaux.fr/evenements/semaine-de-linnovation-2026-3e-edition>.
