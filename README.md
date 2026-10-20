# Planning de la Semaine de l’innovation 2026 — widget Grist

Widget personnalisé pour [Grist](https://www.getgrist.com) : le planning de la 3e Semaine de l’innovation (23 - 27 novembre 2026, métropole bordelaise), avec, pour chaque événement, les personnes qui comptent y aller (**présent** ou **à confirmer**) et le logo de leur établissement. Les changements des autres apparaissent en direct.

HTML, CSS et JavaScript natifs : la seule dépendance est le script officiel `grist-plugin-api.js`.

| Fichier | Rôle |
| --- | --- |
| `index.html`, `style.css`, `widget.js` | le widget (l’URL à donner à Grist est celle de `index.html`) |
| `assets/logo-semaine-innovation.jpg` | logo tiré du planning officiel |
| `assets/fonts/` | la police Bitter (graisses 400 et 700, licence OFL jointe), servie avec le widget : aucun appel à un service extérieur |
| `data/Evenements_Semaine_Innovation_2026.xlsx` | les 30 séances, à importer dans Grist |
| `data/build_xlsx.py` | génère l’Excel (et les données de test) à partir de la liste des événements |
| `dev/` | faux Grist pour tester dans un navigateur, scripts d’un vrai Grist local et batterie de tests (voir « Tests ») |
| `package.json` | ne sert qu’aux tests (le widget n’a aucune dépendance) |

## Mise en place

1. **Ajouter le widget** : sur une page, *Ajouter un widget* → *Personnalisé*, URL de `index.html` hébergé (voir plus bas), niveau d’accès **Accès complet au document**. Données : la table **`Participations`**. Rien n’est à associer dans le panneau du widget.
2. **L’ouvrir une fois avec un compte propriétaire** : le widget crée lui-même les colonnes de `Participations` (un message « Configuration terminée » s’affiche). Rien à créer à la main, pas de formule à écrire.
3. C’est tout, si les règles d’accès autorisent ce qui est listé dans « Règles d’accès » plus bas (c’est le cas tant qu’aucune règle ne restreint `Participations`).

## Tables Grist

| Table | Rôle | Colonnes utilisées par le widget |
| --- | --- | --- |
| `Evenements` | import de l’Excel | `Jour` (Date), `Debut`, `Fin`, `Titre`, `Sous_titre`, `Type`, `Temps_fort`, `Lieu`, `Ville`, `Adresse`, `Public`, `Cibles` (facultative, voir « Publics visés »), `Description`, `Lien` |
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

`Email` et `Utilisateur` se remplissent seuls à la création de la ligne : le widget ne les écrit pas, donc personne ne peut cocher à la place d’un autre depuis le widget (pour l’empêcher aussi par l’API de Grist, voir « Règles d’accès »). Le logo d’une personne est celui de son établissement, retrouvé par le nom de domaine (sinon par le nom de l’établissement). Le lieu de chaque événement est un lien vers Google Maps (recherche sur l’adresse, sinon sur le lieu et la ville), qui s’ouvre dans un nouvel onglet. Les présences arrivent dans le widget en direct, sans relecture. Dans `Participations`, vous pouvez régler l’affichage de `Evenement` sur `Titre` pour y lire les noms des événements.

**Pourquoi pas dans l’`Annuaire` ?** Si le document déclare un *attribut utilisateur* sur l’`Annuaire` (règles d’accès, par exemple `acl` : `user.Email` → `Annuaire.email`), Grist recharge la page de la personne dès que sa propre ligne de l’`Annuaire` change. Les présences ne passent donc jamais par l’`Annuaire`. Une première version y enregistrait deux colonnes (`Evenements_presents` et `Evenements_a_confirmer`) : si elles existent encore, vous pouvez les supprimer.

## Reconnaître la personne connectée

Grist ne dit pas au widget qui est connecté, mais il le donne aux formules évaluées à la création d’une ligne (`user.Email`). À l’ouverture, le widget ajoute donc une ligne dans `Participations`, lit le résultat des colonnes `Email` et `Utilisateur`, puis la supprime.

- Aucune règle d’accès particulière sur l’e-mail n’est nécessaire : il peut rester lisible par tous dans l’`Annuaire`.
- Si l’adresse de connexion n’est pas dans l’`Annuaire`, le widget affiche cette adresse et passe en lecture seule.
- Repli, si la ligne ne peut pas être ajoutée : le widget prend la ligne de l’`Annuaire` dont l’e-mail est le seul lisible (règle `rec.email == user.Email` sur la colonne `email`). Sinon un message en haut de page donne la raison.
- Colonnes de `Participations` : le widget crée celles qui manquent à la première ouverture par un propriétaire, et recrée `Email` et `Utilisateur` d’une version précédente seulement quand elles sont vides. Il ne supprime jamais une colonne qui contient déjà des valeurs, et retire de lui-même une colonne en double que Grist aurait créée (`Email2`) parce que la vraie lui est masquée par les règles d’accès.

## Règles d’accès

Le widget a seulement besoin que :

- tout le monde puisse **lire** `Annuaire`, `Etablissement`, `Evenements` et `Participations` ;
- chaque éditeur puisse **ajouter et supprimer des lignes** dans `Participations` (c’est le cas tant qu’aucune règle ne l’interdit).

Sans règle sur `Participations`, le widget interdit de cocher à la place d’un autre, mais seulement dans son interface : un éditeur qui appelle l’API de Grist à la main peut écrire l’adresse d’un autre ou modifier et supprimer les présences des autres. Les règles ci-dessous (celles de l’audit de sécurité du 20/10/2026, § 6, testées avec le widget) l’empêchent sans rien changer à l’usage.

**`Participations`** (« Ajouter des règles pour la table », colonnes « Toutes »), cinq lignes dans cet ordre ; ne cocher que les droits indiqués :

| # | Condition | Droits |
| --- | --- | --- |
| 1 | `user.Access in [OWNER]` | R U C D autorisés |
| 2 | `rec.Email == user.Email and newRec.Email == user.Email` | U autorisé |
| 3 | `rec.Email == user.Email` | D autorisé |
| 4 | `newRec.Email == user.Email` | C autorisé |
| 5 | Tous les autres | R autorisé ; U, C, D refusés |

Chacun lit toutes les présences, ne crée que des lignes à son e-mail, ne modifie que les siennes (sans changer l’e-mail) et ne supprime que les siennes. La ligne éphémère de reconnaissance continue de fonctionner.

**`Annuaire`, `Etablissement`, `Evenements`** : propriétaires (`user.Access in [OWNER]`) : tout ; tous les autres : lecture seule. En particulier, supprimer la règle qui laisse chacun modifier sa propre fiche de l’`Annuaire` (`rec.email == user.Email`) : le widget n’y écrit plus, et changer son e-mail permettrait de se faire passer pour une autre personne.

**Attribut utilisateur** (`acl`) : s’il n’est utilisé par aucune règle, le supprimer ; il fait recharger la page d’une personne dès que sa ligne de l’`Annuaire` change.

Le reste (journaux de synchronisation, structure du document, masquer les e-mails, CSP, partage) est dans l’audit de sécurité, § 6 ; les règles ci-dessus sont reprises à l’identique de ses points B, D et E. Les tests (`grist-reel.test.js`) rejouent ces règles dans un vrai Grist.

## Publics visés (filtre « Pour qui ? »)

La colonne facultative `Cibles` de `Evenements` (type **Liste de choix**, choix : `Pédagogie`, `Recherche`, `Étudiants`, `Entreprises`, `Personnels`) range chaque événement dans les publics des quatre plannings imprimés, plus `Personnels` pour la seule séance qu’aucun planning ne vise (le serious game « No wrong door », public du site : personnels administratifs) ; un événement peut avoir plusieurs publics. Une colonne Texte avec des valeurs séparées par des virgules (`Pédagogie, Recherche`) est lue aussi. Les valeurs sont dans `data/build_xlsx.py` (table `CIBLES`, d’après les plannings PDF) et dans l’Excel.

- Une rangée de bulles « Pour qui ? » au-dessus des jours, rien sur les fiches. On coche un ou plusieurs publics : un événement reste affiché s’il concerne l’un d’eux ; aucune bulle cochée, tout le planning. Un jour sans événement pour ce public affiche « Aucun événement pour ce public ce jour-là ».
- Sans colonne `Cibles` (ou si elle est vide), la rangée n’apparaît pas : le widget reste comme avant. Une bulle n’apparaît que si au moins une séance porte ce public : tant que `Personnels` n’est saisi nulle part, la rangée garde ses quatre bulles, exactement comme avant. Un événement sans aucun public n’apparaît que quand aucune bulle n’est cochée.
- Le choix est gardé sur l’appareil (`localStorage`, clé `semaine-innovation-2026:cibles`).
- Noms des bulles et infobulle (qui est concerné) : `CIBLES` dans `widget.js` ; style : `.bulle` dans `style.css`.

## Affichage

- **Participants** : sur chaque carte, un logo par établissement (les trois plus représentés), avec le nombre de personnes quand elles sont plusieurs ; en pointillés quand personne n’est sûr de venir. Le bouton « Participants » déplie la liste (à plat jusqu’à 8 personnes, puis groupée par établissement et limitée à 12 noms avec « Voir les N autres »).
- **Informations pratiques** : le « i » en haut à droite de chaque carte déplie l’adresse (lien vers la carte), le public, la description et le lien vers la fiche du site.
- **Mon choix** : « Présent » et « À confirmer » ; recliquer sur le bouton choisi retire la présence.
- **Écrans** : cinq colonnes dès 1180 px de large, un onglet par jour en dessous, un en-tête réduit dans les petits widgets. Les largeurs se règlent dans `style.css` (`@media`).
- **Messages** : les participants voient un texte simple ; le détail technique (noms de colonnes, réglages) est dans « Détail pour l’administrateur », replié.

## Hébergement
GitHub Pages : *Settings* → *Pages* → *Deploy from a branch* → `main`, dossier `/ (root)`. L’URL du widget est alors `https://<compte>.github.io/<dépôt>/`.

## Sécurité
- Le widget a besoin de l’accès complet au document : le code publié ici s’exécute avec les droits de chaque personne qui ouvre la page, propriétaires compris. Protégez le compte GitHub (double authentification) et ne renommez ni le compte ni le dépôt sans mettre à jour l’adresse dans Grist.
- `index.html` déclare une politique de sécurité (CSP, balise `<meta>`) : seuls ses propres fichiers et le script `https://docs.getgrist.com/grist-plugin-api.js` sont chargés, aucun appel réseau, pas de script ni de style en ligne, images en `https:`. Si vous ajoutez une ressource externe (police, image, script), ou si vous chargez `grist-plugin-api.js` depuis votre propre Grist, adaptez cette balise. Le script de Grist tente d’ajouter une feuille de style en ligne pour son thème : la politique la refuse, sans effet sur le widget (un message dans la console du navigateur).
- Les règles d’accès (section ci-dessus) sont ce qui empêche de modifier les présences des autres : le widget ne les remplace pas.

## Changer un nom de table ou de colonne, ou un libellé
- Noms de tables et de colonnes (dont les deux colonnes de présence) : bloc `CONFIG` en haut de `widget.js`.
- Textes des boutons et des compteurs : `LIBELLES`, juste en dessous de `CONFIG`.

## Tests

La batterie (`npm test`, soit `node --test dev/tests/*.test.js`) a trois étages. Elle demande Node 22 et [Playwright](https://playwright.dev) (`npm install` dans le dépôt, ou `npm install --no-save playwright`) ; `CHROMIUM_PATH` indique un Chromium déjà installé. Le widget lui-même n’a aucune dépendance.

| Étage | Fichier | Ce qu’il vérifie |
| --- | --- | --- |
| Unitaire | `dev/tests/unitaires.test.js` | les fonctions de `widget.js` (lecture des valeurs Grist, dates et heures, références `{ tableId, rowId }`, logos, établissements, participants, regroupements, liens de carte) et la politique de sécurité de `index.html` |
| Faux Grist | `dev/tests/faux-grist.test.js` | l’écran dans un navigateur : jours, filtre, boutons de choix, compteurs, liste des participants, messages d’erreur, toutes les options `?…` ci-dessous |
| Vrai Grist | `dev/tests/grist-reel.test.js` | le widget dans l’image officielle de Grist, avec plusieurs personnes connectées en même temps : première ouverture, enregistrement, doublons et lignes oubliées, mise à jour en direct, règles d’accès d’Antoine (attribut utilisateur `acl`) sans rechargement de la page, règles recommandées ci-dessus (impossible d’écrire à la place d’un autre), lecteur, personne absente de l’Annuaire, logos en pièces jointes, lien de carte, colonne `Email` masquée (aucune colonne en trop, aucune donnée perdue), politique de sécurité (CSP) active |

L’étage « vrai Grist » est ignoré tant que Grist ne répond pas. Pour le lancer (Docker requis, image `gristlabs/grist`) :

```sh
sh dev/grist/serveur.sh   # Grist sur http://127.0.0.1:8484, connexion par simple adresse e-mail
npm run test:grist
```

Chaque test crée son propre document (les 30 événements, 7 personnes, 5 établissements, tables `Annuaire`, `Etablissement`, `Evenements`, `Participations` comme dans le document d’Antoine) et le supprime à la fin. Variables : `GRIST_URL` (par défaut `http://127.0.0.1:8484`). Le script `dev/grist/lib.js` regroupe l’accès à l’API REST de Grist et `dev/grist/document.js` la fabrication du document de test.

## Tester à la main sans Grist
```sh
python3 -m http.server 8000
```
puis ouvrir <http://localhost:8000/dev/>. Le faux Grist reprend la structure des tables ci-dessus et simule des participants (bouton « Un autre participant bouge » pour voir la mise à jour en direct). Options d’URL : `?moi=2` (autre personne), `?restreint` (l’Annuaire ne montre que sa ligne), `?ambigu` (tous les e-mails lisibles, comme dans le vrai document), `?anonyme` (personne non connectée), `?inconnu` (connecté avec une adresse absente de l’Annuaire), `?sans-declencheur` (`user.Email` ne donne rien : repli sur l’e-mail lisible), `?declencheur-casse` (colonnes d’une version précédente, à recréer), `?sans-ajout` (impossible d’ajouter une ligne dans `Participations`), `?sans-colonnes` (les colonnes n’existent pas encore : le widget les crée), `?sans-droits` (… mais la structure n’est pas modifiable), `?ecriture-refusee` (les règles d’accès refusent d’enregistrer une présence), `?vide` (aucune présence), `?foule` (60 personnes de plus inscrites à un événement : liste longue, groupée par établissement), `?orphelines` (lignes de connexion oubliées dans `Participations`), `?doublons` (deux lignes pour le même événement et la même personne).

## Mettre à jour les événements
Modifier la liste `EVENEMENTS` dans `data/build_xlsx.py` puis `python3 data/build_xlsx.py` (nécessite `openpyxl`), ou modifier directement la table `Evenements` dans Grist : le widget relit les événements chaque minute.

Sources : planning PDF « mise à jour 13-10 » et fiches de <https://www.u-bordeaux.fr/evenements/semaine-de-linnovation-2026-3e-edition>.
