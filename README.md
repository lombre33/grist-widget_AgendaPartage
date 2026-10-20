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

1. **Ajouter le widget** : sur une page, *Ajouter un widget* → *Personnalisé*, URL de `index.html` hébergé (voir plus bas), niveau d’accès **Accès complet au document**. Données : n’importe quelle table, par exemple `Participations` : le widget ne lit que les tables ci-dessous, rien n’est à associer dans son panneau.
2. **L’ouvrir une fois avec un compte qui peut modifier la structure du document** : le widget ajoute lui-même à l’`Annuaire` les deux colonnes où sont enregistrées les présences (un toast « Configuration terminée » le confirme). Rien d’autre à créer, pas de formule.
3. **Règles d’accès** : les seules choses que le widget ne peut pas faire à votre place (voir plus bas).

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

## Règles d’accès

- **Reconnaître la personne connectée.** Grist ne dit pas au widget qui est connecté : il le déduit de l’`Annuaire`, où la ligne dont l’e-mail est lisible est la sienne. Il faut donc que `email` ne soit lisible que sur sa propre ligne : règle `rec.email == user.Email` → lecture autorisée, règle par défaut → lecture refusée, soit sur la colonne `email`, soit sur toute la table. Si plusieurs e-mails sont lisibles, ou aucun, le widget passe en lecture seule et l’explique en haut de page.
- **Écrire sa présence, uniquement la sienne.** Sur la table `Annuaire`, une règle sur les colonnes `Evenements_presents` et `Evenements_a_confirmer` : `rec.email == user.Email` → modification autorisée, règle par défaut → modification refusée. Ainsi personne ne peut cocher à la place d’un autre.
- **Lire celles des autres.** Les deux colonnes (et `nom`, `prenom`, `nom_de_domaine`, `Etablissement`) doivent rester lisibles par tout le monde.
- Si une synchronisation réécrit des lignes entières de l’`Annuaire`, vérifier qu’elle ne vide pas ces deux colonnes (elles ne font pas partie des colonnes synchronisées).

## Hébergement
GitHub Pages : *Settings* → *Pages* → *Deploy from a branch* → `main`, dossier `/ (root)`. L’URL du widget est alors `https://<compte>.github.io/<dépôt>/`.

## Changer un nom de table ou de colonne, ou un libellé
- Noms de tables et de colonnes (dont les deux colonnes de présence) : bloc `CONFIG` en haut de `widget.js`.
- Textes des boutons et des compteurs : `LIBELLES`, juste en dessous de `CONFIG`.

## Tester sans Grist
```sh
python3 -m http.server 8000
```
puis ouvrir <http://localhost:8000/dev/>. Le faux Grist reprend la structure des tables ci-dessus et simule des participants (bouton « Un autre participant bouge » pour voir la mise à jour en direct, dans les 5 secondes). Options d’URL : `?moi=2` (autre personne), `?restreint` (l’Annuaire ne montre que sa ligne), `?ambigu` (tous les e-mails lisibles), `?anonyme` (personne non reconnue), `?sans-colonnes` (les colonnes de présence n’existent pas encore : le widget les crée), `?sans-droits` (… mais la structure n’est pas modifiable), `?ecriture-refusee` (les règles d’accès refusent l’écriture), `?vide` (aucune présence).

## Mettre à jour les événements
Modifier la liste `EVENEMENTS` dans `data/build_xlsx.py` puis `python3 data/build_xlsx.py` (nécessite `openpyxl`), ou modifier directement la table `Evenements` dans Grist : le widget relit les événements chaque minute.

Sources : planning PDF « mise à jour 13-10 » et fiches de <https://www.u-bordeaux.fr/evenements/semaine-de-linnovation-2026-3e-edition>.
