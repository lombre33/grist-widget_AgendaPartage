#!/usr/bin/env node
/* Applique des modifications de cellules à la table Evenements d'un document Grist déjà en service, SANS toucher aux lignes :
   les présences de Participations pointent vers les numéros de ligne d'Evenements, qui ne changent donc pas.
   Rien n'est supprimé, ajouté ni réimporté ; seules les cellules listées dans le fichier de modifications sont écrites.

   Usage (Node 22, aucune dépendance) :
     GRIST_API_KEY=… node dev/grist/maj-evenements.js --doc IDENTIFIANT_DU_DOCUMENT [--serveur https://docs.getgrist.com] [--fichier data/modifs-planning-22-oct.json]
       sans --appliquer : simulation, rien n'est écrit (liste ce qui serait changé)
       avec --appliquer : écrit, puis relit tout le document et vérifie que rien d'autre n'a bougé

   La clé d'API : Grist, menu du profil → Paramètres du profil → Clé d'API. L'identifiant du document est dans l'adresse (…/doc/IDENTIFIANT)
   ou dans les paramètres du document. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const texte = (t) => String(t ?? '').normalize('NFC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const jourDe = (v) => (typeof v === 'number' ? new Date(v * 1000).toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const estListe = (v) => Array.isArray(v);
/** Les valeurs d'une cellule « Cibles » : liste de choix (['L', 'a', 'b']) ou texte « a, b ». */
const publics = (v) => (estListe(v) ? v.filter((x) => x !== 'L') : String(v ?? '').split(/[,;]/)).map(texte).filter(Boolean).sort();
const memeValeur = (champ, a, b) => (champ === 'Cibles' ? publics(a).join('|') === publics(b).join('|') : texte(a) === texte(b));

/** La valeur à écrire, dans le même format que la cellule actuelle (liste de choix ou texte). */
function aEcrire(champ, valeur, actuelle) {
  if (champ !== 'Cibles') return valeur;
  return estListe(actuelle) || actuelle == null ? ['L', ...valeur] : valeur.join(', ');
}

/**
 * Compare les modifications attendues aux lignes de la table. Renvoie un plan : pour chaque modification, son état
 * (« a-faire », « deja-fait », « introuvable », « ambigu », « different ») et, pour « a-faire », le numéro de ligne et les cellules à écrire.
 */
function planifier(evenements, modifications) {
  return modifications.map((m) => {
    const memeSeance = (e, titre) => jourDe(e.Jour) === m.jour && texte(e.Debut) === texte(m.debut) && texte(e.Titre) === texte(titre);
    const champs = Object.keys(m.apres);
    const ancien = evenements.filter((e) => memeSeance(e, m.titre));
    const nouveau = evenements.filter((e) => m.apres.Titre !== undefined && memeSeance(e, m.apres.Titre));
    const lignes = ancien.length ? ancien : nouveau;
    if (lignes.length > 1) return { m, etat: 'ambigu', detail: `${lignes.length} lignes correspondent` };
    if (!lignes.length) return { m, etat: 'introuvable', detail: 'aucune ligne avec ce jour, ce début et ce titre' };
    const [ligne] = lignes;
    const cellules = {};
    for (const champ of champs) {
      if (memeValeur(champ, ligne[champ], m.apres[champ])) continue;   // déjà à jour
      if (!memeValeur(champ, ligne[champ], m.avant[champ])) {
        return { m, etat: 'different', id: ligne.id, detail: `« ${champ} » vaut ${JSON.stringify(ligne[champ])}, pas la valeur attendue ${JSON.stringify(m.avant[champ])} : modifié à la main ?` };
      }
      cellules[champ] = aEcrire(champ, m.apres[champ], ligne[champ]);
    }
    return Object.keys(cellules).length ? { m, etat: 'a-faire', id: ligne.id, cellules, avant: Object.fromEntries(champs.map((c) => [c, ligne[c]])) } : { m, etat: 'deja-fait', id: ligne.id };
  });
}

/** Appels de l'API REST d'un document : `api(methode, chemin, corps)` renvoie le JSON. */
function clientApi(serveur, cle) {
  return async (methode, chemin, corps) => {
    const reponse = await fetch(`${serveur.replace(/\/$/, '')}/api${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${cle}`, ...(corps === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    const t = await reponse.text();
    if (!reponse.ok) throw new Error(`${methode} ${chemin} → ${reponse.status} ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : null;
  };
}

const lire = async (api, doc, table) => (await api('GET', `/docs/${doc}/tables/${table}/records`)).records.map((r) => ({ id: r.id, ...r.fields }));
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Simule ou applique les modifications. Renvoie { plan, ecrit, verification } ; `verification` (après écriture seulement) liste ce qui n'est
 * pas conforme : lignes ajoutées ou perdues, cellules changées en dehors du plan, Participations modifiée.
 */
async function maj({ api, doc, modifications, appliquer = false, journal = () => {} }) {
  const evenements = await lire(api, doc, 'Evenements');
  let participations = null;
  try { participations = await lire(api, doc, 'Participations'); } catch (e) { journal(`Participations illisible (${e.message.slice(0, 80)}) : elle ne sera pas comparée.`); }
  const plan = planifier(evenements, modifications);
  for (const p of plan) {
    const nom = `${p.m.jour} ${p.m.debut} « ${p.m.titre} »`;
    if (p.etat === 'a-faire') journal(`À FAIRE  ligne ${p.id}, ${nom} : ${Object.entries(p.cellules).map(([c, v]) => `${c} ${JSON.stringify(p.avant[c])} → ${JSON.stringify(v)}`).join(' ; ')}`);
    else if (p.etat === 'deja-fait') journal(`déjà fait  ligne ${p.id}, ${nom}`);
    else journal(`${p.etat.toUpperCase()}  ${nom} : ${p.detail} (à faire à la main)`);
  }
  const faire = plan.filter((p) => p.etat === 'a-faire');
  if (!appliquer || !faire.length) return { plan, ecrit: false, verification: [] };

  // un seul appel : Grist applique toutes les actions d'un bloc, ou aucune (l'API « records » exige les mêmes colonnes pour toutes les lignes)
  await api('POST', `/docs/${doc}/apply`, faire.map((p) => ['UpdateRecord', 'Evenements', p.id, p.cellules]));

  const apres = await lire(api, doc, 'Evenements');
  const verification = [];
  if (apres.length !== evenements.length) verification.push(`Evenements : ${evenements.length} lignes avant, ${apres.length} après`);
  const attendu = new Map(evenements.map((e) => [e.id, { ...e }]));
  for (const p of faire) Object.assign(attendu.get(p.id), p.cellules);
  for (const e of apres) {
    if (!attendu.has(e.id)) verification.push(`Evenements : ligne ${e.id} apparue`);
    else if (!egal(attendu.get(e.id), e)) verification.push(`Evenements : la ligne ${e.id} n'a pas la valeur attendue`);
    attendu.delete(e.id);
  }
  for (const id of attendu.keys()) verification.push(`Evenements : ligne ${id} disparue`);
  if (participations) {
    // Les personnes peuvent cocher pendant ce temps : on ne compare que les présences présentes avant et après.
    const apresP = new Map((await lire(api, doc, 'Participations')).map((l) => [l.id, l]));
    const fige = ({ Evenement, Statut, Email }) => ({ Evenement, Statut, Email });
    for (const l of participations) {
      if (apresP.has(l.id) && !egal(fige(l), fige(apresP.get(l.id)))) verification.push(`Participations : la ligne ${l.id} a changé (${JSON.stringify(fige(l))} → ${JSON.stringify(fige(apresP.get(l.id)))})`);
    }
    const perdues = participations.filter((l) => !apresP.has(l.id)).length;
    if (perdues) journal(`Note : ${perdues} présence(s) retirée(s) par leurs auteurs pendant l'opération (normal si des personnes utilisent le widget).`);
  }
  return { plan, ecrit: true, verification };
}

module.exports = { planifier, maj, clientApi };

if (require.main === module) {
  const arg = (nom) => { const i = process.argv.indexOf(`--${nom}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const doc = arg('doc');
  const cle = process.env.GRIST_API_KEY;
  if (!doc || !cle) {
    console.error('Il faut --doc IDENTIFIANT et la variable GRIST_API_KEY (voir l\'en-tête de ce fichier).');
    process.exit(2);
  }
  const fichier = arg('fichier') || path.join(__dirname, '../../data/modifs-planning-22-oct.json');
  const { modifications } = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  const appliquer = process.argv.includes('--appliquer');
  maj({ api: clientApi(arg('serveur') || 'https://docs.getgrist.com', cle), doc, modifications, appliquer, journal: console.log })
    .then(({ plan, ecrit, verification }) => {
      const faits = plan.filter((p) => p.etat === 'a-faire').length;
      const autres = plan.filter((p) => !['a-faire', 'deja-fait'].includes(p.etat)).length;
      if (!ecrit && appliquer) console.log(`\nRien n'a été écrit : ${faits ? '' : 'tout est déjà à jour'}${autres ? `${faits ? '' : ', sauf '}${autres} séance(s) à traiter à la main (voir plus haut)` : ''}.`);
      else if (!ecrit) console.log(`\nSimulation : ${faits} ligne(s) à modifier, ${autres} à traiter à la main. Rien n'a été écrit. Ajouter --appliquer pour écrire.`);
      else if (verification.length) { console.error(`\nÉCRIT, mais la vérification signale :\n- ${verification.join('\n- ')}`); process.exitCode = 1; }
      else console.log(`\nÉcrit : ${faits} ligne(s) modifiée(s). Vérification : mêmes lignes, aucune autre cellule changée, présences inchangées.`);
    })
    .catch((e) => { console.error(`Échec : ${e.message}`); process.exit(1); });
}
