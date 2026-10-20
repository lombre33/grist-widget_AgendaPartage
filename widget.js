'use strict';

/* ============================================================================
   Planning de la Semaine de l’innovation 2026 — widget personnalisé Grist
   Aucune dépendance autre que grist-plugin-api.js.

   Tables Grist utilisées :
   - Evenements     : import de l’Excel fourni (data/Evenements_Semaine_Innovation_2026.xlsx)
   - Annuaire       : une ligne par personne (nom, prénom, e-mail, établissement), en lecture seule ;
                      elle ne doit surtout pas recevoir les présences (voir README : attribut utilisateur)
   - Etablissement  : le logo de chaque établissement
   - Participations : la table à laquelle le widget est lié, une ligne par présence. Le widget y crée
                      lui-même ses colonnes à la première ouverture ; les présences lui arrivent en direct.
   ============================================================================ */

/* ----------------------------------------------------------------------------
   CONFIGURATION — le seul endroit à modifier si un nom de table ou de colonne change
   ---------------------------------------------------------------------------- */
const CONFIG = {
  tables: {
    evenements: 'Evenements',
    annuaire: 'Annuaire',
    etablissements: 'Etablissement',
  },
  // Colonnes de la table Evenements : les en-têtes de l’Excel fourni, rien à changer.
  evenements: {
    jour: 'Jour', debut: 'Debut', fin: 'Fin', titre: 'Titre', sousTitre: 'Sous_titre',
    type: 'Type', tempsFort: 'Temps_fort', lieu: 'Lieu', ville: 'Ville',
    adresse: 'Adresse', public: 'Public', cibles: 'Cibles', description: 'Description', lien: 'Lien',
  },
  // Table liée au widget : une ligne par présence. Le widget y crée les colonnes ci-dessous si elles manquent.
  participations: {
    table: 'Participations',
    evenement: 'Evenement',              // Référence → Evenements
    statut: 'Statut',                    // Choix : présent / à confirmer
    email: 'Email',                      // formule « à la création » : user.Email, l’e-mail de la personne qui coche
    utilisateur: 'Utilisateur',          // formule : la ligne de l’Annuaire qui a cet e-mail
  },
  // Valeurs écrites dans la colonne « Statut » (les anciennes valeurs « sûr » et « probable » sont toujours lues).
  statuts: { sur: 'présent', probable: 'à confirmer' },
  // Colonnes de la table Annuaire.
  annuaire: {
    email: 'email',                      // rapproché de l’e-mail de connexion (voir identifierMoi)
    nom: 'nom',
    prenom: 'prenom',
    domaine: 'nom_de_domaine',           // lien avec l’établissement (en priorité)
    etablissement: 'Etablissement',      // texte : lien avec l’établissement, si le domaine ne suffit pas
  },
  // Colonnes de la table Etablissement.
  etablissements: {
    nom: 'Nom_complet',
    acronyme: 'Acronyme',                // initiales affichées quand l’établissement n’a pas de logo
    domaine: 'nom_de_domaine',
    logo: 'Logo',                        // colonne Pièces jointes, ou lien web (https://…)
  },
  // Les événements, l’Annuaire et les logos changent rarement : on les relit à cet intervalle
  // (les présences, elles, arrivent en direct).
  rafraichissementMs: 60000,
};

/* Libellés affichés (les codes internes restent « sur » et « probable »). */
const LIBELLES = {
  sur:      { bouton: '✓ Présent',     badge: 'Présent',     resume: ['présent', 'présents'] },
  probable: { bouton: '? À confirmer', badge: 'À confirmer', resume: ['à confirmer', 'à confirmer'] },
};

/* Publics visés : les quatre publics des plannings imprimés, plus les personnels (séances qu’aucun planning ne vise), saisis dans la colonne
   « Cibles » de Evenements (liste de choix). La rangée de bulles « Pour qui ? » n’apparaît que si cette colonne existe et contient au moins
   une valeur, et une bulle n’apparaît que si une séance au moins la porte. */
const CIBLES = [
  { code: 'pedagogie',   libelle: 'Pédagogie',   qui: 'enseignants-chercheurs et professionnels de la formation et de la transformation pédagogique' },
  { code: 'recherche',   libelle: 'Recherche',   qui: 'enseignants-chercheurs, chercheurs, doctorants' },
  { code: 'etudiants',   libelle: 'Étudiants',   qui: 'étudiants' },
  { code: 'entreprises', libelle: 'Entreprises', qui: 'acteurs socio-économiques' },
  { code: 'personnels',  libelle: 'Personnels',  qui: 'personnels administratifs' },
];

/* Numéro de version, affiché en bas de page : il permet de vérifier quelle version Grist a chargée (cache du navigateur). */
const VERSION = '2026-10-20 · n';

const JOURS_SEMAINE = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/* ----------------------------------------------------------------------------
   État
   ---------------------------------------------------------------------------- */
const etat = {
  evenements: [],              // lus dans la table Evenements
  etablissements: [],          // lignes de la table Etablissement
  logos: { parDomaine: new Map(), parNom: new Map() },   // index des logos, construit au chargement
  annuaire: [],                // une entrée par personne : { id, nom, prenom, domaine, etablissement, email }
  lignes: [],                  // présences lues en direct dans Participations : { id, evenement, utilisateur, statut }
  lignesVides: [],             // lignes de Participations sans événement ni statut (lignes de connexion restées là)
  presences: [],               // ces présences, avec le nom, le prénom et le logo de la personne
  erreurAnnuaire: '',          // l’Annuaire n’a pas pu être lu
  connexion: null,             // { email, personne } : e-mail de connexion et ligne de l’Annuaire correspondante, null si indisponible
  detailConnexion: '',         // pourquoi la reconnaissance par la connexion n’a pas abouti (affiché en cas de problème)
  moi: null,                   // { id, nom, prenom, logo } : ma ligne dans l’Annuaire
  messageMoi: '',              // pourquoi moi est vide (mode lecture seule)
  erreurColonnes: '',          // colonnes de Participations absentes et impossibles à créer
  erreur: '',                  // problème de lecture de la table Evenements
  pret: false,                 // vrai dès que le premier chargement est terminé
  focus: null,                 // élément à refocaliser après un nouvel affichage
  choixEnCours: new Map(),     // evenementId -> { statut, ecrit, quand } : mon choix jusqu’à sa confirmation par Participations
  verrous: new Set(),          // evenements dont l’écriture est en cours
  jour: null,                  // onglet affiché (écrans étroits)
  seulementMesEvenements: false,
  cibles: new Set(),           // codes des publics cochés dans « Pour qui ? » (aucun : tous les événements)
  ouverts: new Set(),          // evenements dont la liste des participants est dépliée
  infos: new Set(),            // evenements dont les informations pratiques sont dépliées
  toutVoir: new Set(),         // evenements dont la longue liste des participants est affichée en entier
  jeton: null,                 // { token, baseUrl, expire } pour les logos en pièce jointe
};

const el = (id) => document.getElementById(id);

/* ----------------------------------------------------------------------------
   Petits utilitaires de lecture des valeurs Grist
   ---------------------------------------------------------------------------- */
// Une cellule masquée par les règles d’accès arrive sous la forme ['C'] : elle compte comme vide.
const texte = (v) => (v == null || Array.isArray(v) ? '' : String(v)).trim();

const echapper = (v) => texte(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sansAccent = (v) => texte(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Numéro de ligne d'une référence (colonne « Ref: ») : un nombre avec fetchTable, mais un objet
 * { tableId, rowId } avec onRecords (ou ['R', table, numéro] si les valeurs restent encodées).
 */
function idLigne(v) {
  const id = Array.isArray(v) ? v[2] : v && typeof v === 'object' ? v.rowId : v;
  return Number(id) || 0;
}

/** Les listes Grist arrivent soit en tableau simple, soit encodées ['L', a, b]. */
const liste = (v) => (Array.isArray(v) ? (v[0] === 'L' ? v.slice(1) : v) : []);

/** Code d’un public à partir de son libellé (sans tenir compte des accents ni des majuscules) ; null s’il est inconnu. */
function codeCible(v) {
  const s = sansAccent(v);
  if (/^pedagog/.test(s)) return 'pedagogie';
  if (/^recherch/.test(s)) return 'recherche';
  if (/^etudiant/.test(s)) return 'etudiants';
  if (/^(entreprise|acteurs? socio)/.test(s)) return 'entreprises';
  if (/^personnel/.test(s)) return 'personnels';
  return null;
}

/** Colonne « Cibles » : liste de choix (['L', 'a', 'b'] ou tableau) ou, si elle est restée en texte, valeurs séparées par des virgules. */
function lireCibles(v) {
  const trouvees = new Set((Array.isArray(v) ? liste(v) : texte(v).split(/[,;|\n]/)).map(codeCible));
  return CIBLES.map((c) => c.code).filter((code) => trouvees.has(code));
}

const urlSure = (v) => (/^https?:\/\//i.test(texte(v)) ? texte(v) : '');

function codeStatut(v) {
  const s = sansAccent(v);
  if (/^(present|sur)/.test(s)) return 'sur';
  if (/^(a confirmer|prob)/.test(s)) return 'probable';
  return null;
}

/** Date Grist (secondes depuis 1970, objet Date ou texte) -> 'AAAA-MM-JJ'. */
function versIso(v) {
  if (typeof v === 'number' || v instanceof Date) {
    const ms = v instanceof Date ? v.getTime() : v * 1000;
    // +12 h : donne le bon jour que la date soit à minuit UTC ou à minuit heure de Paris
    return new Date(ms + 12 * 3600 * 1000).toISOString().slice(0, 10);
  }
  const s = texte(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

/** Date du jour dans le fuseau de l’appareil, 'AAAA-MM-JJ' (toISOString donnerait la date UTC : la veille juste après minuit). */
function aujourdhuiIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** '09:30', '9h30' ou fraction de jour (heure Excel) -> { h, m }. */
function versHeure(v) {
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const minutes = Math.round(v * 1440);
    return { h: Math.floor(minutes / 60), m: minutes % 60 };
  }
  const m = /^(\d{1,2})\s*[:hH]\s*(\d{2})?/.exec(texte(v));
  return m ? { h: Number(m[1]), m: Number(m[2] || 0) } : null;
}

/** Lien de recherche Google Maps (sans clé d’API) : l’adresse si elle est connue, sinon le lieu et la ville. */
function lienCarte(e) {
  const recherche = e.adresse || [e.lieu, e.ville].filter(Boolean).join(', ');
  return recherche ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(recherche)}` : '';
}

const ICONE_LIEU = '<svg class="evt__epingle" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>';

const NBSP = ' ';
const formaterHeure = ({ h, m }) => (m ? `${h}${NBSP}h${NBSP}${String(m).padStart(2, '0')}` : `${h}${NBSP}h`);
const minutesDe = (t) => (t ? t.h * 60 + t.m : 99 * 60);

/** Colonnes-tableaux renvoyées par docApi.fetchTable -> liste de lignes. */
function lignesDeTable(table) {
  const colonnes = Object.keys(table);
  return table.id.map((id, i) => Object.fromEntries(colonnes.map((c) => [c, table[c][i]])));
}

/* ----------------------------------------------------------------------------
   Chargement des données
   ---------------------------------------------------------------------------- */
function normaliserEvenement(r) {
  const c = CONFIG.evenements;
  return {
    id: r.id,
    jour: versIso(r[c.jour]),
    debut: versHeure(r[c.debut]),
    fin: versHeure(r[c.fin]),
    titre: texte(r[c.titre]),
    sousTitre: texte(r[c.sousTitre]),
    type: texte(r[c.type]),
    tempsFort: texte(r[c.tempsFort]),
    lieu: texte(r[c.lieu]),
    ville: texte(r[c.ville]),
    adresse: texte(r[c.adresse]),
    public: texte(r[c.public]),
    cibles: lireCibles(r[c.cibles]),
    description: texte(r[c.description]),
    lien: urlSure(r[c.lien]),
  };
}

async function chargerEvenements() {
  try {
    const lignes = lignesDeTable(await grist.docApi.fetchTable(CONFIG.tables.evenements));
    etat.evenements = lignes
      .map(normaliserEvenement)
      .filter((e) => e.jour && e.titre)
      .sort((a, b) => a.jour.localeCompare(b.jour) || minutesDe(a.debut) - minutesDe(b.debut) || minutesDe(a.fin) - minutesDe(b.fin) || a.id - b.id);
    const jours = joursDuPlanning();
    if (!jours.includes(etat.jour)) {
      const aujourdhui = aujourdhuiIso();
      etat.jour = jours.includes(aujourdhui) ? aujourdhui : jours[0] || null;
    }
    etat.erreur = '';
  } catch (err) {
    console.error(err);
    etat.erreur = `Impossible de lire la table « ${CONFIG.tables.evenements} ». Vérifiez son nom (CONFIG.tables.evenements) et les droits d’accès.`;
  }
  rendre();
}

/** Logos des établissements, indexés par nom de domaine puis par nom (une seule normalisation par ligne). */
async function chargerEtablissements() {
  try {
    const e = CONFIG.etablissements;
    etat.etablissements = lignesDeTable(await grist.docApi.fetchTable(CONFIG.tables.etablissements));
    etat.logos = { parDomaine: new Map(), parNom: new Map() };
    for (const l of etat.etablissements) {
      const domaine = sansAccent(l[e.domaine]);
      const nom = sansAccent(l[e.nom]);
      const fiche = { cle: domaine || nom, nom: texte(l[e.nom]), acronyme: texte(l[e.acronyme]), logo: l[e.logo] };
      if (domaine && !etat.logos.parDomaine.has(domaine)) etat.logos.parDomaine.set(domaine, fiche);
      if (nom && !etat.logos.parNom.has(nom)) etat.logos.parNom.set(nom, fiche);
    }
  } catch (err) {
    console.error('Logos des établissements indisponibles', err);
  }
  if (etat.pret) {   // les logos viennent de changer : on met à jour les avatars déjà affichés
    appliquerDonnees();
    await preparerJeton(tousLesLogos());
    rendre();
  }
}

/** Logo de l’établissement d’une personne de l’Annuaire : par nom de domaine, sinon par nom. */
function trouverLogo(personne) {
  const { parDomaine, parNom } = etat.logos;
  return parDomaine.get(sansAccent(personne.domaine))?.logo ?? parNom.get(sansAccent(personne.etablissement))?.logo ?? null;
}

/** Établissement d’une personne : { cle, nom, acronyme }, pour regrouper les participants (la fiche de l’établissement, sinon le texte de l’Annuaire). */
function trouverEtablissement(personne) {
  const { parDomaine, parNom } = etat.logos;
  const fiche = parDomaine.get(sansAccent(personne.domaine)) ?? parNom.get(sansAccent(personne.etablissement));
  if (fiche) return fiche;
  const nom = personne.etablissement || personne.domaine;
  return { cle: sansAccent(nom), nom, acronyme: '' };
}

/** Annuaire (colonnes-tableaux renvoyées par Grist) -> liste de personnes. */
function lirePersonnes(table) {
  const c = CONFIG.annuaire;
  return lignesDeTable(table).map((l) => ({
    id: l.id,
    nom: texte(l[c.nom]),
    prenom: texte(l[c.prenom]),
    domaine: texte(l[c.domaine]),
    etablissement: texte(l[c.etablissement]),
    email: texte(l[c.email]),
  }));
}

/** Formule de la colonne « Utilisateur » de Participations : la personne de l’Annuaire qui a l’e-mail de connexion. */
const FORMULE_PERSONNE = [
  `mail = ($${CONFIG.participations.email} or "").strip().lower()`,
  `return next((p for p in ${CONFIG.tables.annuaire}.all if mail and (p.${CONFIG.annuaire.email} or "").strip().lower() == mail), None)`,
].join('\n');

/**
 * Les colonnes de Participations. `recalcWhen: 0` + une formule = « formule à la création » : la colonne
 * est calculée à la création de la ligne (la valeur 1 la désactiverait).
 * Avec `reparer`, « Email » et « Utilisateur » sont recréées (une version précédente les créait mal),
 * mais seulement s’il n’y a rien à perdre : jamais quand l’une des deux contient déjà des valeurs.
 */
async function installerColonnes(existante, reparer) {
  const c = CONFIG.participations;
  const definitions = {
    [c.email]: { type: 'Text', isFormula: false, formula: 'user.Email', recalcWhen: 0, label: 'E-mail de connexion' },
    [c.utilisateur]: { type: `Ref:${CONFIG.tables.annuaire}`, isFormula: true, formula: FORMULE_PERSONNE, label: 'Personne' },
    [c.evenement]: { type: `Ref:${CONFIG.tables.evenements}`, isFormula: false, label: 'Événement' },
    [c.statut]: { type: 'Choice', isFormula: false, widgetOptions: JSON.stringify({ choices: Object.values(CONFIG.statuts) }), label: 'Statut' },
  };
  const aRecreer = reparer && rienAPerdre(existante) ? [c.email, c.utilisateur] : [];
  const actions = aRecreer.filter((nom) => nom in existante).reverse().map((nom) => ['RemoveColumn', c.table, nom]);
  for (const [nom, definition] of Object.entries(definitions)) {
    if (!(nom in existante) || aRecreer.includes(nom)) actions.push(['AddColumn', c.table, nom, definition]);
  }
  if (!actions.length) return;
  const { retValues = [] } = (await grist.docApi.applyUserActions(actions)) || {};
  // Une colonne que Grist a dû renommer (« Email2 ») existait déjà sans que le widget la voie (par exemple masquée
  // par les règles d’accès) : on retire ce doublon, qui ne servirait à rien.
  const doublons = actions.flatMap((a, i) => (a[0] === 'AddColumn' && retValues[i] && retValues[i].colId && retValues[i].colId !== a[2]
    ? [['RemoveColumn', c.table, retValues[i].colId]] : []));
  if (doublons.length) {
    console.warn('Colonnes déjà existantes mais invisibles pour cette personne : doublons retirés', doublons.map((a) => a[2]));
    await grist.docApi.applyUserActions(doublons);
  }
}

/**
 * Vrai si « Email » et « Utilisateur » de Participations ne contiennent encore aucune valeur.
 * Une valeur masquée par les règles d’accès (reçue sous forme de liste, ['C']) compte comme un contenu.
 */
function rienAPerdre(existante) {
  const c = CONFIG.participations;
  return ![c.email, c.utilisateur].some((nom) => (existante[nom] || []).some((v) => v != null && v !== '' && v !== 0));
}

const CONNEXION_INTROUVABLE = 'ligne de connexion introuvable';

/** Ajoute une ligne dans Participations, lit ce que les formules y ont écrit, puis la supprime. */
async function lireConnexion() {
  const c = CONFIG.participations;
  let id = null;
  try {
    id = (await grist.docApi.applyUserActions([['AddRecord', c.table, null, {}]])).retValues[0];
    const lues = await grist.docApi.fetchTable(c.table);
    const i = lues.id.indexOf(id);
    if (i < 0) throw new Error(CONNEXION_INTROUVABLE);
    return { email: texte(lues[c.email][i]), personne: idLigne(lues[c.utilisateur][i]) };
  } finally {
    if (id != null) await grist.docApi.applyUserActions([['RemoveRecord', c.table, id]]).catch((err) => console.warn('Ligne de connexion non supprimée', err));
  }
}

/**
 * Qui suis-je ? Grist n’indique pas l’utilisateur au widget, mais il le donne aux formules évaluées
 * à la création d’une ligne (`user.Email`). Le widget ajoute donc une ligne dans Participations :
 * la colonne « Email » reçoit l’e-mail de connexion, la colonne « Utilisateur » la personne correspondante de
 * l’Annuaire. Il lit ce résultat puis supprime la ligne : aucune règle d’accès particulière n’est nécessaire.
 */
async function identifierParConnexion(existante) {
  const c = CONFIG.participations;
  try {
    // Si ma ligne a été supprimée entre-temps (autre fenêtre ouverte au même moment), on recommence une fois
    const lire = () => lireConnexion().catch((err) => (err && err.message === CONNEXION_INTROUVABLE ? lireConnexion() : Promise.reject(err)));
    let connexion = await lire();
    if (!connexion.email && c.email in existante && rienAPerdre(existante)) {
      // Colonnes déjà là mais e-mail vide : elles ont sans doute été créées sans déclenchement. On les recrée une fois
      // (jamais si elles contiennent déjà des valeurs : ce serait les perdre).
      await installerColonnes(existante, true);
      connexion = await lire();
    }
    etat.connexion = connexion;
    etat.detailConnexion = connexion.email ? '' : 'adresse de connexion vide';
  } catch (err) {
    console.warn(`Reconnaissance par la table « ${c.table} » impossible`, err);
    etat.connexion = null;
    etat.detailConnexion = `erreur : ${texte(err && err.message).slice(0, 120) || 'inconnue'}`;
  }
}

/** Premier contact avec Participations : crée les colonnes qui manquent, puis reconnaît la personne connectée. */
async function preparerParticipations() {
  const c = CONFIG.participations;
  let existante;
  try {
    existante = await grist.docApi.fetchTable(c.table);
  } catch (err) {
    console.error(err);
    etat.erreurColonnes = `Table « ${c.table} » introuvable : le widget doit être lié à cette table.`;
    etat.connexion = null;
    return;
  }
  const voulues = [c.email, c.utilisateur, c.evenement, c.statut];
  if (voulues.some((nom) => !(nom in existante))) {
    try {
      await installerColonnes(existante, false);
      existante = await grist.docApi.fetchTable(c.table);
      alerter(`Configuration terminée : colonnes ajoutées à la table « ${c.table} ».`);
    } catch (err) {
      console.warn('Création des colonnes impossible', err);
    }
  }
  const manquantes = [c.evenement, c.statut].filter((nom) => !(nom in existante));
  etat.erreurColonnes = manquantes.length
    ? `Il manque ${manquantes.length > 1 ? 'les colonnes' : 'la colonne'} ${manquantes.join(', ')} dans la table « ${c.table} », et le widget n’a pas pu ${manquantes.length > 1 ? 'les créer' : 'la créer'} : ouvrez-le une fois avec un compte qui peut modifier la structure du document.`
    : '';
  await identifierParConnexion(existante);
}

/** Qui suis-je, parmi les personnes de l’Annuaire ? D’abord par l’e-mail de connexion, sinon (repli) par l’e-mail lisible. */
function identifierMoi() {
  const definir = (p, logo) => { etat.moi = { id: p.id, nom: p.nom, prenom: p.prenom, logo }; etat.messageMoi = ''; };
  if (etat.erreurAnnuaire) {
    etat.moi = null;
    etat.messageMoi = etat.erreurAnnuaire;
    return undefined;
  }
  const connexion = etat.connexion;
  if (connexion && connexion.email) {
    const p = etat.annuaire.find((x) => x.id === connexion.personne);
    if (p) return definir(p, trouverLogo(p));
    etat.moi = null;
    etat.messageMoi = `Votre adresse de connexion (${connexion.email}) n’est pas dans la table « ${CONFIG.tables.annuaire} » : demandez à y être ajouté(e) pour indiquer votre présence.`;
    return undefined;
  }
  // Repli : une règle d’accès peut réserver la colonne e-mail de l’Annuaire à sa propre ligne
  // (`rec.email == user.Email`) ; la ligne dont l’e-mail est lisible est alors la mienne.
  const miennes = etat.annuaire.filter((p) => p.email);
  if (miennes.length === 1) return definir(miennes[0], trouverLogo(miennes[0]));
  etat.moi = null;
  etat.messageMoi = miennes.length
    ? `Impossible de vous reconnaître (${etat.detailConnexion || 'e-mail de connexion indisponible'}). Ouvrez le widget une fois avec un compte propriétaire et vérifiez que les éditeurs peuvent modifier la table « ${CONFIG.participations.table} ».`
    : 'Vous n’êtes pas reconnu(e) : connectez-vous avec votre compte pour indiquer votre présence.';
  return undefined;
}

/** Moi + les présences de Participations, complétées du nom, du prénom et du logo (par l’établissement) de chaque personne. */
function appliquerDonnees() {
  identifierMoi();
  const personnes = new Map(etat.annuaire.map((p) => [p.id, { ...p, logo: trouverLogo(p), etab: trouverEtablissement(p) }]));
  etat.presences = [];
  for (const l of etat.lignes) {
    const p = personnes.get(l.utilisateur);
    if (p) etat.presences.push({ ...l, nom: p.nom, prenom: p.prenom, logo: p.logo, etab: p.etab });
  }
}

const tousLesLogos = () => etat.presences.map((p) => p.logo).concat(etat.moi ? [etat.moi.logo] : []);

/** Pied de page : la version du widget et ce que Participations contient vraiment (pour vérifier que les choix y arrivent). */
function majPied(nbLignes) {
  const lignes = nbLignes == null ? '' : ` · ${nombre(nbLignes, ['ligne', 'lignes'])} dans « ${CONFIG.participations.table} »`;
  el('version').textContent = `Version ${VERSION}${lignes}`;
}

/** Retient les lignes de Participations ({ id, evenement, utilisateur, statut }) : les présences d’un côté, les lignes de connexion de l’autre. */
function memoriserLignes(lues) {
  etat.lignes = lues.filter((l) => l.evenement && l.statut);   // les lignes de connexion (sans événement) ne sont pas des présences
  etat.lignesVides = lues.filter((l) => !l.evenement && !l.statut);
}

/** Présences de Participations, en direct : Grist rappelle cette fonction à chaque changement de la table. */
function recevoirPresences(enregistrements) {
  const c = CONFIG.participations;
  majPied(enregistrements.length);
  memoriserLignes(enregistrements.map((r) => ({ id: r.id, evenement: idLigne(r[c.evenement]), utilisateur: idLigne(r[c.utilisateur]), statut: codeStatut(r[c.statut]) })));
  appliquerDonnees();
  confirmerMesChoix();
  preparerJeton(tousLesLogos()).then((nouveau) => nouveau && rendre());
  rendre();
}

/** Lit l’Annuaire (noms, prénoms, établissements). */
async function chargerAnnuaire() {
  try {
    etat.annuaire = lirePersonnes(await grist.docApi.fetchTable(CONFIG.tables.annuaire));
    etat.erreurAnnuaire = '';
  } catch (err) {
    console.error(err);
    if (etat.pret) return;   // panne passagère : on garde ce qui est affiché
    etat.annuaire = [];
    etat.erreurAnnuaire = `Table « ${CONFIG.tables.annuaire} » inaccessible : identification impossible.`;
  }
  appliquerDonnees();
  await preparerJeton(tousLesLogos());   // avant l’affichage des logos en pièce jointe
  rendre();
}

/* ----------------------------------------------------------------------------
   Logos : lien web ou pièce jointe Grist
   ---------------------------------------------------------------------------- */
async function preparerJeton(logos) {
  const besoin = logos.some((v) => typeof v !== 'string' && liste(v).some((x) => typeof x === 'number'));
  if (!besoin || (etat.jeton && etat.jeton.expire > Date.now() + 60000)) return false;
  try {
    const { token, baseUrl, ttlMsecs } = await grist.docApi.getAccessToken({ readOnly: true });
    etat.jeton = { token, baseUrl, expire: Date.now() + (ttlMsecs || 600000) };
    return true;
  } catch (err) {
    console.error('Jeton d’accès aux pièces jointes indisponible', err);
    return false;
  }
}

function logoSrc(v) {
  if (typeof v === 'string') return /^(https?:\/\/|data:image\/)/i.test(v.trim()) ? v.trim() : '';
  const id = liste(v).find((x) => typeof x === 'number');
  return id && etat.jeton ? `${etat.jeton.baseUrl}/attachments/${id}/download?auth=${encodeURIComponent(etat.jeton.token)}` : '';
}

/* ----------------------------------------------------------------------------
   Présences : calcul à partir des données
   ---------------------------------------------------------------------------- */
/** Mon statut tel qu’il est enregistré dans Participations. */
function statutEnregistre(evenementId) {
  if (!etat.moi) return null;
  const miennes = etat.presences.filter((p) => p.evenement === evenementId && p.utilisateur === etat.moi.id);
  return miennes.some((p) => p.statut === 'sur') ? 'sur' : miennes.length ? 'probable' : null;
}

/** Mon statut affiché : mon dernier clic, sans attendre que Participations le confirme. */
function monStatut(evenementId) {
  if (!etat.moi) return null;
  return etat.choixEnCours.has(evenementId) ? etat.choixEnCours.get(evenementId).statut : statutEnregistre(evenementId);
}

/** Participants d’un événement, présents d’abord, moi inclus avec mon choix à jour. */
function participantsDe(evenementId) {
  const parPersonne = new Map();
  for (const p of etat.presences) {
    if (p.evenement !== evenementId) continue;
    if (etat.moi && p.utilisateur === etat.moi.id) continue;
    const cle = p.utilisateur || `${p.prenom}|${p.nom}`;
    const deja = parPersonne.get(cle);
    if (!deja || (deja.statut === 'probable' && p.statut === 'sur')) parPersonne.set(cle, { ...p, moi: false });
  }
  const mien = monStatut(evenementId);
  if (mien) parPersonne.set('moi', { ...etat.moi, etab: etablissementDeMoi(), statut: mien, moi: true });
  const rang = { sur: 0, probable: 1 };
  return [...parPersonne.values()].sort((a, b) => rang[a.statut] - rang[b.statut] || Number(b.moi) - Number(a.moi)
    || a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr'));
}

/** Mon établissement (celui de ma ligne dans l’Annuaire). */
function etablissementDeMoi() {
  const p = etat.annuaire.find((x) => x.id === etat.moi.id);
  return p ? trouverEtablissement(p) : { cle: '', nom: '', acronyme: '' };
}

/** Participants regroupés par établissement, les plus nombreux d’abord. */
function groupesDe(gens) {
  const groupes = new Map();
  for (const p of gens) {
    if (!groupes.has(p.etab.cle)) groupes.set(p.etab.cle, { etab: p.etab, logo: p.logo, sur: 0, probable: 0, gens: [] });
    const g = groupes.get(p.etab.cle);
    g[p.statut] += 1;
    g.gens.push(p);
  }
  return [...groupes.values()].sort((a, b) => b.gens.length - a.gens.length || a.etab.nom.localeCompare(b.etab.nom, 'fr'));
}

/** Espaces insécables avant « : ; ! ? » et autour des guillemets français, pour éviter les retours à la ligne orphelins. */
const typo = (v) => echapper(v).replace(/ ([:;!?»])/g, `${NBSP}$1`).replace(/« /g, `«${NBSP}`);

const nomComplet = (p) => `${p.prenom} ${p.nom}`.trim();

/** Écrit mon choix dans Participations : une ligne par événement, créée, modifiée ou supprimée (doublons éventuels compris). */
async function ecrirePresence(evenementId, cible) {
  const c = CONFIG.participations;
  const miennes = etat.lignes.filter((l) => l.evenement === evenementId && l.utilisateur === etat.moi.id);
  const [gardee, ...doublons] = miennes;
  const actions = [];
  // Ménage : mes lignes de connexion restées là (page fermée avant leur suppression) ne servent plus à rien
  const restes = etat.lignesVides.filter((l) => l.utilisateur === etat.moi.id).map((l) => l.id);
  if (restes.length) actions.push(['BulkRemoveRecord', c.table, restes]);
  if (!cible) {
    if (miennes.length) actions.push(['BulkRemoveRecord', c.table, miennes.map((l) => l.id)]);
  } else if (gardee) {
    actions.push(['UpdateRecord', c.table, gardee.id, { [c.statut]: CONFIG.statuts[cible] }]);
    if (doublons.length) actions.push(['BulkRemoveRecord', c.table, doublons.map((l) => l.id)]);
  } else {
    // « Email » et « Utilisateur » se remplissent seuls (formule à la création) : impossible de cocher pour quelqu’un d’autre
    actions.push(['AddRecord', c.table, null, { [c.evenement]: evenementId, [c.statut]: CONFIG.statuts[cible] }]);
  }
  if (actions.length) await grist.docApi.applyUserActions(actions);
}

/** Relit Participations après une écriture : la ligne doit y être, à mon nom, avec le bon statut (sinon on le dit, avec la raison). */
async function verifierEcriture(evenementId, cible) {
  const c = CONFIG.participations;
  const t = await grist.docApi.fetchTable(c.table);
  const colonne = (nom) => t[nom] || [];
  const lues = t.id.map((id, i) => ({ id, evenement: idLigne(colonne(c.evenement)[i]), utilisateur: idLigne(colonne(c.utilisateur)[i]), statut: codeStatut(colonne(c.statut)[i]) }));
  // La prochaine action part de ce qui est vraiment enregistré, sans attendre que Grist rappelle recevoirPresences
  // (sinon un second clic très proche du premier ajouterait une ligne de plus au lieu de modifier la première).
  memoriserLignes(lues);
  appliquerDonnees();
  const deLEvenement = lues.filter((l) => l.evenement === evenementId);
  const miennes = deLEvenement.filter((l) => l.utilisateur === etat.moi.id);
  if (cible ? miennes.some((l) => l.statut === cible) : !miennes.length) return;
  if (cible && deLEvenement.some((l) => !l.utilisateur)) throw new Error(`ligne écrite sans « ${c.utilisateur} » : la formule « à la création » de « ${c.email} » n’a rien donné`);
  throw new Error(cible ? `la ligne n’apparaît pas dans « ${c.table} » après l’écriture` : `la ligne est toujours dans « ${c.table} » après la suppression`);
}

/** Mes clics enregistrés disparaissent dès que Participations les reflète (ou, par sécurité, après un délai). */
function confirmerMesChoix() {
  for (const [id, choix] of etat.choixEnCours) {
    if (choix.ecrit && (statutEnregistre(id) === choix.statut || Date.now() - choix.quand > 15000)) etat.choixEnCours.delete(id);
  }
}

/** Clic sur « Présent » ou « À confirmer » : reclique pour annuler, clique l’autre pour changer. */
async function choisir(evenementId, valeur) {
  if (!etat.moi || etat.verrous.has(evenementId)) return;
  const cible = !valeur || valeur === monStatut(evenementId) ? null : valeur;
  etat.verrous.add(evenementId);
  etat.choixEnCours.set(evenementId, { statut: cible, ecrit: false, quand: 0 });
  rendre();
  try {
    await ecrirePresence(evenementId, cible);
    await verifierEcriture(evenementId, cible);
    alerter('✓ Enregistré', 1500);
    const choix = etat.choixEnCours.get(evenementId);
    if (choix) Object.assign(choix, { ecrit: true, quand: Date.now() });
    confirmerMesChoix();   // Participations a peut-être déjà confirmé le choix pendant l’écriture
  } catch (err) {
    console.error(err);
    etat.choixEnCours.delete(evenementId);
    const detail = texte(err && err.message).slice(0, 160);
    const refus = /access|denied|blocked|permission/i.test(detail);
    alerter(`${refus ? 'Votre choix a été refusé par les règles d’accès du document' : 'Votre choix n’a pas pu être enregistré'}${detail ? ` (${detail})` : ''}.`, 10000);
  }
  etat.verrous.delete(evenementId);
  rendre();
}

/* ----------------------------------------------------------------------------
   Filtre « Pour qui ? » (colonne « Cibles » de Evenements)
   ---------------------------------------------------------------------------- */
const CLE_MEMOIRE = 'semaine-innovation-2026:cibles';

/** Le choix de public est gardé sur l’appareil ; tout échec (navigation privée, stockage bloqué) est ignoré : tous les événements s’affichent. */
function relireChoixCibles() {
  try {
    const m = JSON.parse(localStorage.getItem(CLE_MEMOIRE) || '[]');
    etat.cibles = new Set((Array.isArray(m) ? m : []).filter((code) => CIBLES.some((c) => c.code === code)));
  } catch (err) { /* rien à relire */ }
}

function garderChoixCibles() {
  try { localStorage.setItem(CLE_MEMOIRE, JSON.stringify([...etat.cibles])); } catch (err) { /* rien à garder */ }
}

/** Les publics qui ont au moins un événement : sans colonne « Cibles » (ou vide), la rangée n’apparaît pas. */
const ciblesUtilisees = () => CIBLES.filter((c) => etat.evenements.some((e) => e.cibles.includes(c.code)));

/** Publics cochés qui ont des événements, recalculés à chaque affichage ; aucun coché : tous les événements sont retenus. */
let choisis = new Set();
const concerne = (e) => !choisis.size || e.cibles.some((code) => choisis.has(code));

/** La rangée de bulles au-dessus des jours : un public par bulle, plusieurs possibles (un événement reste affiché s’il concerne l’un d’eux). */
function rendreCibles(utilisees) {
  const zone = el('cibles');
  zone.hidden = !utilisees.length;
  if (zone.hidden) return;
  el('cibles-bulles').innerHTML = utilisees.map((c) => `
    <button class="bulle" type="button" data-cible="${c.code}" data-focus="cible-${c.code}" aria-pressed="${choisis.has(c.code)}" title="${echapper(`${c.libelle} : ${c.qui}`)}">${c.libelle}</button>`).join('');
  const n = etat.evenements.filter(concerne).length;
  el('cibles-nb').textContent = choisis.size ? `${nombre(n, ['événement', 'événements'])} sur ${etat.evenements.length}` : '';
}

/* ----------------------------------------------------------------------------
   Affichage
   ---------------------------------------------------------------------------- */
const joursDuPlanning = () => [...new Set(etat.evenements.map((e) => e.jour))].sort();

function infosJour(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return { nom: JOURS_SEMAINE[d.getDay()], numero: d.getDate(), mois: MOIS[d.getMonth()] };
}

/** nombre(2, ['présent', 'présents']) -> '2 présents' */
function nombre(n, [singulier, pluriel]) {
  return `${n} ${n > 1 ? pluriel : singulier}`;
}

/** Message d’état. Le détail technique (noms de colonnes, réglages) ne sert qu’à l’administrateur : il reste replié. */
function afficherMessage(msg, erreur = false, detail = '') {
  const zone = el('etat');
  const cle = `${msg}|${detail}`;
  if (zone.dataset.cle !== cle) {   // inutile de reconstruire (et de refermer le détail) si rien n’a changé
    zone.dataset.cle = cle;
    zone.textContent = msg;
    if (msg && detail) {
      const details = document.createElement('details');
      details.className = 'etat__detail';
      const resume = document.createElement('summary');
      resume.textContent = 'Détail pour l’administrateur';
      const technique = document.createElement('p');
      technique.textContent = detail;
      details.append(resume, technique);
      zone.append(details);
    }
  }
  zone.classList.toggle('etat--erreur', Boolean(msg) && erreur);
}

/** Les messages techniques de ce fichier, reformulés pour les participants : { texte, detail }. */
function messageSimple(technique) {
  const cas = [
    [/^Il manque /, 'Le planning n’est pas encore prêt à enregistrer les présences : la configuration du document est incomplète. Prévenez l’organisateur.'],
    [/inaccessible : identification impossible/, 'Le planning est en lecture seule. Pour indiquer votre présence, connectez-vous à Grist avec votre adresse professionnelle : elle doit figurer dans l’annuaire du document.'],
    [/^Table « .+ » (introuvable|inaccessible)/, 'Le planning n’est pas disponible pour le moment. Prévenez l’organisateur.'],
    [/^Impossible de lire la table/, 'Le planning est momentanément indisponible. Réessayez dans un instant ou prévenez l’organisateur.'],
    [/^Impossible de vous reconnaître/, 'Vous n’êtes pas reconnu(e) pour l’instant : le planning reste en lecture seule. Prévenez l’organisateur.'],
  ].find(([motif]) => motif.test(technique));
  return cas ? { texte: cas[1], detail: technique } : { texte: technique, detail: '' };
}

let minuteurToast;
function alerter(msg, dureeMs = 5000) {
  const toast = el('toast');
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => { toast.hidden = true; }, dureeMs);
}

/** Logo (ou initiales à défaut) : celui d’une personne par défaut, ou d’un établissement si `titre` et `initiales` sont donnés. */
function rendreAvatar(p, titre = nomComplet(p), initiales = ((p.prenom[0] || '') + (p.nom[0] || '')).toUpperCase() || '?') {
  const classe = `avatar${p.statut === 'probable' ? ' avatar--probable' : ''}`;
  const src = logoSrc(p.logo);
  return src
    ? `<img class="${classe}" src="${echapper(src)}" alt="" title="${echapper(titre)}" data-initiales="${echapper(initiales)}">`
    : `<span class="${classe}" title="${echapper(titre)}">${echapper(initiales)}</span>`;
}

const initialesEtab = (e) => (e.acronyme.slice(0, 4) || e.nom.split(/[\s'’-]+/).filter((m) => m.length > 2).map((m) => m[0]).join('').slice(0, 3) || e.nom.slice(0, 2)).toUpperCase() || '?';

/** Le logo d’un établissement, avec le nombre de personnes quand elles sont plusieurs ; en pointillés si personne n’est sûr de venir. */
function rendreGroupeLogo(g) {
  const detail = [g.sur && nombre(g.sur, LIBELLES.sur.resume), g.probable && nombre(g.probable, LIBELLES.probable.resume)].filter(Boolean).join(', ');
  const avatar = rendreAvatar({ logo: g.logo, statut: g.sur ? 'sur' : 'probable' }, `${g.etab.nom || 'Autres'} : ${detail}`, initialesEtab(g.etab));
  return `<span class="groupe-logo">${avatar}${g.gens.length > 1 ? `<span class="groupe-logo__n" aria-hidden="true">${g.gens.length}</span>` : ''}</span>`;
}

const SEUIL_GROUPES = 8;    // au-delà, la liste des participants est regroupée par établissement
const LIMITE_LISTE = 12;    // ... et limitée à ce nombre de noms, jusqu’à ce qu’on demande la suite

/** Ligne de présence : les établissements en logo et en nombre, les compteurs, et la liste des participants à déplier. */
function rendreParticipants(evenement) {
  const gens = participantsDe(evenement.id);
  if (!gens.length) return '<p class="evt__personne">Personne pour l’instant</p>';
  const sur = gens.filter((p) => p.statut === 'sur').length;
  const probable = gens.length - sur;
  const resumeTexte = [sur && nombre(sur, LIBELLES.sur.resume), probable && nombre(probable, LIBELLES.probable.resume)].filter(Boolean).join(', ');
  // « ✓ 5 présents  ? 1 à confirmer » ; sur les colonnes étroites, seuls les symboles et les nombres restent (CSS, avec une légende)
  const compte = (classe, symbole, n) => (n ? `<span class="compte compte--${classe}" title="${echapper(nombre(n, LIBELLES[classe].resume))}">${symbole}${NBSP}${n}<span class="compte__mot"> ${n > 1 ? LIBELLES[classe].resume[1] : LIBELLES[classe].resume[0]}</span></span>` : '');
  const resume = [compte('sur', '✓', sur), compte('probable', '?', probable)].filter(Boolean).join(' ');
  const visibles = groupesDe(gens).slice(0, 3);
  const reste = gens.length - visibles.reduce((n, g) => n + g.gens.length, 0);
  const ouvert = etat.ouverts.has(evenement.id);
  const pile = `<span class="pile">${visibles.map(rendreGroupeLogo).join('')}${reste > 0 ? `<span class="avatar avatar--reste" title="${echapper(nombre(reste, ['autre personne', 'autres personnes']))}">+${reste}</span>` : ''}</span>`;
  return `
    <button class="evt__qui" type="button" data-action="detail" data-evt="${evenement.id}" data-focus="detail-${evenement.id}"
            aria-expanded="${ouvert}" aria-controls="detail-${evenement.id}" aria-label="Participants : ${echapper(resumeTexte)}">
      ${pile}
      <span class="evt__resume">${resume}</span>
      <span class="evt__plus">Participants</span>
    </button>`;
}

function rendreLigne(p, avecEtablissement) {
  return `
    <li>${avecEtablissement ? rendreAvatar(p) : ''}
      <span class="liste-qui__qui"><span class="liste-qui__nom">${echapper(nomComplet(p) || 'Anonyme')}${p.moi ? ' (vous)' : ''}</span>${avecEtablissement && p.etab.nom ? `<span class="liste-qui__etab">${echapper(p.etab.nom)}</span>` : ''}</span>
      <span class="badge${p.statut === 'sur' ? ' badge--sur' : ''}">${LIBELLES[p.statut].badge}</span>
    </li>`;
}

/** Liste des participants : à plat jusqu’à SEUIL_GROUPES personnes, puis par établissement et limitée à LIMITE_LISTE noms. */
function rendreListe(evenement) {
  const gens = participantsDe(evenement.id);
  if (!gens.length) return '';
  let corps;
  let bouton = '';
  if (gens.length <= SEUIL_GROUPES) {
    corps = `<ul class="liste-qui">${gens.map((p) => rendreLigne(p, true)).join('')}</ul>`;
  } else {
    const tout = etat.toutVoir.has(evenement.id);
    let place = tout ? gens.length : LIMITE_LISTE;
    corps = groupesDe(gens).map((g) => {
      const montres = g.gens.slice(0, place);
      place -= montres.length;
      if (!montres.length) return '';
      return `
        <section class="groupe">
          <h4 class="groupe__tete">${rendreAvatar({ logo: g.logo, statut: 'sur' }, g.etab.nom, initialesEtab(g.etab))}<span>${echapper(g.etab.nom || 'Autres')}</span><span class="groupe__n">${g.gens.length}</span></h4>
          <ul class="liste-qui">${montres.map((p) => rendreLigne(p, false)).join('')}</ul>
        </section>`;
    }).join('');
    const masques = tout ? 0 : Math.max(0, gens.length - LIMITE_LISTE);
    const libelle = masques ? `Voir les ${masques} autres` : tout ? 'Réduire la liste' : '';
    if (libelle) bouton = `<button class="detail__tout" type="button" data-action="tout" data-evt="${evenement.id}" data-focus="tout-${evenement.id}">${libelle}</button>`;
  }
  return `<div class="evt__detail" id="detail-${evenement.id}">${corps}${bouton}</div>`;
}

/** Informations pratiques d’un événement (adresse, public, description, fiche) ; vide s’il n’y en a pas. */
function rendreInfos(evenement) {
  const carte = lienCarte(evenement);
  const adresse = evenement.adresse && carte
    ? `<a href="${echapper(carte)}" target="_blank" rel="noopener" title="Ouvrir dans Google Maps">${echapper(evenement.adresse)} <span aria-hidden="true">↗</span></a>`
    : echapper(evenement.adresse);
  const infos = [['Public', echapper(evenement.public)], ['Adresse', adresse]].filter(([, v]) => v);
  if (!infos.length && !evenement.description && !evenement.lien) return '';
  return `
    <div class="evt__detail" id="infos-${evenement.id}">
      ${infos.length ? `<dl class="detail__infos">${infos.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
      ${evenement.description ? `<p>${echapper(evenement.description)}</p>` : ''}
      ${evenement.lien ? `<a href="${echapper(evenement.lien)}" target="_blank" rel="noopener">Voir la fiche sur le site <span aria-hidden="true">↗</span></a>` : ''}
    </div>`;
}

/** Mon choix : deux boutons ; recliquer sur celui qui est choisi retire la présence (le ✕ le rappelle). */
function rendreActions(evenement) {
  if (!etat.moi || etat.erreurColonnes) return '';   // personne non reconnue ou colonnes absentes : lecture seule, un message l’explique en haut de page
  const mien = monStatut(evenement.id);
  const bloque = etat.verrous.has(evenement.id);   // écriture en cours : les clics sont ignorés (voir choisir), les boutons ne changent pas d’aspect
  const bouton = (valeur, libelle) => {
    const choisi = mien === valeur;
    return `
    <button type="button" data-action="choisir" data-evt="${evenement.id}" data-valeur="${valeur}" data-focus="${valeur}-${evenement.id}"
            aria-pressed="${choisi}"${choisi ? ' title="Recliquer pour retirer ma présence"' : ''}>${libelle}${choisi ? '<span class="choix__x" aria-hidden="true">✕</span><span class="sr-only"> (recliquer pour retirer)</span>' : ''}</button>`;
  };
  return `
    <div class="evt__actions">
      <div class="choix" role="group" aria-busy="${bloque}" aria-label="Ma présence : ${echapper(evenement.titre)}">
        ${bouton('sur', LIBELLES.sur.bouton)}${bouton('probable', LIBELLES.probable.bouton)}
      </div>
    </div>`;
}

/** Le lieu et la ville, en lien vers une carte (nouvel onglet) quand on sait où chercher. */
function rendreLieu(e) {
  const texteLieu = `${echapper(e.lieu)}${e.ville ? `<br>${echapper(e.ville)}` : ''}`;
  const carte = lienCarte(e);
  if (!carte) return texteLieu;
  const nom = [e.lieu, e.ville].filter(Boolean).join(', ');
  return `<a class="evt__carte" href="${echapper(carte)}" target="_blank" rel="noopener" title="Ouvrir dans Google Maps" aria-label="${echapper(`Voir sur la carte : ${nom}`)}">${ICONE_LIEU}<span>${texteLieu}</span></a>`;
}

function rendreEvenement(e) {
  const heure = e.fin
    ? `${formaterHeure(e.debut)}${NBSP}–${NBSP}${formaterHeure(e.fin)}`
    : e.debut ? `À partir de ${formaterHeure(e.debut)}` : '';
  const fort = e.tempsFort ? `<span class="evt__fort">Temps fort / ${echapper(e.tempsFort)}</span>` : '';
  const infos = rendreInfos(e);
  const infosOuvertes = etat.infos.has(e.id);
  const boutonInfos = infos
    ? `<button class="evt__info" type="button" data-action="infos" data-evt="${e.id}" data-focus="infos-${e.id}" aria-expanded="${infosOuvertes}" aria-controls="infos-${e.id}"
              aria-label="Informations pratiques : ${echapper(e.titre)}" title="Informations pratiques"><span aria-hidden="true">i</span></button>`
    : '';
  return `
    <article class="evt${e.tempsFort ? ' evt--fort' : ''}">
      ${fort}
      <div class="evt__ligne">
        <p><span class="evt__heure">${heure}</span>${e.type ? `<span class="evt__type">${echapper(e.type)}</span>` : ''}</p>
        ${boutonInfos}
      </div>
      <h3 class="evt__titre">${typo(e.titre)}${e.sousTitre ? `<span class="sr-only">. </span><span class="evt__sous">${typo(e.sousTitre)}</span>` : ''}</h3>
      <p class="evt__lieu">${rendreLieu(e)}</p>
      ${infosOuvertes ? infos : ''}
      ${rendreParticipants(e)}
      ${etat.ouverts.has(e.id) ? rendreListe(e) : ''}
      ${rendreActions(e)}
    </article>`;
}

function rendreEntete() {
  const zone = el('moi');
  if (etat.moi) {
    zone.className = 'entete__moi moi';
    zone.innerHTML = `${rendreAvatar({ ...etat.moi, statut: 'sur' })}<span>${echapper(nomComplet(etat.moi) || 'Connecté(e)')}</span>`;
  } else {
    zone.className = 'entete__moi moi moi--lecture';
    zone.textContent = 'Lecture seule';
  }
  const nb = etat.evenements.filter((e) => monStatut(e.id)).length;
  const filtre = el('filtre');
  filtre.hidden = !etat.moi || Boolean(etat.erreurColonnes);
  filtre.setAttribute('aria-pressed', String(etat.seulementMesEvenements));
  filtre.textContent = `Mon programme${nb ? ` (${nb})` : ''}`;
  filtre.title = 'Ne garder que les événements où vous êtes présent(e) ou à confirmer';
}

/** Nombre d’événements de « mon programme » (présent ou à confirmer) ce jour-là. */
const mesEvenementsDuJour = (iso) => etat.evenements.filter((e) => e.jour === iso && monStatut(e.id)).length;

const pluriel = (n) => `${n} événement${n > 1 ? 's' : ''} dans votre programme`;

function rendreOnglets(jours) {
  el('onglets').innerHTML = jours.map((iso) => {
    const j = infosJour(iso);
    const n = mesEvenementsDuJour(iso);
    const nom = `${j.nom} ${j.numero} ${j.mois}`;
    return `<button class="onglet" type="button" data-jour="${iso}" data-focus="jour-${iso}" aria-pressed="${iso === etat.jour}" aria-label="${echapper(n ? `${nom} : ${pluriel(n)}` : nom)}">
      <small>${j.nom.slice(0, 3)}.</small><strong>${j.numero}</strong>${n ? `<span class="onglet__n" aria-hidden="true">${n}</span>` : ''}</button>`;
  }).join('');
}

function rendrePlanning(jours) {
  el('planning').innerHTML = jours.map((iso) => {
    const j = infosJour(iso);
    const evenements = etat.evenements.filter((e) => e.jour === iso && concerne(e) && (!etat.seulementMesEvenements || monStatut(e.id)));
    const vide = etat.seulementMesEvenements ? 'Vous n’avez pas encore choisi d’événement ce jour-là.' : choisis.size ? 'Aucun événement pour ce public ce jour-là.' : 'Aucun événement.';
    const contenu = evenements.length ? evenements.map(rendreEvenement).join('') : `<p class="jour__vide">${vide}</p>`;
    return `
      <section class="jour${iso === etat.jour ? ' jour--actif' : ''}" aria-label="${j.nom} ${j.numero} ${j.mois}">
        <header class="jour__tete">
          <h2 class="jour__titre"><span class="jour__nom">${j.nom}</span><span class="jour__date">${j.numero} ${j.mois}</span></h2>
          ${mesEvenementsDuJour(iso) ? `<span class="jour__mes"><span aria-hidden="true">✓ ${mesEvenementsDuJour(iso)}</span><span class="sr-only">${pluriel(mesEvenementsDuJour(iso))}</span></span>` : ''}
        </header>
        <div class="jour__liste">${contenu}</div>
      </section>`;
  }).join('');
}

function rendre() {
  if (!etat.pret) return;   // le premier affichage attend la fin du premier chargement
  const technique = etat.erreurColonnes || etat.erreur || (!etat.moi && etat.messageMoi) || '';
  if (technique) {
    const { texte: simple, detail } = messageSimple(technique);
    afficherMessage(simple, Boolean(etat.erreurColonnes || etat.erreur), detail);
  } else if (!etat.evenements.length) afficherMessage('Aucun événement à afficher.');
  else afficherMessage('');
  el('planning').removeAttribute('aria-busy');

  // Le contenu est reconstruit : on redonne le focus au bouton utilisé (accessibilité clavier).
  const actif = document.activeElement;
  const cle = etat.focus || (actif && actif.dataset ? actif.dataset.focus : null);
  const jours = joursDuPlanning();
  const utilisees = ciblesUtilisees();
  choisis = new Set([...etat.cibles].filter((code) => utilisees.some((c) => c.code === code)));
  rendreEntete();
  rendreCibles(utilisees);
  rendreOnglets(jours);
  rendrePlanning(jours);
  const cible = cle && document.querySelector(`[data-focus="${cle}"]:not(:disabled)`);
  if (cible) {
    cible.focus({ preventScroll: true });
    etat.focus = null;
  }
}

/* ----------------------------------------------------------------------------
   Interactions (délégation d’événements)
   ---------------------------------------------------------------------------- */
document.addEventListener('click', (ev) => {
  const cible = ev.target.closest('[data-action], [data-jour], [data-cible], #filtre');
  if (!cible) return;
  etat.focus = cible.dataset.focus || null;
  if (cible.id === 'filtre') {
    etat.seulementMesEvenements = !etat.seulementMesEvenements;
  } else if (cible.dataset.cible) {
    if (!etat.cibles.delete(cible.dataset.cible)) etat.cibles.add(cible.dataset.cible);
    garderChoixCibles();
  } else if (cible.dataset.jour) {
    etat.jour = cible.dataset.jour;
    const onglets = el('onglets');
    if (window.scrollY > onglets.offsetTop) window.scrollTo({ top: onglets.offsetTop });
  } else if (cible.dataset.action === 'detail') {
    const id = Number(cible.dataset.evt);
    if (!etat.ouverts.delete(id)) etat.ouverts.add(id);
  } else if (cible.dataset.action === 'infos' || cible.dataset.action === 'tout') {
    const ensemble = cible.dataset.action === 'infos' ? etat.infos : etat.toutVoir;
    const id = Number(cible.dataset.evt);
    if (!ensemble.delete(id)) ensemble.add(id);
  } else if (cible.dataset.action === 'choisir') {
    choisir(Number(cible.dataset.evt), cible.dataset.valeur);
    return;
  }
  rendre();
});

el('toast').addEventListener('click', () => { el('toast').hidden = true; });

// Un logo qui ne charge pas est remplacé par les initiales de la personne.
document.addEventListener('error', (ev) => {
  const img = ev.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('avatar')) return;
  const span = document.createElement('span');
  span.className = img.className;
  span.title = img.title;
  span.textContent = img.dataset.initiales || '?';
  img.replaceWith(span);
}, true);

/* ----------------------------------------------------------------------------
   Démarrage
   ---------------------------------------------------------------------------- */
// `grist.simule` n’existe que dans le faux Grist de dev/ (test hors Grist).
if (typeof grist === 'undefined' || (window.self === window.top && !grist.simule)) {
  afficherMessage('Ce widget s’utilise dans Grist : ajoutez-le à une page via « Ajouter un widget > Personnalisé ».', true);
} else {
  majPied();
  relireChoixCibles();
  grist.ready({ requiredAccess: 'full' });
  grist.onRecords(recevoirPresences, { includeColumns: 'all' });
  (async () => {
    await Promise.all([chargerEvenements(), chargerEtablissements(), preparerParticipations()]);
    await chargerAnnuaire();
    etat.pret = true;
    rendre();
    setInterval(() => { chargerEvenements(); chargerEtablissements(); chargerAnnuaire(); }, CONFIG.rafraichissementMs);
  })();
}
