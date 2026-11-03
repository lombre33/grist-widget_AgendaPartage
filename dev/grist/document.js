/* Crée, dans un vrai Grist local, un document de test construit comme celui d'Antoine :
   Annuaire, Etablissement, Evenements et une table Participations vide (colonnes A, B, C par défaut)
   sur laquelle est posé le widget (accès complet). Le widget crée lui-même les autres colonnes. */
const fs = require('node:fs');
const path = require('node:path');
const { api, appliquer, session, GRIST, WIDGET, PROPRIETAIRE } = require('./lib');

const ETABLISSEMENTS = [
  ['Université de Bordeaux', 'UB', 'u-bordeaux.fr'],
  ['Bordeaux INP', 'INP', 'bordeaux-inp.fr', 'enseirb-matmeca.fr; ensc.fr'],   // le quatrième : autres noms de domaine (colonne alt_domain)
  ['Université Bordeaux Montaigne', 'BM', 'u-bordeaux-montaigne.fr'],
  ['Sciences Po Bordeaux', 'SP', 'sciencespo-bordeaux.fr'],
  ['INRAE', 'IN', 'inrae.fr'],
];

/** [prénom, nom, domaine, établissement] : Alix (propriétaire) et Jeanne (éditrice) sont les deux premiers. */
const PERSONNES = [
  ['Alix', 'Marchand', 'u-bordeaux.fr', 'Université de Bordeaux'],
  ['Jeanne', 'Delmas', 'u-bordeaux.fr', 'Université de Bordeaux'],
  ['Karim', 'Benali', 'bordeaux-inp.fr', 'Bordeaux INP'],
  ['Léa', 'Dupont', 'u-bordeaux-montaigne.fr', 'Université Bordeaux Montaigne'],
  ['Hugo', 'Leroy', 'sciencespo-bordeaux.fr', 'Sciences Po Bordeaux'],
  ['Inès', 'Moreau', 'inrae.fr', 'INRAE'],
  ['Sophie', 'Roux', 'exemple.org', 'Association locale'],
];
const emailDe = ([prenom, nom, domaine]) => `${prenom}.${nom}@${domaine}`.toLowerCase().replace(/ /g, '-').normalize('NFD').replace(/[̀-ͯ]/g, '');

const colonnes = (noms, type = 'Text') => noms.map((id) => ({ id, type, isFormula: false }));
const lots = (colonne, valeurs) => valeurs.map((v) => v[colonne]);

/** Les événements du faux Grist (dev/evenements.js), tels qu'ils sont dans la table Evenements. */
let evenementsLus;
function evenements() {
  if (!evenementsLus) {
    global.window = {};
    require('../evenements.js');
    evenementsLus = global.window.MOCK_EVENEMENTS;
    delete global.window;
  }
  return evenementsLus;
}

/** Les publics de la colonne « Cibles » (liste de choix) de la table Evenements : les quatre plannings, plus les personnels. */
const CHOIX_CIBLES = ['Pédagogie', 'Recherche', 'Étudiants', 'Entreprises', 'Personnels'];

/**
 * `cibles: false` : une table Evenements sans la colonne « Cibles », comme avant son ajout.
 * `choixCibles` : les choix déclarés dans la colonne (par exemple les quatre premiers seulement : les valeurs « Personnels » collées
 * depuis le tableur restent alors dans les cellules, hors liste de choix).
 */
async function creerDocument(nom = 'Semaine de l’innovation (test)', { widget = WIDGET, acces = 'full', cibles = true, choixCibles = CHOIX_CIBLES } = {}) {
  const [{ id: espace }] = await api(PROPRIETAIRE, 'GET', '/orgs/current/workspaces');
  const doc = await api(PROPRIETAIRE, 'POST', `/workspaces/${espace}/docs`, { name: nom });
  const liste = evenements();
  const cles = ['Debut', 'Fin', 'Titre', 'Sous_titre', 'Type', 'Temps_fort', 'Lieu', 'Ville', 'Adresse', 'Public', 'Description', 'Lien'];
  await appliquer(PROPRIETAIRE, doc, [
    ['AddTable', 'Annuaire', [...colonnes(['nom', 'prenom', 'Etablissement', 'email', 'Fonction', 'nom_de_domaine', 'email_affiche', 'id_sync']), { id: 'Avatar', type: 'Attachments', isFormula: false }]],
    ['AddTable', 'Etablissement', [...colonnes(['Nom_complet', 'Acronyme', 'nom_de_domaine', 'alt_domain']), { id: 'Logo', type: 'Attachments', isFormula: false }]],
    ['AddTable', 'Evenements', [{ id: 'Jour', type: 'Date', isFormula: false }, ...colonnes(cles),
      ...(cibles ? [{ id: 'Cibles', type: 'ChoiceList', isFormula: false, widgetOptions: JSON.stringify({ choices: choixCibles }) }] : [])]],
    // Comme dans le vrai document : une table neuve, avec ses trois colonnes A, B, C par défaut
    ['AddTable', 'Participations', ['A', 'B', 'C'].map((id) => ({ id, type: 'Any', isFormula: true, formula: '' }))],
  ]);
  await appliquer(PROPRIETAIRE, doc, [
    ['BulkAddRecord', 'Etablissement', ETABLISSEMENTS.map(() => null), {
      Nom_complet: ETABLISSEMENTS.map((e) => e[0]), Acronyme: ETABLISSEMENTS.map((e) => e[1]), nom_de_domaine: ETABLISSEMENTS.map((e) => e[2]), alt_domain: ETABLISSEMENTS.map((e) => e[3] || '') }],
    ['BulkAddRecord', 'Annuaire', PERSONNES.map(() => null), {
      prenom: PERSONNES.map((p) => p[0]), nom: PERSONNES.map((p) => p[1]), nom_de_domaine: PERSONNES.map((p) => p[2]),
      Etablissement: PERSONNES.map((p) => p[3]), email: PERSONNES.map(emailDe), email_affiche: PERSONNES.map(emailDe), Fonction: PERSONNES.map(() => 'Chargé·e de mission') }],
    ['BulkAddRecord', 'Evenements', liste.map(() => null), {
      Jour: liste.map((e) => e.Jour), ...Object.fromEntries(cles.map((c) => [c, lots(c, liste)])),
      ...(cibles ? { Cibles: liste.map((e) => e.Cibles || null) } : {}) }],
  ]);

  // Page « Planning » : un widget personnalisé (URL) lié à Participations
  const tables = await api(PROPRIETAIRE, 'GET', `/docs/${doc}/tables/_grist_Tables/records`);
  const tableRef = tables.records.find((t) => t.fields.tableId === 'Participations').id;
  const [{ sectionRef }] = await appliquer(PROPRIETAIRE, doc, [['CreateViewSection', tableRef, 0, 'custom', null, null]]);
  await appliquer(PROPRIETAIRE, doc, [['UpdateRecord', '_grist_Views_section', sectionRef,
    { options: JSON.stringify({ customView: JSON.stringify({ mode: 'url', url: widget, access: acces, pluginId: '', sectionId: '' }) }) }]]);
  const [section] = (await api(PROPRIETAIRE, 'GET', `/docs/${doc}/tables/_grist_Views_section/records`)).records.filter((r) => r.id === sectionRef);
  await appliquer(PROPRIETAIRE, doc, [['RemoveTable', 'Table1']]);   // la table vide que Grist ajoute à tout document neuf
  return { doc, page: section.fields.parentId, emails: PERSONNES.map(emailDe), tableRef };
}

module.exports = { creerDocument, PERSONNES, emailDe, evenements };

/**
 * Les règles d'accès du document d'Antoine : attribut utilisateur « acl » (user.Email → Annuaire.email),
 * Annuaire modifiable par sa propre ligne et par les propriétaires, Etablissement et Evenements réservés
 * aux propriétaires, lecture pour tous. Aucune règle sur Participations.
 */
async function installerReglesAntoine(doc) {
  const ressources = await appliquer(PROPRIETAIRE, doc, [
    ['AddRecord', '_grist_ACLResources', null, { tableId: '*', colIds: '*' }],
    ['AddRecord', '_grist_ACLResources', null, { tableId: 'Annuaire', colIds: '*' }],
    ['AddRecord', '_grist_ACLResources', null, { tableId: 'Etablissement', colIds: '*' }],
    ['AddRecord', '_grist_ACLResources', null, { tableId: 'Evenements', colIds: '*' }],
  ]);
  const [defaut, annuaire, etablissement, evenements] = ressources;
  const regle = (resource, aclFormula, permissionsText) => ({ resource, aclFormula, permissionsText, memo: '' });
  const rules = [
    { resource: defaut, userAttributes: JSON.stringify({ name: 'acl', tableId: 'Annuaire', lookupColId: 'email', charId: 'Email' }), aclFormula: '', permissionsText: '', memo: '' },
    regle(annuaire, 'rec.email == user.Email', '+R+U-C-D'),
    regle(annuaire, 'user.Access in [OWNER]', '+R+U+C+D'),
    regle(annuaire, '', '+R-U-C-D'),
    regle(etablissement, 'user.Access in [OWNER]', '+R+U+C+D'),
    regle(etablissement, '', '+R-U-C-D'),
    regle(evenements, 'user.Access in [OWNER]', '+R+U+C+D'),
    regle(evenements, '', '+R-U-C-D'),
  ].map((r, i) => ({ ...r, rulePos: i + 1 }));
  await appliquer(PROPRIETAIRE, doc, rules.map((r) => ['AddRecord', '_grist_ACLRules', null, r]));
}

module.exports.installerReglesAntoine = installerReglesAntoine;

/**
 * Les règles recommandées dans le README (audit de sécurité, § 6 B et D) : Annuaire, Etablissement et Evenements en lecture
 * seule sauf pour les propriétaires, et sur Participations chacun ne crée, modifie et supprime que les lignes à son e-mail.
 * Sans attribut utilisateur.
 */
async function installerReglesRecommandees(doc) {
  const [annuaire, etablissement, evenements, participations] = await appliquer(PROPRIETAIRE, doc, ['Annuaire', 'Etablissement', 'Evenements', 'Participations']
    .map((tableId) => ['AddRecord', '_grist_ACLResources', null, { tableId, colIds: '*' }]));
  const regle = (resource, aclFormula, permissionsText) => ({ resource, aclFormula, permissionsText, memo: '' });
  const lectureSeule = (resource) => [regle(resource, 'user.Access in [OWNER]', '+R+U+C+D'), regle(resource, '', '+R-U-C-D')];
  const rules = [
    ...lectureSeule(annuaire), ...lectureSeule(etablissement), ...lectureSeule(evenements),
    regle(participations, 'user.Access in [OWNER]', '+R+U+C+D'),
    regle(participations, 'rec.Email == user.Email and newRec.Email == user.Email', '+U'),
    regle(participations, 'rec.Email == user.Email', '+D'),
    regle(participations, 'newRec.Email == user.Email', '+C'),
    regle(participations, '', '+R-U-C-D'),
  ].map((r, i) => ({ ...r, rulePos: i + 1 }));
  await appliquer(PROPRIETAIRE, doc, rules.map((r) => ['AddRecord', '_grist_ACLRules', null, r]));
}

module.exports.installerReglesRecommandees = installerReglesRecommandees;

/** Colonnes de l'Annuaire dont le widget n'a pas besoin : réservées aux propriétaires. */
const COLONNES_ANNUAIRE_FERMEES = 'email,Fonction,email_affiche,id_sync,Avatar';

/**
 * Document partagé en édition à « toute personne disposant du lien » (README, « Partager sans ajouter chaque personne ») : les règles
 * recommandées, plus l'attribut « acl » et les règles qui donnent à chacun le strict minimum (audit des tables visibles du 23/10/2026) :
 *  - personne anonyme : Evenements et Participations (sans Email ni Utilisateur) ;
 *  - connectée mais hors Annuaire : en plus Etablissement (le widget y cherche son établissement), et elle crée sa ligne de l'Annuaire et ses demandes ;
 *  - personne de l'Annuaire : Evenements, Etablissement, Participations (ses lignes en écriture) et l'Annuaire (nom, prénom, établissement, domaine) ;
 *    ni Demandes_Annuaire, ni les journaux, ni les e-mails des autres ;
 *  - toute autre table, structure comprise : propriétaires seulement.
 * `user.acl.id == 0` ne convient pas : l'identifiant vaut None quand aucune ligne ne correspond.
 */
async function installerReglesPartagePublic(doc) {
  const [defaut, colonnes, colonnesAnnuaire, annuaire, etablissement, evenements, participations, demandes] = await appliquer(PROPRIETAIRE, doc, [['*', '*'], ['Participations', 'Email,Utilisateur'], ['Annuaire', COLONNES_ANNUAIRE_FERMEES],
    ['Annuaire', '*'], ['Etablissement', '*'], ['Evenements', '*'], ['Participations', '*'], ['Demandes_Annuaire', '*']].map(([tableId, colIds]) => ['AddRecord', '_grist_ACLResources', null, { tableId, colIds }]));
  const regle = (resource, aclFormula, permissionsText, memo = '') => ({ resource, aclFormula, permissionsText, memo });
  const horsAnnuaire = 'user.Access not in [OWNER] and not user.acl.id';
  const rules = [
    { resource: defaut, userAttributes: JSON.stringify({ name: 'acl', tableId: 'Annuaire', lookupColId: 'email', charId: 'Email' }), aclFormula: '', permissionsText: '', memo: '' },
    regle(colonnes, horsAnnuaire, '-R'),
    regle(colonnesAnnuaire, 'user.Access not in [OWNER]', '-R'),
    // Annuaire : une personne connectée, pas encore dans l'Annuaire, peut y créer sa propre ligne (une seule : ensuite elle y est) ; rien d'autre
    regle(annuaire, 'user.Access in [OWNER]', '+R+U+C+D'),
    regle(annuaire, 'user.IsLoggedIn and not user.acl.id and newRec.email == user.Email', '+C'),
    regle(annuaire, horsAnnuaire, '-R-U-C-D'),
    regle(annuaire, '', '+R-U-C-D'),
    regle(etablissement, 'user.Access in [OWNER]', '+R+U+C+D'), regle(etablissement, 'not user.IsLoggedIn', '-R-U-C-D'), regle(etablissement, '', '+R-U-C-D'),
    regle(evenements, 'user.Access in [OWNER]', '+R+U+C+D'), regle(evenements, '', '+R-U-C-D'),
    regle(participations, 'user.Access in [OWNER]', '+R+U+C+D'),
    regle(participations, horsAnnuaire, '-U-C-D'),
    regle(participations, 'rec.Email == user.Email and newRec.Email == user.Email', '+U'),
    regle(participations, 'rec.Email == user.Email', '+D'),
    regle(participations, 'newRec.Email == user.Email', '+C'),
    regle(participations, '', '+R-U-C-D'),
    // Demandes d'ajout : une personne connectée, pas encore dans l'Annuaire, écrit ses propres demandes (son e-mail de connexion, ajouté par Grist) et ne lit que les siennes ; une fois dans l'Annuaire, elle n'a plus rien à y voir
    regle(demandes, 'user.Access in [OWNER]', '+R+U+C+D'),
    regle(demandes, 'user.Access not in [OWNER] and user.acl.id', '-R-U-C-D'),
    regle(demandes, 'user.IsLoggedIn and newRec.Email == user.Email', '+C'),
    regle(demandes, 'user.IsLoggedIn and rec.Email == user.Email', '+R+D'),
    regle(demandes, '', '-R-U-C-D'),
    // Toute autre table que celles du widget (journaux de synchro, table ajoutée plus tard) : fermée, et invisible, à qui n'est pas propriétaire
    regle(defaut, 'user.Access not in [OWNER]', '-R-U-C-D'),
    regle(defaut, 'user.Access != OWNER', '-S'),   // « Autoriser les éditeurs à modifier la structure » décoché
  ].map((r, i) => ({ ...r, rulePos: i + 1 }));
  await appliquer(PROPRIETAIRE, doc, rules.map((r) => ['AddRecord', '_grist_ACLRules', null, r]));
}

module.exports.installerReglesPartagePublic = installerReglesPartagePublic;

/**
 * Les règles du document d'Antoine telles qu'elles étaient le 23/10/2026 (captures de sa page « Permissions avancées ») : celles du README
 * pour le partage public, sauf les journaux de synchro (réservés à qui n'est pas « hors Annuaire », donc ouverts à toute personne de l'Annuaire),
 * aucune règle propre aux colonnes de l'Annuaire et aucune règle pour les autres tables. Les journaux et Demandes_Annuaire doivent exister.
 */
async function installerReglesAntoineActuelles(doc) {
  const [defaut, colonnes, annuaire, etablissement, evenements, participations, demandes, journalE, journalM] = await appliquer(PROPRIETAIRE, doc, [['*', '*'], ['Participations', 'Email,Utilisateur'], ['Annuaire', '*'],
    ['Etablissement', '*'], ['Evenements', '*'], ['Participations', '*'], ['Demandes_Annuaire', '*'], ['Journal_Etablissements', '*'], ['Journal_Membres_Espaces_Resana', '*']]
    .map(([tableId, colIds]) => ['AddRecord', '_grist_ACLResources', null, { tableId, colIds }]));
  const regle = (resource, aclFormula, permissionsText, memo = '') => ({ resource, aclFormula, permissionsText, memo });
  const horsAnnuaire = 'user.Access not in [OWNER] and not user.acl.id';
  const rules = [
    { resource: defaut, userAttributes: JSON.stringify({ name: 'acl', tableId: 'Annuaire', lookupColId: 'email', charId: 'Email' }), aclFormula: '', permissionsText: '', memo: '' },
    regle(annuaire, 'user.Access in [OWNER]', '+R+U+C+D'),
    regle(annuaire, 'user.IsLoggedIn and not user.acl.id and newRec.email == user.Email', '+C'),
    regle(annuaire, horsAnnuaire, '-R-U-C-D', 'Vous ne pouvez pas voir l\'annuaire si vous n\'etes pas dedans'),
    regle(annuaire, '', '+R-U-C-D'),
    regle(demandes, 'user.Access in [OWNER]', '+R+U+C+D'),
    regle(demandes, 'user.IsLoggedIn and newRec.Email == user.Email', '+C'),
    regle(demandes, 'user.IsLoggedIn and rec.Email == user.Email', '+R+D'),
    regle(demandes, '', '-R-U-C-D'),
    regle(etablissement, 'user.Access in [OWNER]', '+R+U+C+D'), regle(etablissement, '', '+R-U-C-D'),
    regle(evenements, 'user.Access in [OWNER]', '+R+U+C+D'), regle(evenements, '', '+R-U-C-D'),
    regle(journalE, 'user.Access == VIEWER', '-R', 'Synchro : journaux réservés aux éditeurs'), regle(journalE, horsAnnuaire, '-R-U-C-D'),
    regle(journalM, 'user.Access == VIEWER', '-R', 'Synchro : journaux réservés aux éditeurs'), regle(journalM, horsAnnuaire, '-R-U-C-D'),
    regle(colonnes, horsAnnuaire, '-R'),
    regle(participations, 'user.Access in [OWNER]', '+R+U+C+D'),
    regle(participations, horsAnnuaire, '-U-C-D'),
    regle(participations, 'rec.Email == user.Email and newRec.Email == user.Email', '+U'),
    regle(participations, 'rec.Email == user.Email', '+D'),
    regle(participations, 'newRec.Email == user.Email', '+C'),
    regle(participations, '', '+R-U-C-D'),
  ].map((r, i) => ({ ...r, rulePos: i + 1 }));
  await appliquer(PROPRIETAIRE, doc, rules.map((r) => ['AddRecord', '_grist_ACLRules', null, r]));
}

module.exports.installerReglesAntoineActuelles = installerReglesAntoineActuelles;

/**
 * Les changements du guide « Qui voit quelle table » appliqués aux règles d'Antoine du 23/10 (installerReglesAntoineActuelles), dans l'ordre du guide :
 * 1. colonnes de l'Annuaire fermées ; 2. Demandes_Annuaire fermée aux personnes de l'Annuaire ; 3. Etablissement fermé aux personnes non connectées ;
 * 4. règle des autres tables (journaux compris) et structure. Les règles propres aux journaux restent en place.
 */
async function appliquerChangementsGuide(doc) {
  const ressources = (await api(PROPRIETAIRE, 'GET', `/docs/${doc}/tables/_grist_ACLResources/records`)).records;
  const regles = (await api(PROPRIETAIRE, 'GET', `/docs/${doc}/tables/_grist_ACLRules/records`)).records;
  const ressource = (tableId, colIds) => ressources.find((r) => r.fields.tableId === tableId && r.fields.colIds === colIds).id;
  const premiere = (resource) => Math.min(...regles.filter((r) => r.fields.resource === resource).map((r) => r.fields.rulePos));
  const apresLaPremiere = (resource) => premiere(resource) + 0.5;   // « + » sur la règle des propriétaires : la nouvelle ligne se glisse juste dessous
  const [colonnes] = await appliquer(PROPRIETAIRE, doc, [['AddRecord', '_grist_ACLResources', null, { tableId: 'Annuaire', colIds: COLONNES_ANNUAIRE_FERMEES }]]);
  const fin = Math.max(...regles.map((r) => r.fields.rulePos)) + 1;
  const demandes = ressource('Demandes_Annuaire', '*');
  const etablissement = ressource('Etablissement', '*');
  const defautId = ressources.find((r) => r.fields.tableId === '*').id;
  await appliquer(PROPRIETAIRE, doc, [
    ['AddRecord', '_grist_ACLRules', null, { resource: colonnes, aclFormula: 'user.Access not in [OWNER]', permissionsText: '-R', memo: '', rulePos: 0 }],
    ['AddRecord', '_grist_ACLRules', null, { resource: demandes, aclFormula: 'user.Access not in [OWNER] and user.acl.id', permissionsText: '-R-U-C-D', memo: '', rulePos: apresLaPremiere(demandes) }],
    ['AddRecord', '_grist_ACLRules', null, { resource: etablissement, aclFormula: 'not user.IsLoggedIn', permissionsText: '-R-U-C-D', memo: '', rulePos: apresLaPremiere(etablissement) }],
    ['AddRecord', '_grist_ACLRules', null, { resource: defautId, aclFormula: 'user.Access not in [OWNER]', permissionsText: '-R-U-C-D', memo: '', rulePos: fin }],
    ['AddRecord', '_grist_ACLRules', null, { resource: defautId, aclFormula: 'user.Access != OWNER', permissionsText: '-S', memo: '', rulePos: fin + 1 }],
  ]);
}

module.exports.appliquerChangementsGuide = appliquerChangementsGuide;

/** Donne un logo (pièce jointe Grist) aux deux premiers établissements : le logo de la Semaine de l'innovation. */
async function ajouterLogos(doc) {
  const image = fs.readFileSync(path.join(__dirname, '../../assets/logo-semaine-innovation.jpg'));
  const form = new FormData();
  form.append('upload', new Blob([image], { type: 'image/jpeg' }), 'logo.jpg');
  const reponse = await fetch(`${GRIST}/api/docs/${doc}/attachments`, { method: 'POST', headers: { Cookie: await session(PROPRIETAIRE), 'X-Requested-With': 'XMLHttpRequest' }, body: form });
  if (!reponse.ok) throw new Error(`envoi du logo impossible : ${reponse.status} ${await reponse.text()}`);
  const [piece] = await reponse.json();
  await appliquer(PROPRIETAIRE, doc, [1, 2].map((id) => ['UpdateRecord', 'Etablissement', id, { Logo: ['L', piece] }]));
}

const supprimerDocument = (doc) => api(PROPRIETAIRE, 'DELETE', `/docs/${doc}`).catch(() => {});

module.exports.ajouterLogos = ajouterLogos;
module.exports.supprimerDocument = supprimerDocument;

/**
 * La variante « communicants » (widget en `?variante=communicants`) : une table vide Communicants_Participations (colonnes A, B, C par défaut,
 * comme celle qu'Antoine crée) et une page « Communicants » avec le widget lié à cette table. Le widget crée lui-même Communicants_Inscrits,
 * Communicants_Demandes et les colonnes de Communicants_Participations, à sa première ouverture par un propriétaire.
 * Renvoie { pageCom } : l'identifiant de la page.
 */
async function ajouterCommunicants(doc, widget = WIDGET, table = 'Communicants_Participations') {
  // `table` : la table à laquelle le widget est lié (par défaut la bonne ; une autre pour reproduire un widget ajouté sur la mauvaise table)
  await appliquer(PROPRIETAIRE, doc, [['AddTable', table, ['A', 'B', 'C'].map((id) => ({ id, type: 'Any', isFormula: true, formula: '' }))]]);
  const tables = await api(PROPRIETAIRE, 'GET', `/docs/${doc}/tables/_grist_Tables/records`);
  const tableRef = tables.records.find((t) => t.fields.tableId === table).id;
  const [{ sectionRef }] = await appliquer(PROPRIETAIRE, doc, [['CreateViewSection', tableRef, 0, 'custom', null, null]]);
  const url = `${widget}${widget.includes('?') ? '&' : '?'}variante=communicants`;
  await appliquer(PROPRIETAIRE, doc, [['UpdateRecord', '_grist_Views_section', sectionRef,
    { options: JSON.stringify({ customView: JSON.stringify({ mode: 'url', url, access: 'full', pluginId: '', sectionId: '' }) }) }]]);
  const [section] = (await api(PROPRIETAIRE, 'GET', `/docs/${doc}/tables/_grist_Views_section/records`)).records.filter((r) => r.id === sectionRef);
  return { pageCom: section.fields.parentId };
}

module.exports.ajouterCommunicants = ajouterCommunicants;

/**
 * Les règles d'accès des tables des communicant·es, jumelles de celles de l'Annuaire, de Participations et de Demandes_Annuaire, à AJOUTER aux règles du
 * partage public (installerReglesPartagePublic) une fois le widget ouvert par un propriétaire (c'est lui qui crée les tables). Les règles existantes
 * ne changent pas. Un second attribut utilisateur, `acl_com` (user.Email → Communicants_Inscrits.email), dit si la personne est inscrite :
 *  - Communicants_Inscrits : une personne connectée, pas encore inscrite, y crée sa propre ligne (une seule) ; les inscrites lisent nom, prénom,
 *    établissement et domaine des autres, jamais les e-mails ; seuls les propriétaires modifient ou suppriment ;
 *  - Communicants_Participations : chacune crée, modifie et supprime ses lignes (son e-mail, ajouté par Grist) ; tout le monde lit les présences, sans
 *    e-mail pour qui n'est pas inscrit (la colonne `Utilisateur`, un simple numéro de fiche, reste lisible : voir plus bas) ; les personnes non inscrites ne peuvent rien y écrire ;
 *  - Communicants_Demandes : une personne connectée, pas encore inscrite, y laisse sa trace et ne lit que la sienne ; une fois inscrite elle n'a plus rien à y voir.
 */
async function installerReglesCommunicants(doc) {
  const existantes = (await api(PROPRIETAIRE, 'GET', `/docs/${doc}/tables/_grist_ACLRules/records`)).records;
  const defaut = (await api(PROPRIETAIRE, 'GET', `/docs/${doc}/tables/_grist_ACLResources/records`)).records.find((r) => r.fields.tableId === '*').id;
  const fin = Math.max(...existantes.map((r) => r.fields.rulePos)) + 1;
  const [colonnesInscrits, inscrits, colonnesPart, participations, demandes] = await appliquer(PROPRIETAIRE, doc, [['Communicants_Inscrits', 'email'], ['Communicants_Inscrits', '*'],
    ['Communicants_Participations', 'Email'], ['Communicants_Participations', '*'], ['Communicants_Demandes', '*']]
    .map(([tableId, colIds]) => ['AddRecord', '_grist_ACLResources', null, { tableId, colIds }]));
  const regle = (resource, aclFormula, permissionsText, memo = '') => ({ resource, aclFormula, permissionsText, memo });
  const horsListe = 'user.Access not in [OWNER] and not user.acl_com.id';
  // Pourquoi la règle de colonne de Communicants_Participations ne ferme que `Email`, contrairement à Participations (qui ferme aussi `Utilisateur`) :
  // une personne qui vient de s'inscrire garde, jusqu'à ce qu'elle recharge la page de Grist, les droits qu'elle avait avant (le flux `onRecords` du
  // widget vient du navigateur de Grist, rempli au chargement). Avec `Utilisateur` fermé, elle ne verrait alors le nom de personne sur les événements.
  // `Utilisateur` n'est qu'un numéro de fiche : sans la table des inscrits (fermée aux non-inscrits) il ne dit rien.
  const rules = [
    regle(colonnesInscrits, 'user.Access not in [OWNER]', '-R'),
    regle(inscrits, 'user.Access in [OWNER]', '+R+U+C+D'),
    regle(inscrits, 'user.IsLoggedIn and not user.acl_com.id and newRec.email == user.Email', '+C'),
    regle(inscrits, horsListe, '-R-U-C-D'),
    regle(inscrits, '', '+R-U-C-D'),
    regle(colonnesPart, horsListe, '-R'),
    regle(participations, 'user.Access in [OWNER]', '+R+U+C+D'),
    regle(participations, horsListe, '-U-C-D'),
    regle(participations, 'rec.Email == user.Email and newRec.Email == user.Email', '+U'),
    regle(participations, 'rec.Email == user.Email', '+D'),
    regle(participations, 'newRec.Email == user.Email', '+C'),
    regle(participations, '', '+R-U-C-D'),
    regle(demandes, 'user.Access in [OWNER]', '+R+U+C+D'),
    regle(demandes, 'user.Access not in [OWNER] and user.acl_com.id', '-R-U-C-D'),
    regle(demandes, 'user.IsLoggedIn and newRec.Email == user.Email', '+C'),
    regle(demandes, 'user.IsLoggedIn and rec.Email == user.Email', '+R+D'),
    regle(demandes, '', '-R-U-C-D'),
  ].map((r, i) => ({ ...r, rulePos: fin + i }));
  // l'attribut utilisateur vient avant toute règle qui l'utilise (juste après l'attribut `acl`, en tête)
  const attribut = { resource: defaut, userAttributes: JSON.stringify({ name: 'acl_com', tableId: 'Communicants_Inscrits', lookupColId: 'email', charId: 'Email' }), aclFormula: '', permissionsText: '', memo: '', rulePos: 1.5 };
  await appliquer(PROPRIETAIRE, doc, [attribut, ...rules].map((r) => ['AddRecord', '_grist_ACLRules', null, r]));
}

module.exports.installerReglesCommunicants = installerReglesCommunicants;
