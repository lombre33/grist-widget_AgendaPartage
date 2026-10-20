# Planning de la Semaine de l’innovation 2026 — widget Grist

Widget personnalisé pour [Grist](https://www.getgrist.com) : le planning de la 3e Semaine de l’innovation (23 - 27 novembre 2026, métropole bordelaise), avec, pour chaque événement, les personnes qui comptent y aller (**sûr** ou **probable**) et le logo de leur établissement. Les changements des autres apparaissent en direct.

HTML, CSS et JavaScript natifs : la seule dépendance est le script officiel `grist-plugin-api.js`.

| Fichier | Rôle |
| --- | --- |
| `index.html`, `style.css`, `widget.js` | le widget (l’URL à donner à Grist est celle de `index.html`) |
| `assets/logo-semaine-innovation.jpg` | logo tiré du planning officiel |
| `data/Evenements_Semaine_Innovation_2026.xlsx` | les 30 séances, à importer dans Grist |
| `data/build_xlsx.py` | génère l’Excel (et les données de test) à partir de la liste des événements |
| `dev/` | faux Grist pour tester dans un navigateur, sans Grist |

## Mise en place dans Grist

### 1. Table `Evenements`
Importer `data/Evenements_Semaine_Innovation_2026.xlsx` (une feuille : `Evenements`). Vérifier que `Jour` est de type **Date**. Les colonnes (`Jour`, `Debut`, `Fin`, `Titre`, `Sous_titre`, `Type`, `Temps_fort`, `Lieu`, `Ville`, `Adresse`, `Public`, `Description`, `Lien`) sont celles que lit le widget : ne pas les renommer.

### 2. Table `Utilisateurs` (la table ACL)
Une ligne par personne : `Email`, `Nom`, `Prenom`, `Logo` (lien web `https://…` ou colonne Pièces jointes).

Grist ne dit pas au widget qui est connecté. Le widget le déduit de cette table : **chaque personne ne doit y voir que sa propre ligne**. Dans *Règles d’accès* → table `Utilisateurs` : règle `rec.Email == user.Email` → lecture autorisée, et règle par défaut → lecture refusée.

### 3. Table `Presences`
Une ligne par personne et par événement.

| Colonne | Type | Contenu |
| --- | --- | --- |
| `Evenement` | Référence → `Evenements` | rempli par le widget |
| `Utilisateur` | Référence → `Utilisateurs` | rempli par le widget |
| `Statut` | Choix : `sûr`, `probable` | rempli par le widget |
| `Nom` | formule | `$Utilisateur.Nom` |
| `Prenom` | formule | `$Utilisateur.Prenom` |
| `Logo` | formule | `$Utilisateur.Logo` |

Les trois colonnes en formule permettent à tout le monde de voir les noms et logos sans lire la table `Utilisateurs`.

Recommandé : dans les règles d’accès de `Presences`, lecture pour tous, mais création / modification / suppression seulement pour ses propres lignes (`newRec.Utilisateur.Email == user.Email` à la création, `rec.Utilisateur.Email == user.Email` ensuite), pour que personne ne puisse cocher à la place d’un autre.

### 4. Ajouter le widget
1. Sur une page, *Ajouter un widget* → *Personnalisé*.
2. Données : la table **`Presences`** (c’est elle qui arrive en direct dans le widget).
3. URL du widget : celle de `index.html` hébergé (voir plus bas). Niveau d’accès : **Accès complet au document** (le widget lit `Evenements` et `Utilisateurs`).
4. Dans le panneau du widget, associer les six colonnes proposées : Événement, Utilisateur, Statut, Nom, Prénom, Logo.

## Hébergement
GitHub Pages : *Settings* → *Pages* → *Deploy from a branch* → `main`, dossier `/ (root)`. L’URL du widget est alors `https://<compte>.github.io/<dépôt>/`.

## Changer un nom de table ou de colonne
Tout est dans le bloc `CONFIG` en haut de `widget.js` : nom de la table `Utilisateurs`, noms de ses colonnes (`Nom`, `Prenom`, `Logo`), valeurs de statut. Les colonnes de `Presences` se règlent directement dans le panneau du widget, sans toucher au code.

## Tester sans Grist
```sh
python3 -m http.server 8000
```
puis ouvrir <http://localhost:8000/dev/>. Le faux Grist simule des participants (bouton « Un autre participant bouge » pour voir la mise à jour en direct). Options d’URL : `?moi=2` (autre utilisateur), `?anonyme` (personne non reconnue), `?vide` (aucune présence).

## Mettre à jour les événements
Modifier la liste `EVENEMENTS` dans `data/build_xlsx.py` puis `python3 data/build_xlsx.py` (nécessite `openpyxl`), ou modifier directement la table `Evenements` dans Grist : le widget relit les événements chaque minute.

Sources : planning PDF « mise à jour 13-10 » et fiches de <https://www.u-bordeaux.fr/evenements/semaine-de-linnovation-2026-3e-edition>.
