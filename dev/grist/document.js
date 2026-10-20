/* Crée, dans un vrai Grist local, un document de test construit comme celui d'Antoine :
   Annuaire, Etablissement, Evenements et une table Participations vide (colonnes A, B, C par défaut)
   sur laquelle est posé le widget (accès complet). Le widget crée lui-même les autres colonnes. */
const { api, appliquer, WIDGET, PROPRIETAIRE } = require('./lib');

const ETABLISSEMENTS = [
  ['Université de Bordeaux', 'UB', 'u-bordeaux.fr'],
  ['Bordeaux INP', 'INP', 'bordeaux-inp.fr'],
  ['Université Bordeaux Montaigne', 'BM', 'u-bordeaux-montaigne.fr'],
  ['Sciences Po Bordeaux', 'SP', 'sciencespo-bordeaux.fr'],
  ['INRAE', 'IN', 'inrae.fr'],
];

/** [prénom, nom, domaine, établissement] : Antoine (propriétaire) et Jessica (éditrice) sont les deux premiers. */
const PERSONNES = [
  ['Antoine', 'Philippon', 'u-bordeaux.fr', 'Université de Bordeaux'],
  ['Jessica', 'De Bidegain', 'u-bordeaux.fr', 'Université de Bordeaux'],
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
function evenements() {
  global.window = {};
  require('../evenements.js');
  const liste = global.window.MOCK_EVENEMENTS;
  delete global.window;
  return liste;
}

async function creerDocument(nom = 'Semaine de l’innovation (test)', { widget = WIDGET, acces = 'full' } = {}) {
  const [{ id: espace }] = await api(PROPRIETAIRE, 'GET', '/orgs/current/workspaces');
  const doc = await api(PROPRIETAIRE, 'POST', `/workspaces/${espace}/docs`, { name: nom });
  const liste = evenements();
  const cles = ['Debut', 'Fin', 'Titre', 'Sous_titre', 'Type', 'Temps_fort', 'Lieu', 'Ville', 'Adresse', 'Public', 'Description', 'Lien'];
  await appliquer(PROPRIETAIRE, doc, [
    ['AddTable', 'Annuaire', colonnes(['nom', 'prenom', 'Etablissement', 'email', 'Fonction', 'nom_de_domaine', 'email_affiche'])],
    ['AddTable', 'Etablissement', [...colonnes(['Nom_complet', 'Acronyme', 'nom_de_domaine']), { id: 'Logo', type: 'Attachments', isFormula: false }]],
    ['AddTable', 'Evenements', [{ id: 'Jour', type: 'Date', isFormula: false }, ...colonnes(cles)]],
    // Comme dans le vrai document : une table neuve, avec ses trois colonnes A, B, C par défaut
    ['AddTable', 'Participations', ['A', 'B', 'C'].map((id) => ({ id, type: 'Any', isFormula: true, formula: '' }))],
  ]);
  await appliquer(PROPRIETAIRE, doc, [
    ['BulkAddRecord', 'Etablissement', ETABLISSEMENTS.map(() => null), {
      Nom_complet: ETABLISSEMENTS.map((e) => e[0]), Acronyme: ETABLISSEMENTS.map((e) => e[1]), nom_de_domaine: ETABLISSEMENTS.map((e) => e[2]) }],
    ['BulkAddRecord', 'Annuaire', PERSONNES.map(() => null), {
      prenom: PERSONNES.map((p) => p[0]), nom: PERSONNES.map((p) => p[1]), nom_de_domaine: PERSONNES.map((p) => p[2]),
      Etablissement: PERSONNES.map((p) => p[3]), email: PERSONNES.map(emailDe), email_affiche: PERSONNES.map(emailDe), Fonction: PERSONNES.map(() => 'Chargé·e de mission') }],
    ['BulkAddRecord', 'Evenements', liste.map(() => null), {
      Jour: liste.map((e) => e.Jour), ...Object.fromEntries(cles.map((c) => [c, lots(c, liste)])) }],
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

module.exports = { creerDocument, PERSONNES, emailDe };
