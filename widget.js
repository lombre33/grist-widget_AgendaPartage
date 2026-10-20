'use strict';

/* ============================================================================
   Planning de la Semaine de l’innovation 2026 — widget personnalisé Grist
   Aucune dépendance autre que grist-plugin-api.js.

   Tables Grist utilisées :
   - Evenements    : import de l’Excel fourni (data/Evenements_Semaine_Innovation_2026.xlsx)
   - Annuaire      : une ligne par personne (nom, prénom, e-mail, établissement)
   - Etablissement : le logo de chaque établissement
   - Presences     : une ligne par personne et par événement ; c’est la table à laquelle
                     on lie le widget. Ses colonnes sont lues par leur nom (CONFIG.presences) :
                     rien à associer dans le panneau du widget.
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
    adresse: 'Adresse', public: 'Public', description: 'Description', lien: 'Lien',
  },
  // Colonnes de la table Annuaire.
  annuaire: {
    email: 'email',                      // sert à reconnaître la personne connectée (voir chargerMoi)
    nom: 'nom',
    prenom: 'prenom',
    domaine: 'nom_de_domaine',           // lien avec l’établissement (en priorité)
    etablissement: 'Etablissement',      // texte : lien avec l’établissement, si le domaine ne suffit pas
  },
  // Colonnes de la table Etablissement.
  etablissements: {
    nom: 'Nom_complet',
    domaine: 'nom_de_domaine',
    logo: 'Logo',                        // colonne Pièces jointes, ou lien web (https://…)
  },
  // Colonnes de la table Presences (celle à laquelle le widget est lié).
  presences: {
    evenement: 'Evenement',              // Référence → Evenements
    utilisateur: 'Utilisateur',          // Référence → Annuaire
    statut: 'Statut',
    nom: 'Nom',                          // formule : $Utilisateur.nom
    prenom: 'Prenom',                    // formule : $Utilisateur.prenom
    logo: 'Logo',                        // formule : logo de l’établissement (voir README)
  },
  // Valeurs écrites dans la colonne « Statut » de la table Presences
  // (les anciennes valeurs « sûr » et « probable » sont toujours reconnues à la lecture).
  statuts: { sur: 'présent', probable: 'à confirmer' },
  // Les événements changent rarement : on les relit à cet intervalle (les présences, elles, arrivent en direct).
  rafraichissementMs: 60000,
};

/* Libellés affichés (les codes internes restent « sur » et « probable »). */
const LIBELLES = {
  sur:      { bouton: '✓ Présent',     badge: 'Présent',     resume: ['présent', 'présents'] },
  probable: { bouton: '? À confirmer', badge: 'À confirmer', resume: ['à confirmer', 'à confirmer'] },
};

const JOURS_SEMAINE = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/* ----------------------------------------------------------------------------
   État
   ---------------------------------------------------------------------------- */
const etat = {
  evenements: [],              // lus dans la table Evenements
  presences: [],               // lues en direct dans la table Presences
  moi: null,                   // { id, nom, prenom, logo } : ma ligne dans la table ACL
  messageMoi: '',              // pourquoi moi est vide (mode lecture seule)
  erreurColonnes: '',          // colonnes de Presences introuvables
  erreur: '',                  // problème de lecture de la table Evenements
  focus: null,                 // élément à refocaliser après un nouvel affichage
  choixEnCours: new Map(),     // evenementId -> { statut, ecrit } : mon choix pendant son enregistrement
  verrous: new Set(),          // evenements dont l’écriture est en cours
  jour: null,                  // onglet affiché (écrans étroits)
  seulementMesEvenements: false,
  ouverts: new Set(),          // evenements dont le détail est déplié
  jeton: null,                 // { token, baseUrl, expire } pour les logos en pièce jointe
};

const el = (id) => document.getElementById(id);

/* ----------------------------------------------------------------------------
   Petits utilitaires de lecture des valeurs Grist
   ---------------------------------------------------------------------------- */
const texte = (v) => (v == null ? '' : String(v)).trim();

const echapper = (v) => texte(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sansAccent = (v) => texte(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Les listes Grist arrivent soit en tableau simple, soit encodées ['L', a, b]. */
const liste = (v) => (Array.isArray(v) ? (v[0] === 'L' ? v.slice(1) : v) : []);

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

/** '09:30', '9h30' ou fraction de jour (heure Excel) -> { h, m }. */
function versHeure(v) {
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const minutes = Math.round(v * 1440);
    return { h: Math.floor(minutes / 60), m: minutes % 60 };
  }
  const m = /^(\d{1,2})\s*[:hH]\s*(\d{2})?/.exec(texte(v));
  return m ? { h: Number(m[1]), m: Number(m[2] || 0) } : null;
}

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
      const aujourdhui = new Date().toISOString().slice(0, 10);
      etat.jour = jours.includes(aujourdhui) ? aujourdhui : jours[0] || null;
    }
    etat.erreur = '';
  } catch (err) {
    console.error(err);
    etat.erreur = `Impossible de lire la table « ${CONFIG.tables.evenements} ». Vérifiez son nom (CONFIG.tables.evenements) et les droits d’accès.`;
  }
  rendre();
}

/** Logo de l’établissement d’une personne de l’Annuaire : par nom de domaine, sinon par nom. */
async function chercherLogo(personne) {
  try {
    const c = CONFIG.annuaire;
    const e = CONFIG.etablissements;
    const domaine = sansAccent(personne[c.domaine]);
    const nom = sansAccent(personne[c.etablissement]);
    const lignes = lignesDeTable(await grist.docApi.fetchTable(CONFIG.tables.etablissements));
    const trouve = lignes.find((l) => domaine && sansAccent(l[e.domaine]) === domaine)
      || lignes.find((l) => nom && sansAccent(l[e.nom]) === nom);
    return trouve ? trouve[e.logo] : null;
  } catch (err) {
    console.error('Logos des établissements indisponibles', err);
    return null;
  }
}

/**
 * Qui suis-je ? Grist n’indique pas l’utilisateur au widget. On s’appuie donc sur les règles
 * d’accès de l’Annuaire : l’e-mail n’y est lisible que sur sa propre ligne (règle `rec.email == user.Email`),
 * qu’il s’agisse de la colonne seule (les autres lignes sont alors masquées) ou de la table entière
 * (on ne voit alors que sa ligne). La ligne dont l’e-mail est lisible est la mienne.
 * C’est la seule fonction à adapter si l’identification se fait autrement.
 */
async function chargerMoi() {
  try {
    const c = CONFIG.annuaire;
    const lignes = lignesDeTable(await grist.docApi.fetchTable(CONFIG.tables.annuaire));
    const miennes = lignes.filter((l) => typeof l[c.email] === 'string' && l[c.email].trim());
    if (miennes.length === 1) {
      const l = miennes[0];
      etat.moi = { id: l.id, nom: texte(l[c.nom]), prenom: texte(l[c.prenom]), logo: await chercherLogo(l) };
      etat.messageMoi = '';
      await preparerJeton([etat.moi.logo]);   // avant le premier affichage du logo
    } else {
      etat.moi = null;
      etat.messageMoi = miennes.length
        ? `Plusieurs e-mails sont lisibles dans la table « ${CONFIG.tables.annuaire} » : une règle d’accès doit réserver la colonne e-mail à sa propre ligne.`
        : 'Vous n’êtes pas reconnu(e) : connectez-vous avec votre compte pour indiquer votre présence.';
    }
  } catch (err) {
    console.error(err);
    etat.moi = null;
    etat.messageMoi = `Table « ${CONFIG.tables.annuaire} » inaccessible : identification impossible.`;
  }
  rendre();
}

function recevoirPresences(enregistrements) {
  const c = CONFIG.presences;
  etat.presences = enregistrements
    .map((r) => ({
      id: r.id,
      evenement: Number(r[c.evenement]) || 0,
      utilisateur: Number(r[c.utilisateur]) || 0,
      statut: codeStatut(r[c.statut]),
      nom: texte(r[c.nom]),
      prenom: texte(r[c.prenom]),
      logo: r[c.logo],
    }))
    .filter((p) => p.evenement && p.statut);
  // Mes choix sont maintenant confirmés par les données du serveur
  for (const [id, choix] of etat.choixEnCours) if (choix.ecrit) etat.choixEnCours.delete(id);
  preparerJeton(etat.presences.map((p) => p.logo)).then((nouveau) => nouveau && rendre());
  rendre();
}

/** Prévient (en haut de page) si la table liée au widget n’a pas les colonnes attendues. */
async function verifierColonnes() {
  try {
    const id = await grist.selectedTable.getTableId();
    const table = await grist.docApi.fetchTable(id);
    const c = CONFIG.presences;
    const manquantes = [c.evenement, c.utilisateur, c.statut, c.nom, c.prenom].filter((nom) => !(nom in table));
    etat.erreurColonnes = manquantes.length
      ? `Colonnes introuvables dans la table « ${id} » : ${manquantes.join(', ')}. Ajoutez-les ou corrigez CONFIG.presences dans widget.js.`
      : '';
    rendre();
  } catch (err) {
    console.warn('Vérification des colonnes impossible', err);   // facultative
  }
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
function monStatut(evenementId) {
  if (!etat.moi) return null;
  if (etat.choixEnCours.has(evenementId)) return etat.choixEnCours.get(evenementId).statut;
  const miennes = etat.presences.filter((p) => p.evenement === evenementId && p.utilisateur === etat.moi.id);
  return miennes.some((p) => p.statut === 'sur') ? 'sur' : miennes.length ? 'probable' : null;
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
  if (mien) parPersonne.set('moi', { ...etat.moi, statut: mien, moi: true });
  const rang = { sur: 0, probable: 1 };
  return [...parPersonne.values()].sort((a, b) => rang[a.statut] - rang[b.statut] || nomComplet(a).localeCompare(nomComplet(b), 'fr'));
}

/** Espaces insécables avant « : ; ! ? » et autour des guillemets français, pour éviter les retours à la ligne orphelins. */
const typo = (v) => echapper(v).replace(/ ([:;!?»])/g, `${NBSP}$1`).replace(/« /g, `«${NBSP}`);

const nomComplet = (p) => `${p.prenom} ${p.nom}`.trim();

async function ecrirePresence(evenementId, cible) {
  const c = CONFIG.presences;
  const table = grist.getTable();
  const miennes = etat.presences.filter((p) => p.evenement === evenementId && p.utilisateur === etat.moi.id);
  const [gardee, ...doublons] = miennes;
  if (!cible) {
    if (miennes.length) await table.destroy(miennes.map((p) => p.id));
  } else if (gardee) {
    await table.update({ id: gardee.id, fields: { [c.statut]: CONFIG.statuts[cible] } });
    if (doublons.length) await table.destroy(doublons.map((p) => p.id));
  } else {
    await table.create({ fields: { [c.evenement]: evenementId, [c.utilisateur]: etat.moi.id, [c.statut]: CONFIG.statuts[cible] } });
  }
}

/** Clic sur « Présent » ou « À confirmer » : reclique pour annuler, clique l’autre pour changer. */
async function choisir(evenementId, valeur) {
  if (!etat.moi || etat.verrous.has(evenementId)) return;
  const cible = !valeur || valeur === monStatut(evenementId) ? null : valeur;
  etat.verrous.add(evenementId);
  etat.choixEnCours.set(evenementId, { statut: cible, ecrit: false });
  rendre();
  try {
    await ecrirePresence(evenementId, cible);
    const choix = etat.choixEnCours.get(evenementId);
    if (choix) choix.ecrit = true;
  } catch (err) {
    console.error(err);
    etat.choixEnCours.delete(evenementId);
    alerter('Votre choix n’a pas pu être enregistré. Réessayez dans un instant.');
  }
  etat.verrous.delete(evenementId);
  rendre();
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

function afficherMessage(msg, erreur = false) {
  const zone = el('etat');
  zone.textContent = msg;
  zone.classList.toggle('etat--erreur', Boolean(msg) && erreur);
}

let minuteurToast;
function alerter(msg) {
  const toast = el('toast');
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => { toast.hidden = true; }, 5000);
}

function rendreAvatar(p) {
  const initiales = ((p.prenom[0] || '') + (p.nom[0] || '')).toUpperCase() || '?';
  const classe = `avatar${p.statut === 'probable' ? ' avatar--probable' : ''}`;
  const src = logoSrc(p.logo);
  return src
    ? `<img class="${classe}" src="${echapper(src)}" alt="" title="${echapper(nomComplet(p))}" data-initiales="${echapper(initiales)}">`
    : `<span class="${classe}" title="${echapper(nomComplet(p))}">${echapper(initiales)}</span>`;
}

function rendreParticipants(evenement) {
  const gens = participantsDe(evenement.id);
  const sur = gens.filter((p) => p.statut === 'sur').length;
  const probable = gens.length - sur;
  const resumeTexte = gens.length
    ? [sur && nombre(sur, LIBELLES.sur.resume), probable && nombre(probable, LIBELLES.probable.resume)].filter(Boolean).join(', ')
    : 'Personne pour l’instant';
  // « ✓ 5 présents  ? 1 à confirmer » ; sur les colonnes étroites, seuls les symboles et les nombres restent (CSS)
  const compte = (classe, symbole, n) => (n ? `<span class="compte compte--${classe}">${symbole}${NBSP}${n}<span class="compte__mot"> ${n > 1 ? LIBELLES[classe].resume[1] : LIBELLES[classe].resume[0]}</span></span>` : '');
  const resume = gens.length ? [compte('sur', '✓', sur), compte('probable', '?', probable)].filter(Boolean).join(' ') : 'Personne pour l’instant';
  const visibles = gens.slice(0, 4);
  const reste = gens.length - visibles.length;
  const ouvert = etat.ouverts.has(evenement.id);
  const pile = gens.length ? `<span class="pile">${visibles.map(rendreAvatar).join('')}${reste > 0 ? `<span class="avatar avatar--reste">+${reste}</span>` : ''}</span>` : '';
  return `
    <button class="evt__qui" type="button" data-action="detail" data-evt="${evenement.id}" data-focus="detail-${evenement.id}"
            aria-expanded="${ouvert}" aria-controls="detail-${evenement.id}" aria-label="${echapper(resumeTexte)} : afficher les détails">
      ${pile}
      <span class="evt__resume">${resume}</span>
      <span class="evt__plus">Détails</span>
    </button>`;
}

function rendreDetail(evenement) {
  const gens = participantsDe(evenement.id);
  const infos = [['Public', evenement.public], ['Adresse', evenement.adresse]].filter(([, v]) => v);
  return `
    <div class="evt__detail" id="detail-${evenement.id}">
      ${gens.length ? `<ul class="liste-qui">${gens.map((p) => `
        <li>${rendreAvatar(p)}
          <span class="liste-qui__nom">${echapper(nomComplet(p) || 'Anonyme')}${p.moi ? ' (vous)' : ''}</span>
          <span class="badge${p.statut === 'sur' ? ' badge--sur' : ''}">${LIBELLES[p.statut].badge}</span>
        </li>`).join('')}</ul>` : ''}
      ${infos.length ? `<dl class="detail__infos">${infos.map(([k, v]) => `<dt>${k}</dt><dd>${echapper(v)}</dd>`).join('')}</dl>` : ''}
      ${evenement.description ? `<p>${echapper(evenement.description)}</p>` : ''}
      ${evenement.lien ? `<a href="${echapper(evenement.lien)}" target="_blank" rel="noopener">Voir la fiche sur le site <span aria-hidden="true">↗</span></a>` : ''}
    </div>`;
}

function rendreActions(evenement) {
  if (!etat.moi) return '';   // personne non reconnue : lecture seule, un message l’explique en haut de page
  const mien = monStatut(evenement.id);
  const bloque = etat.verrous.has(evenement.id);
  const bouton = (valeur, libelle) => `
    <button type="button" data-action="choisir" data-evt="${evenement.id}" data-valeur="${valeur}" data-focus="${valeur}-${evenement.id}"
            aria-pressed="${mien === valeur}" ${bloque ? 'disabled' : ''}>${libelle}</button>`;
  return `
    <div class="evt__actions">
      <div class="choix" role="group" aria-label="Ma présence : ${echapper(evenement.titre)}">
        ${bouton('sur', LIBELLES.sur.bouton)}${bouton('probable', LIBELLES.probable.bouton)}
      </div>
      ${mien && !bloque ? `<button class="retirer" type="button" data-action="choisir" data-evt="${evenement.id}" data-focus="retirer-${evenement.id}">Retirer</button>` : ''}
    </div>`;
}

function rendreEvenement(e) {
  const heure = e.fin
    ? `${formaterHeure(e.debut)} - ${formaterHeure(e.fin)}`
    : e.debut ? `À partir de ${formaterHeure(e.debut)}` : '';
  const fort = e.tempsFort ? `<span class="evt__fort">Temps fort / ${echapper(e.tempsFort)}</span>` : '';
  return `
    <article class="evt${e.tempsFort ? ' evt--fort' : ''}">
      ${fort}
      <div class="evt__ligne">
        <p><span class="evt__heure">${heure}</span>${e.type ? `<span class="evt__type">${echapper(e.type)}</span>` : ''}</p>
        ${e.lien ? `<a class="evt__fiche" href="${echapper(e.lien)}" target="_blank" rel="noopener" aria-label="Voir la fiche : ${echapper(e.titre)}">↗</a>` : ''}
      </div>
      <h3 class="evt__titre">${typo(e.titre)}${e.sousTitre ? `<span class="evt__sous">${typo(e.sousTitre)}</span>` : ''}</h3>
      <p class="evt__lieu">${echapper(e.lieu)}${e.ville ? `<br>${echapper(e.ville)}` : ''}</p>
      ${rendreParticipants(e)}
      ${etat.ouverts.has(e.id) ? rendreDetail(e) : ''}
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
  filtre.hidden = !etat.moi;
  filtre.setAttribute('aria-pressed', String(etat.seulementMesEvenements));
  filtre.textContent = `Mon programme${nb ? ` (${nb})` : ''}`;
}

function rendreOnglets(jours) {
  el('onglets').innerHTML = jours.map((iso) => {
    const j = infosJour(iso);
    const aDesChoix = etat.evenements.some((e) => e.jour === iso && monStatut(e.id));
    return `<button class="onglet" type="button" data-jour="${iso}" data-focus="jour-${iso}"${iso === etat.jour ? ' aria-current="true"' : ''}>
      <small>${j.nom.slice(0, 3)}.</small><strong>${j.numero}</strong>${aDesChoix ? '<span class="onglet__point" title="Vous participez ce jour-là"></span>' : ''}</button>`;
  }).join('');
}

function rendrePlanning(jours) {
  el('planning').innerHTML = jours.map((iso) => {
    const j = infosJour(iso);
    const evenements = etat.evenements.filter((e) => e.jour === iso && (!etat.seulementMesEvenements || monStatut(e.id)));
    const contenu = evenements.length
      ? evenements.map(rendreEvenement).join('')
      : `<p class="jour__vide">${etat.seulementMesEvenements ? 'Vous n’avez pas encore choisi d’événement ce jour-là.' : 'Aucun événement.'}</p>`;
    return `
      <section class="jour${iso === etat.jour ? ' jour--actif' : ''}" aria-label="${j.nom} ${j.numero} ${j.mois}">
        <header class="jour__tete">
          <div><span class="jour__nom">${j.nom}</span><span class="jour__date">${j.numero} ${j.mois}</span></div>
          <i class="jour__point"></i>
        </header>
        <div class="jour__liste">${contenu}</div>
      </section>`;
  }).join('');
}

function rendre() {
  if (etat.erreurColonnes) afficherMessage(etat.erreurColonnes, true);
  else if (etat.erreur) afficherMessage(etat.erreur, true);
  else if (!etat.moi && etat.messageMoi) afficherMessage(etat.messageMoi);
  else if (!etat.evenements.length) afficherMessage('Aucun événement à afficher.');
  else afficherMessage('');

  // Le contenu est reconstruit : on redonne le focus au bouton utilisé (accessibilité clavier).
  const actif = document.activeElement;
  const cle = etat.focus || (actif && actif.dataset ? actif.dataset.focus : null);
  const jours = joursDuPlanning();
  rendreEntete();
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
  const cible = ev.target.closest('[data-action], [data-jour], #filtre');
  if (!cible) return;
  etat.focus = cible.dataset.focus || null;
  if (cible.id === 'filtre') {
    etat.seulementMesEvenements = !etat.seulementMesEvenements;
  } else if (cible.dataset.jour) {
    etat.jour = cible.dataset.jour;
    const onglets = el('onglets');
    if (window.scrollY > onglets.offsetTop) window.scrollTo({ top: onglets.offsetTop });
  } else if (cible.dataset.action === 'detail') {
    const id = Number(cible.dataset.evt);
    if (!etat.ouverts.delete(id)) etat.ouverts.add(id);
  } else if (cible.dataset.action === 'choisir') {
    if (!cible.dataset.valeur) etat.focus = `sur-${cible.dataset.evt}`;   // « Retirer » disparaît
    choisir(Number(cible.dataset.evt), cible.dataset.valeur);
    return;
  }
  rendre();
});

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
  grist.ready({ requiredAccess: 'full' });
  grist.onRecords(recevoirPresences, { includeColumns: 'all' });
  chargerEvenements();
  chargerMoi();
  verifierColonnes();
  setInterval(() => {
    chargerEvenements();
    if (!etat.moi) chargerMoi();
  }, CONFIG.rafraichissementMs);
}
