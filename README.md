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

## Tables Grist

| Table | Rôle | Colonnes lues par le widget |
| --- | --- | --- |
| `Evenements` | import de l’Excel | `Jour` (Date), `Debut`, `Fin`, `Titre`, `Sous_titre`, `Type`, `Temps_fort`, `Lieu`, `Ville`, `Adresse`, `Public`, `Description`, `Lien` |
| `Annuaire` | une ligne par personne | `email`, `nom`, `prenom`, `nom_de_domaine`, `Etablissement` (texte) |
| `Etablissement` | un logo par établissement | `Nom_complet`, `nom_de_domaine`, `Logo` (pièce jointe) |
| `Presences` | une ligne par personne et par événement | voir ci-dessous |

### Table `Presences` (à créer)

| Colonne | Type | Contenu |
| --- | --- | --- |
| `Evenement` | Référence → `Evenements` | rempli par le widget |
| `Utilisateur` | Référence → `Annuaire` | rempli par le widget |
| `Statut` | Choix : `présent`, `à confirmer` | rempli par le widget |
| `Nom` | formule | `$Utilisateur.nom` |
| `Prenom` | formule | `$Utilisateur.prenom` |
| `Logo` | formule | voir ci-dessous |

Formule de `Logo` (l’établissement se retrouve par le nom de domaine, sinon par son nom) :

```python
e = Etablissement.lookupOne(nom_de_domaine=$Utilisateur.nom_de_domaine) or Etablissement.lookupOne(Nom_complet=$Utilisateur.Etablissement)
return e.Logo
```

Ces trois colonnes en formule permettent à tout le monde de voir les noms et les logos des autres sans avoir à lire l’`Annuaire`.

### Règles d’accès

- **Reconnaître la personne connectée.** Grist ne dit pas au widget qui est connecté : il le déduit de l’`Annuaire`, où la ligne dont l’e-mail est lisible est la sienne. Il faut donc que `email` ne soit lisible que sur sa propre ligne : règle `rec.email == user.Email` → lecture autorisée, règle par défaut → lecture refusée, soit sur la colonne `email`, soit sur toute la table. Si plusieurs e-mails sont lisibles, ou aucun, le widget passe en lecture seule et l’explique en haut de page.
- **Recommandé, sur `Presences`** : lecture pour tous, mais création / modification / suppression seulement pour ses propres lignes (`newRec.Utilisateur.email == user.Email` à la création, `rec.Utilisateur.email == user.Email` ensuite), pour que personne ne puisse cocher à la place d’un autre.

## Ajouter le widget
1. Sur une page, *Ajouter un widget* → *Personnalisé*.
2. Données : la table **`Presences`** (c’est elle qui arrive en direct dans le widget).
3. URL du widget : celle de `index.html` hébergé (voir plus bas). Niveau d’accès : **Accès complet au document** (le widget lit aussi `Evenements`, `Annuaire` et `Etablissement`).
4. Dans le panneau du widget, associer les six colonnes proposées : Événement, Utilisateur, Statut, Nom, Prénom, Logo.

## Hébergement
GitHub Pages : *Settings* → *Pages* → *Deploy from a branch* → `main`, dossier `/ (root)`. L’URL du widget est alors `https://<compte>.github.io/<dépôt>/`.

## Changer un nom de table ou de colonne, ou un libellé
- Noms de tables et de colonnes : bloc `CONFIG` en haut de `widget.js`. Les colonnes de `Presences` se règlent directement dans le panneau du widget, sans toucher au code.
- Valeurs écrites dans `Statut` : `CONFIG.statuts` (les anciennes valeurs « sûr » et « probable » sont toujours reconnues à la lecture).
- Textes des boutons et des compteurs : `LIBELLES`, juste en dessous de `COLONNES_PRESENCES`.

## Tester sans Grist
```sh
python3 -m http.server 8000
```
puis ouvrir <http://localhost:8000/dev/>. Le faux Grist reprend la structure des tables ci-dessus et simule des participants (bouton « Un autre participant bouge » pour voir la mise à jour en direct). Options d’URL : `?moi=2` (autre personne), `?restreint` (l’Annuaire ne montre que sa ligne), `?ambigu` (tous les e-mails lisibles), `?anonyme` (personne non reconnue), `?vide` (aucune présence).

## Mettre à jour les événements
Modifier la liste `EVENEMENTS` dans `data/build_xlsx.py` puis `python3 data/build_xlsx.py` (nécessite `openpyxl`), ou modifier directement la table `Evenements` dans Grist : le widget relit les événements chaque minute.

Sources : planning PDF « mise à jour 13-10 » et fiches de <https://www.u-bordeaux.fr/evenements/semaine-de-linnovation-2026-3e-edition>.
