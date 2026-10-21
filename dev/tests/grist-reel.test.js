/* Le widget dans un vrai Grist (image officielle, voir dev/grist/serveur.sh), avec plusieurs personnes connectées
   en même temps : première ouverture, enregistrement des choix, relecture, mise à jour en direct, règles d'accès
   d'Antoine, personnes sans droit, logos en pièces jointes. Ces tests sont ignorés si Grist ne répond pas. */
'use strict';
const { spawnSync } = require('node:child_process');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { serveur, lancerNavigateur, attendre, pause, SEL } = require('./helpers');
const { GRIST, PROPRIETAIRE, scriptApiReel, api, appliquer, lignes, partager, contexteNavigateur } = require('../grist/lib');
const { creerDocument, installerReglesAntoine, installerReglesRecommandees, installerReglesPartagePublic, ajouterLogos, supprimerDocument, evenements } = require('../grist/document');

const PROPRIO = PROPRIETAIRE;
const JEANNE = 'jeanne.delmas@u-bordeaux.fr';
const KARIM = 'karim.benali@bordeaux-inp.fr';
const INCONNU = 'inconnu@exemple.org';

const grist = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--noproxy', '*', '-m', '3', `${GRIST}/status`], { encoding: 'utf8' });
const disponible = grist.stdout.trim() === '200';

describe('vrai Grist', { skip: disponible ? false : `Grist ne répond pas sur ${GRIST} : lancer sh dev/grist/serveur.sh` }, () => {
  let srv; let navigateur; const docs = [];
  before(async () => { srv = await serveur(); navigateur = await lancerNavigateur(); });
  after(async () => { await navigateur.close(); await srv.fermer(); for (const d of docs) await supprimerDocument(d); });

  /** Un document neuf (structure et données d'Antoine), partagé en édition avec les autres personnes de l'Annuaire. */
  async function nouveau({ regles = false, recommandees = false, publique = false, logos = false, preparer = true, cibles = true } = {}) {
    const r = await creerDocument(`Test ${new Date().toISOString()}`, { widget: `${srv.url}/index.html`, cibles });
    docs.push(r.doc);
    for (const email of r.emails.slice(1)) await partager(r.doc, email, 'editors');
    if (regles) await installerReglesAntoine(r.doc);
    if (recommandees) await installerReglesRecommandees(r.doc);
    if (logos) await ajouterLogos(r.doc);
    if (preparer) {   // première ouverture par le propriétaire : le widget crée les colonnes de Participations
      const { page } = await ouvrir(PROPRIO, r);
      await page.context().close();
    }
    if (publique) {   // partagé à « toute personne disposant du lien » : plus aucun partage nominatif, sauf le propriétaire
      await installerReglesPartagePublic(r.doc);
      const retraits = Object.fromEntries(r.emails.slice(1).map((email) => [email, null]));
      await api(PROPRIO, 'PATCH', `/docs/${r.doc}/access`, { delta: { users: { ...retraits, 'everyone@getgrist.com': 'editors' } } });
    }
    return r;
  }

  /** Ouvre la page du widget comme cette personne ; renvoie la page Grist et le cadre du widget. */
  async function ouvrir(utilisateur, doc, { largeur = 1300, hauteur = 900, suffixe = '', apiEval, scriptApi, formulaire = false } = {}) {
    const contexte = await contexteNavigateur(navigateur, utilisateur, { viewport: { width: largeur, height: hauteur }, formulaire, ...(apiEval === undefined ? {} : { apiEval }), ...(scriptApi ? { scriptApi } : {}) });
    const page = await contexte.newPage();
    page.erreurs = [];
    page.on('pageerror', (e) => page.erreurs.push(e.message));
    page.navigations = 0;       // chargements de la page Grist
    page.chargementsWidget = 0; // chargements du cadre du widget (Grist le recharge quand il recharge le document)
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) page.navigations += 1;
      else if (f.url().startsWith(srv.url)) page.chargementsWidget += 1;
    });
    await page.goto(`${GRIST}/${doc.doc}/x/p/${doc.page}${suffixe}`);
    const widget = await attendre(() => page.frames().find((f) => f.url().startsWith(srv.url)), { message: 'le widget ne s\'est pas chargé' });
    await widget.waitForSelector(SEL.evenement, { timeout: 30000 }).catch(async () => {
      throw new Error(`aucun événement affiché : ${(await widget.locator('body').innerText()).slice(0, 300)}`);
    });
    await attendre(() => widget.locator(SEL.pied).innerText().then((t) => t.includes('ligne')), { message: 'présences non reçues' });
    await page.mainFrame().evaluate(() => { if (document.activeElement) document.activeElement.blur(); });   // le focus quitte le widget (sa fenêtre d'accès a pu le prendre) ...
    await page.keyboard.press('Escape');   // ... pour que Échap ferme la visite guidée de Grist, et non la fenêtre du widget
    await pause(300);
    return { page, widget, contexte };
  }

  const carte = (widget, titre) => widget.locator(SEL.evenement, { hasText: titre });
  const comptes = (widget, titre) => carte(widget, titre).evaluate((e) => ['sur', 'probable'].map((c) => Number(((e.querySelector(`.compte--${c}`) || {}).textContent || '0').match(/\d+/)[0])));
  const participations = (utilisateur, doc) => lignes(utilisateur, doc.doc, 'Participations');
  const miennes = async (utilisateur, doc, email) => (await participations(utilisateur, doc)).filter((l) => l.Email === email);
  const evenementId = async (doc, titre) => (await lignes(PROPRIO, doc.doc, 'Evenements')).find((e) => e.Titre.startsWith(titre)).id;
  const colonnes = async (doc) => Object.fromEntries((await api(PROPRIO, 'GET', `/docs/${doc.doc}/tables/Participations/columns`)).columns.map((c) => [c.id, c.fields]));
  const sansEcho = (liste) => liste.map(({ id, Email, Evenement, Statut, Utilisateur }) => ({ id, Email, Evenement, Statut, Utilisateur }));

  describe('première ouverture', () => {
    test('le propriétaire ouvre : le widget crée les colonnes de Participations, le reconnaît, ne laisse aucune ligne', async () => {
      const doc = await nouveau({ preparer: false });
      assert.deepEqual(Object.keys(await colonnes(doc)).sort(), ['A', 'B', 'C']);
      const { page, widget } = await ouvrir(PROPRIO, doc);
      assert.equal(await widget.locator(SEL.nom).innerText(), 'Alix Marchand');
      assert.equal(await widget.locator(SEL.evenement).count(), 30);
      const c = await colonnes(doc);
      assert.deepEqual(Object.keys(c).sort(), ['A', 'B', 'C', 'Email', 'Evenement', 'Statut', 'Utilisateur']);
      assert.equal(c.Email.type, 'Text');
      assert.equal(c.Email.isFormula, false);
      assert.equal(c.Email.formula, 'user.Email');
      assert.equal(c.Email.recalcWhen, 0, '« à la création » (0), pas « jamais » (1)');
      assert.equal(c.Utilisateur.type, 'Ref:Annuaire');
      assert.equal(c.Utilisateur.isFormula, true);
      assert.equal(c.Evenement.type, 'Ref:Evenements');
      assert.equal(c.Statut.type, 'Choice');
      assert.deepEqual(JSON.parse(c.Statut.widgetOptions).choices, ['présent', 'à confirmer']);
      assert.equal((await participations(PROPRIO, doc)).length, 0, 'la ligne de connexion est supprimée');
      assert.deepEqual(page.erreurs, []);
    });

    test('colonnes d\'une ancienne version (Email jamais calculée) : recréées toutes seules, la personne est reconnue', async () => {
      const doc = await nouveau({ preparer: false });
      await appliquer(PROPRIO, doc.doc, [
        ['AddColumn', 'Participations', 'Email', { type: 'Text', isFormula: false, formula: 'user.Email', recalcWhen: 1 }],
        ['AddColumn', 'Participations', 'Utilisateur', { type: 'Ref:Annuaire', isFormula: true, formula: 'return None' }],
        ['AddColumn', 'Participations', 'Evenement', { type: 'Ref:Evenements', isFormula: false }],
        ['AddColumn', 'Participations', 'Statut', { type: 'Choice', isFormula: false }],
      ]);
      assert.equal((await colonnes(doc)).Email.recalcWhen, 1);
      const { widget } = await ouvrir(PROPRIO, doc);
      assert.equal(await widget.locator(SEL.nom).innerText(), 'Alix Marchand');
      assert.equal((await colonnes(doc)).Email.recalcWhen, 0);
      assert.match((await colonnes(doc)).Utilisateur.formula, /Annuaire\.all/);
    });

    test('un éditeur qui ouvre le premier : le widget fonctionne (ou dit clairement qu\'il ne peut pas créer les colonnes)', async () => {
      const doc = await nouveau({ preparer: false });
      const { widget } = await ouvrir(JEANNE, doc);
      const colonnesCreees = 'Statut' in await colonnes(doc);
      if (colonnesCreees) {
        assert.equal(await widget.locator(SEL.nom).innerText(), 'Jeanne Delmas');
      } else {
        assert.match(await widget.locator(SEL.etat).textContent(), /pas encore prêt à enregistrer/);
        assert.equal(await widget.locator('button[data-action="choisir"]').count(), 0);
      }
    });
  });

  describe('publics visés (colonne Cibles, liste de choix)', () => {
    test('la colonne est lue, une bulle par public, le filtre garde les bons événements et le choix reste au rechargement', async () => {
      const doc = await nouveau();
      const { page, widget } = await ouvrir(PROPRIO, doc);
      assert.deepEqual(await widget.locator('.bulle').allInnerTexts(), ['Pédagogie', 'Recherche', 'Étudiants', 'Entreprises', 'Personnels']);
      await widget.locator('[data-cible="etudiants"]').evaluate((b) => b.click());   // le voile d'accueil de Grist peut intercepter un vrai clic
      assert.equal(await widget.locator(SEL.evenement).count(), 7);
      assert.equal(await carte(widget, 'Atelier Durable').count(), 1);
      assert.equal(await carte(widget, 'Transmedia').count(), 0);
      await page.reload();
      const widget2 = await attendre(() => page.frames().find((f) => f.url().startsWith(srv.url)), { message: 'le widget ne s\'est pas rechargé' });
      await widget2.waitForSelector(SEL.evenement, { timeout: 30000 });
      assert.equal(await widget2.locator('[data-cible="etudiants"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await widget2.locator(SEL.evenement).count(), 7);
      assert.deepEqual(page.erreurs, []);
    });

    test('Personnels : le serious game seul, y compris quand la valeur est hors de la liste de choix de la colonne ; les autres publics gardent leurs comptes', async () => {
      const doc = await nouveau({ choixCibles: ['Pédagogie', 'Recherche', 'Étudiants', 'Entreprises'] });
      const { page, widget } = await ouvrir(PROPRIO, doc);
      await widget.locator('[data-cible="personnels"]').evaluate((b) => b.click());
      assert.equal(await widget.locator(SEL.evenement).count(), 1);
      assert.equal(await carte(widget, 'No wrong door').count(), 1);
      await widget.locator('[data-cible="personnels"]').evaluate((b) => b.click());
      for (const [code, attendu] of [['pedagogie', 13], ['recherche', 16], ['etudiants', 7], ['entreprises', 13]]) {
        await widget.locator(`[data-cible="${code}"]`).evaluate((b) => b.click());
        assert.equal(await widget.locator(SEL.evenement).count(), attendu, code);
        await widget.locator(`[data-cible="${code}"]`).evaluate((b) => b.click());
      }
      assert.equal(await widget.locator(SEL.evenement).count(), 30);
      assert.deepEqual(page.erreurs, []);
    });

    const cibles = async (doc) => (await lignes(PROPRIO, doc.doc, 'Evenements')).map((e) => [e.Titre, e.Cibles || null]);
    const colonneCibles = async (doc) => (await api(PROPRIO, 'GET', `/docs/${doc.doc}/tables/Evenements/columns`)).columns.find((c) => c.id === 'Cibles');
    const attendues = () => evenements().map((e) => [e.Titre, e.Cibles || null]);   // les valeurs de dev/evenements.js, comme l'Excel livré

    test('sans colonne Cibles, le propriétaire qui ouvre le widget la voit créée (liste de choix) et remplie d\'après les plannings ; les autres personnes la voient', async () => {
      const doc = await nouveau({ cibles: false });   // la première ouverture du propriétaire (dans nouveau) a créé la colonne
      const colonne = await colonneCibles(doc);
      assert.equal(colonne.fields.type, 'ChoiceList');
      assert.deepEqual(JSON.parse(colonne.fields.widgetOptions).choices, ['Pédagogie', 'Recherche', 'Étudiants', 'Entreprises', 'Personnels']);
      assert.deepEqual(await cibles(doc), attendues());
      const { page, widget } = await ouvrir(PROPRIO, doc);
      assert.deepEqual(await widget.locator('.bulle').allInnerTexts(), ['Pédagogie', 'Recherche', 'Étudiants', 'Entreprises', 'Personnels']);
      await widget.locator('[data-cible="entreprises"]').evaluate((b) => b.click());
      assert.equal(await widget.locator(SEL.evenement).count(), 13);
      assert.deepEqual(page.erreurs, []);
      const j = await ouvrir(JEANNE, doc);
      assert.deepEqual(await j.widget.locator('.bulle').allInnerTexts(), ['Pédagogie', 'Recherche', 'Étudiants', 'Entreprises', 'Personnels']);
      assert.deepEqual(await cibles(doc), attendues(), 'rouvrir ne change rien');
    });

    test('sans colonne Cibles et avec les règles d\'Antoine (Evenements modifiable par les seuls propriétaires), une éditrice n\'en crée pas : rien à moitié créé, pas de rangée de bulles, planning inchangé, aucune erreur', async () => {
      const doc = await nouveau({ cibles: false, regles: true });
      await appliquer(PROPRIO, doc.doc, [['RemoveColumn', 'Evenements', 'Cibles']]);
      const j = await ouvrir(JEANNE, doc);
      await pause(1500);
      assert.equal(await j.widget.locator('#cibles').isVisible(), false);
      assert.equal(await j.widget.locator(SEL.evenement).count(), 30);
      assert.equal(await colonneCibles(doc), undefined, 'la colonne n\'a pas été créée, même à moitié');
      assert.deepEqual(j.page.erreurs, []);
      // puis le propriétaire ouvre : la colonne est créée et remplie
      const p = await ouvrir(PROPRIO, doc);
      await attendre(() => p.widget.locator('#cibles').isVisible(), { message: 'la rangée « Pour qui ? » n\'est pas apparue chez le propriétaire' });
      assert.deepEqual(await cibles(doc), attendues());
    });

    test('colonne Cibles déjà là : jamais modifiée, même quand une valeur a été changée ou effacée à la main', async () => {
      const doc = await nouveau();
      assert.deepEqual(await cibles(doc), attendues());
      const [premier, second] = await lignes(PROPRIO, doc.doc, 'Evenements');
      await appliquer(PROPRIO, doc.doc, [['BulkUpdateRecord', 'Evenements', [premier.id, second.id], { Cibles: [['L', 'Personnels'], null] }]]);
      const avant = await cibles(doc);
      assert.deepEqual(avant[0], [premier.Titre, ['L', 'Personnels']]);
      assert.equal(avant[1][1], null);
      const { page, widget } = await ouvrir(PROPRIO, doc);
      await pause(1500);
      assert.deepEqual(await cibles(doc), avant);
      await widget.locator('[data-cible="personnels"]').evaluate((b) => b.click());
      assert.equal(await widget.locator(SEL.evenement).count(), 2, 'le serious game et la séance rangée à la main');
      assert.deepEqual(page.erreurs, []);
    });
  });

  describe('enregistrer ses choix', () => {
    test('présent, à confirmer, retiré : une seule ligne, aux bonnes valeurs, relue par Grist', async () => {
      const doc = await nouveau();
      const evt = await evenementId(doc, 'Atelier Durable');
      const { page, widget } = await ouvrir(PROPRIO, doc);
      const c = carte(widget, 'Atelier Durable');

      await c.locator(SEL.present).click();
      await attendre(async () => (await miennes(PROPRIO, doc, PROPRIO)).length === 1, { message: 'ligne non créée' });
      let [ligne] = await miennes(PROPRIO, doc, PROPRIO);
      assert.deepEqual(sansEcho([ligne])[0], { id: ligne.id, Email: PROPRIO, Evenement: evt, Statut: 'présent', Utilisateur: 1 });
      await attendre(async () => (await comptes(widget, 'Atelier Durable')).join() === '1,0');
      assert.equal(await c.locator(SEL.present).getAttribute('aria-pressed'), 'true');
      assert.match(await widget.locator(SEL.pied).innerText(), /· 1 ligne dans « Participations »/);

      await c.locator(SEL.aConfirmer).click();
      await attendre(async () => (await miennes(PROPRIO, doc, PROPRIO))[0].Statut === 'à confirmer', { message: 'statut non modifié' });
      assert.equal((await miennes(PROPRIO, doc, PROPRIO)).length, 1, 'la ligne est modifiée, pas dupliquée');
      assert.equal((await miennes(PROPRIO, doc, PROPRIO))[0].id, ligne.id);
      await attendre(async () => (await comptes(widget, 'Atelier Durable')).join() === '0,1');

      await c.locator(SEL.aConfirmer).click();   // recliquer retire
      await attendre(async () => (await miennes(PROPRIO, doc, PROPRIO)).length === 0, { message: 'ligne non supprimée' });
      await attendre(async () => /Personne pour l’instant/.test(await c.innerText()));
      assert.deepEqual(page.erreurs, []);
    });

    test('plusieurs clics rapides sur le même événement : jamais de doublon', async () => {
      const doc = await nouveau();
      const { widget } = await ouvrir(PROPRIO, doc);
      const c = carte(widget, 'Atelier Durable');
      for (const bouton of [SEL.present, SEL.aConfirmer, SEL.aConfirmer, SEL.present, SEL.aConfirmer]) { await c.locator(bouton).click(); await pause(60); }
      await pause(1500);
      assert.ok((await miennes(PROPRIO, doc, PROPRIO)).length <= 1, 'au plus une ligne pour cet événement');
    });

    test('les choix sont relus après un rechargement de la page', async () => {
      const doc = await nouveau();
      let { page, widget } = await ouvrir(PROPRIO, doc);
      await carte(widget, 'Atelier Durable').locator(SEL.present).click();
      await carte(widget, 'Le Transmedia').locator(SEL.aConfirmer).click();
      await attendre(async () => (await participations(PROPRIO, doc)).length === 2);
      await page.reload();
      widget = await attendre(() => page.frames().find((f) => f.url().startsWith(srv.url)));
      await widget.waitForSelector(SEL.evenement);
      await attendre(async () => (await comptes(widget, 'Atelier Durable')).join() === '1,0');
      assert.deepEqual(await comptes(widget, 'Le Transmedia'), [0, 1]);
      assert.equal(await carte(widget, 'Atelier Durable').locator(SEL.present).getAttribute('aria-pressed'), 'true');
      assert.match(await widget.locator(SEL.filtre).innerText(), /Mon programme \(2\)/);
    });

    test('chaque ligne porte l\'identité de la personne qui a coché (par formule), pas celle d\'une autre', async () => {
      const doc = await nouveau();
      const a = await ouvrir(PROPRIO, doc);
      const j = await ouvrir(JEANNE, doc);
      await carte(a.widget, 'Atelier Durable').locator(SEL.present).click();
      await carte(j.widget, 'Atelier Durable').locator(SEL.aConfirmer).click();
      await attendre(async () => (await participations(PROPRIO, doc)).length === 2);
      const toutes = sansEcho(await participations(PROPRIO, doc));
      assert.deepEqual(toutes.map((l) => [l.Email, l.Utilisateur, l.Statut]).sort(), [[PROPRIO, 1, 'présent'], [JEANNE, 2, 'à confirmer']].sort());
    });

    test('doublons laissés par une ancienne version : supprimés au changement de choix', async () => {
      const doc = await nouveau();
      const evt = await evenementId(doc, 'Atelier Durable');
      const ajout = (statut) => ['AddRecord', 'Participations', null, { Evenement: evt, Statut: statut }];
      await appliquer(JEANNE, doc.doc, [ajout('à confirmer'), ajout('présent'), ajout('présent')]);
      const { widget } = await ouvrir(JEANNE, doc);
      assert.equal(await carte(widget, 'Atelier Durable').locator(SEL.present).getAttribute('aria-pressed'), 'true');
      await carte(widget, 'Atelier Durable').locator(SEL.aConfirmer).click();
      await attendre(async () => (await miennes(JEANNE, doc, JEANNE)).length === 1, { message: 'doublons non supprimés' });
      assert.equal((await miennes(JEANNE, doc, JEANNE))[0].Statut, 'à confirmer');
    });

    test('ménage : mes lignes de connexion restées là sont supprimées au premier clic, pas celles des autres', async () => {
      const doc = await nouveau();
      await appliquer(JEANNE, doc.doc, [['AddRecord', 'Participations', null, {}], ['AddRecord', 'Participations', null, {}]]);
      await appliquer(KARIM, doc.doc, [['AddRecord', 'Participations', null, {}]]);
      const { widget } = await ouvrir(JEANNE, doc);
      assert.equal((await participations(JEANNE, doc)).length, 3, 'rien n\'est supprimé à l\'ouverture');
      await carte(widget, 'Atelier Durable').locator(SEL.present).click();
      await attendre(async () => (await participations(JEANNE, doc)).length === 2, { message: 'ménage non fait' });
      const restantes = await participations(JEANNE, doc);
      assert.deepEqual(restantes.map((l) => l.Email).sort(), [JEANNE, KARIM].sort());
      assert.equal(restantes.filter((l) => l.Evenement).length, 1);
    });
  });

  describe('chargement de la page (adresse du document et script de l\'API de Grist)', () => {
    test('la page ouverte avec ?style=singlePage (document intégré dans une autre page) affiche le planning et enregistre un choix', async () => {
      const doc = await nouveau();
      const { widget } = await ouvrir(JEANNE, doc, { suffixe: '?style=singlePage' });
      assert.equal(await widget.locator(SEL.nom).innerText(), 'Jeanne Delmas');
      assert.equal(await widget.locator(SEL.evenement).count(), 30);
      assert.doesNotMatch(await widget.locator('body').innerText(), /s’utilise dans Grist/);
      await carte(widget, 'Atelier Durable').locator(SEL.present).click();
      await attendre(async () => (await miennes(JEANNE, doc, JEANNE)).length === 1);
    });

    test('avec le vrai script https://docs.getgrist.com/grist-plugin-api.js et ?style=singlePage (ignoré si ce site n\'est pas joignable)', async (t) => {
      const scriptApi = await scriptApiReel();
      if (!scriptApi) { t.skip('docs.getgrist.com injoignable depuis cette machine'); return; }
      const doc = await nouveau();
      const { widget } = await ouvrir(JEANNE, doc, { suffixe: '?style=singlePage', scriptApi });
      assert.equal(await widget.locator(SEL.nom).innerText(), 'Jeanne Delmas');
      assert.equal(await widget.locator(SEL.evenement).count(), 30);
    });

    for (const apiEval of [true, false]) {
      test(`le widget démarre avec le script de l'API de Grist ${apiEval ? 'en « build eval » (tel que le sert docs.getgrist.com)' : 'servi tel quel'}`, async () => {
        const doc = await nouveau();
        const { widget } = await ouvrir(JEANNE, doc, { apiEval });
        assert.equal(await widget.locator(SEL.nom).innerText(), 'Jeanne Delmas');
        assert.equal(await widget.locator(SEL.evenement).count(), 30);
        assert.equal(await widget.evaluate(() => typeof grist), 'object');
      });
    }
  });

  describe('plusieurs personnes en même temps', () => {
    test('un choix apparaît en direct chez les autres, sans rechargement, avec le nom et l\'établissement', async () => {
      const doc = await nouveau();
      const a = await ouvrir(PROPRIO, doc);
      const j = await ouvrir(JEANNE, doc);
      await a.widget.evaluate(() => { window.pasRecharge = true; });
      const { navigations, chargementsWidget } = a.page;
      assert.deepEqual(await comptes(a.widget, 'Atelier Durable'), [0, 0]);

      await carte(j.widget, 'Atelier Durable').locator(SEL.aConfirmer).click();
      await attendre(async () => (await comptes(a.widget, 'Atelier Durable')).join() === '0,1', { message: 'le choix de Jeanne n\'apparaît pas chez Antoine' });
      await carte(a.widget, 'Atelier Durable').locator(SEL.ligneParticipants).click();
      const liste = await carte(a.widget, 'Atelier Durable').locator(`${SEL.liste} li`).allInnerTexts();
      assert.equal(liste.length, 1);
      assert.match(liste[0], /Jeanne Delmas/);
      assert.match(liste[0], /À confirmer/);
      assert.match(liste[0], /Université de Bordeaux/);

      await carte(j.widget, 'Atelier Durable').locator(SEL.aConfirmer).click();   // elle se retire
      await attendre(async () => /Personne pour l’instant/.test(await carte(a.widget, 'Atelier Durable').innerText()), { message: 'le retrait n\'apparaît pas chez Antoine' });
      assert.equal(await a.widget.evaluate(() => window.pasRecharge), true, 'le widget d\'Antoine n\'a pas été rechargé');
      assert.equal(a.page.navigations, navigations, 'la page d\'Antoine n\'a pas été rechargée');
      assert.equal(a.page.chargementsWidget, chargementsWidget);
    });

    test('un nouvel arrivant voit les présences déjà enregistrées', async () => {
      const doc = await nouveau();
      const a = await ouvrir(PROPRIO, doc);
      await carte(a.widget, 'Atelier Durable').locator(SEL.present).click();
      await attendre(async () => (await participations(PROPRIO, doc)).length === 1);
      const k = await ouvrir(KARIM, doc);
      assert.equal(await k.widget.locator(SEL.nom).innerText(), 'Karim Benali');
      await attendre(async () => (await comptes(k.widget, 'Atelier Durable')).join() === '1,0');
    });
  });

  describe('règles d\'accès d\'Antoine (attribut utilisateur « acl » sur l\'Annuaire)', () => {
    test('les participants cochent sans que la page ne se recharge, et l\'Annuaire n\'est jamais modifié', async () => {
      const doc = await nouveau({ regles: true });
      const annuaireAvant = JSON.stringify(await lignes(PROPRIO, doc.doc, 'Annuaire'));
      const { page, widget } = await ouvrir(JEANNE, doc);
      assert.equal(await widget.locator(SEL.nom).innerText(), 'Jeanne Delmas');
      await widget.evaluate(() => { window.pasRecharge = true; });
      const { navigations, chargementsWidget } = page;
      const c = carte(widget, 'Atelier Durable');
      await c.locator(SEL.present).click();
      await attendre(async () => (await miennes(JEANNE, doc, JEANNE)).length === 1);
      await c.locator(SEL.aConfirmer).click();
      await attendre(async () => (await miennes(JEANNE, doc, JEANNE))[0].Statut === 'à confirmer');
      await c.locator(SEL.aConfirmer).click();
      await attendre(async () => (await miennes(JEANNE, doc, JEANNE)).length === 0);
      await pause(1500);
      assert.equal(await widget.evaluate(() => window.pasRecharge), true, 'le widget n\'a pas été rechargé');
      assert.equal(page.navigations, navigations, 'la page Grist n\'a pas été rechargée');
      assert.equal(page.chargementsWidget, chargementsWidget, 'le cadre du widget n\'a pas été rechargé');
      assert.equal(JSON.stringify(await lignes(PROPRIO, doc.doc, 'Annuaire')), annuaireAvant, 'l\'Annuaire est resté identique');
    });

    test('témoin : modifier sa propre ligne de l\'Annuaire recharge bien la page (c\'est ce que le widget évite)', async () => {
      const doc = await nouveau({ regles: true });
      const { page } = await ouvrir(JEANNE, doc);
      const { navigations, chargementsWidget } = page;
      await appliquer(JEANNE, doc.doc, [['UpdateRecord', 'Annuaire', 2, { Fonction: 'Directrice' }]]);
      await attendre(() => page.navigations > navigations || page.chargementsWidget > chargementsWidget, { delai: 20000, message: 'ni la page ni le widget ne se sont rechargés : le test ne détecterait pas le problème' });
    });

    test('les règles sont bien appliquées dans ce document de test (Annuaire et événements en lecture seule pour un éditeur)', async () => {
      const doc = await nouveau({ regles: true });
      await assert.rejects(appliquer(JEANNE, doc.doc, [['UpdateRecord', 'Annuaire', 3, { Fonction: 'x' }]]), /403/);
      await assert.rejects(appliquer(JEANNE, doc.doc, [['UpdateRecord', 'Evenements', 1, { Titre: 'x' }]]), /403/);
      assert.equal((await lignes(JEANNE, doc.doc, 'Annuaire')).length, 7);
    });

    test('un refus d\'écriture (règle sur Participations) annule le choix et le dit', async () => {
      const doc = await nouveau({ regles: true });
      // Jeanne ne peut pas créer de ligne avec un statut (mais peut créer la ligne de connexion, vide)
      const [ressource] = await appliquer(PROPRIO, doc.doc, [['AddRecord', '_grist_ACLResources', null, { tableId: 'Participations', colIds: '*' }]]);
      const regles = await lignes(PROPRIO, doc.doc, '_grist_ACLRules');
      const position = Math.max(...regles.map((r) => r.rulePos)) + 1;
      await appliquer(PROPRIO, doc.doc, [['AddRecord', '_grist_ACLRules', null, { resource: ressource, aclFormula: 'user.Email == "jeanne.delmas@u-bordeaux.fr" and newRec.Statut', permissionsText: '-C', memo: '', rulePos: position }]]);
      const { widget } = await ouvrir(JEANNE, doc);
      assert.equal(await widget.locator(SEL.nom).innerText(), 'Jeanne Delmas');
      const c = carte(widget, 'Atelier Durable');
      await c.locator(SEL.present).click();
      await attendre(async () => /refusé par les règles d’accès/.test(await widget.locator(SEL.toast).innerText()), { message: 'message de refus absent' });
      assert.equal(await c.locator(SEL.present).getAttribute('aria-pressed'), 'false');
      assert.equal((await participations(JEANNE, doc)).length, 0);
    });
  });

  describe('règles recommandées dans le README (chacun ne touche qu\'à ses lignes de Participations)', () => {
    test('le widget fonctionne pour un éditeur : choisir, changer, retirer, sans ligne de connexion oubliée', async () => {
      const doc = await nouveau({ recommandees: true });
      const { widget } = await ouvrir(JEANNE, doc);
      assert.equal(await widget.locator(SEL.nom).innerText(), 'Jeanne Delmas');
      const c = carte(widget, 'Atelier Durable');
      await c.locator(SEL.present).click();
      await attendre(async () => (await miennes(JEANNE, doc, JEANNE)).length === 1);
      await c.locator(SEL.aConfirmer).click();
      await attendre(async () => (await miennes(JEANNE, doc, JEANNE))[0].Statut === 'à confirmer');
      await c.locator(SEL.aConfirmer).click();
      await attendre(async () => (await miennes(JEANNE, doc, JEANNE)).length === 0);
      assert.equal((await participations(PROPRIO, doc)).length, 0, 'aucune ligne laissée');
    });

    test('un éditeur ne peut ni écrire à la place d\'un autre, ni modifier ou supprimer ses lignes, mais les voit', async () => {
      const doc = await nouveau({ recommandees: true });
      const evt = await evenementId(doc, 'Atelier Durable');
      const k = await ouvrir(KARIM, doc);
      await carte(k.widget, 'Atelier Durable').locator(SEL.present).click();
      await attendre(async () => (await miennes(KARIM, doc, KARIM)).length === 1);
      const [laSienne] = await miennes(KARIM, doc, KARIM);
      // Jeanne voit la présence de Karim dans le widget et dans l'API
      const j = await ouvrir(JEANNE, doc);
      await attendre(async () => (await comptes(j.widget, 'Atelier Durable')).join() === '1,0');
      assert.equal((await participations(JEANNE, doc)).length, 1);
      // mais ne peut pas la modifier, la supprimer, ni créer une ligne au nom de Karim ou changer l'e-mail d'une ligne
      await assert.rejects(appliquer(JEANNE, doc.doc, [['UpdateRecord', 'Participations', laSienne.id, { Statut: 'à confirmer' }]]), /403/);
      await assert.rejects(appliquer(JEANNE, doc.doc, [['RemoveRecord', 'Participations', laSienne.id]]), /403/);
      await assert.rejects(appliquer(JEANNE, doc.doc, [['AddRecord', 'Participations', null, { Email: KARIM, Evenement: evt, Statut: 'sur' }]]), /403/);
      await carte(j.widget, 'Atelier Durable').locator(SEL.aConfirmer).click();
      await attendre(async () => (await miennes(JEANNE, doc, JEANNE)).length === 1);
      const [laSienneJ] = await miennes(JEANNE, doc, JEANNE);
      await assert.rejects(appliquer(JEANNE, doc.doc, [['UpdateRecord', 'Participations', laSienneJ.id, { Email: KARIM }]]), /403/);
      assert.deepEqual(sansEcho(await miennes(KARIM, doc, KARIM)), sansEcho([laSienne]), 'la ligne de Karim est intacte');
    });
  });

  describe('personnes sans droit d\'écriture ou absentes de l\'Annuaire', () => {
    test('une personne qui n\'est pas dans l\'Annuaire voit le planning et un message avec son adresse', async () => {
      const doc = await nouveau();
      await partager(doc.doc, INCONNU, 'editors');
      const { widget } = await ouvrir(INCONNU, doc, { formulaire: true });
      assert.match(await widget.locator(SEL.etat).textContent(), /inconnu@exemple\.org\) n’est pas dans la table « Annuaire »/);
      assert.equal(await widget.locator('button[data-action="choisir"]').count(), 0);
      assert.equal(await widget.locator(SEL.evenement).count(), 30);
      assert.equal((await participations(PROPRIO, doc)).length, 0, 'aucune ligne laissée');
    });

    test('règles actuelles d\'Antoine : une personne connectée absente de l\'Annuaire remplit la fenêtre, sa demande est enregistrée, elle n\'a pas de boutons et le bouton de l\'en-tête le dit', async () => {
      const doc = await nouveau({ regles: true });
      await partager(doc.doc, INCONNU, 'editors');
      const { widget } = await ouvrir(INCONNU, doc, { formulaire: true });
      await widget.locator('#acces[open]').waitFor({ timeout: 15000 });
      await widget.locator('#acces input[name="prenom"]').fill('Sam');
      await widget.locator('#acces input[name="nom"]').fill('Roux');
      await widget.locator('#acces input[name="etablissement"]').fill('Association locale');
      await widget.locator('#acces').getByRole('button', { name: 'M’inscrire' }).click();
      await attendre(async () => /demande est enregistrée/.test(await widget.locator('#acces h2').innerText()), { message: 'pas de confirmation de la demande' });
      const [demande] = await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire');
      assert.deepEqual([demande.Nom, demande.Prenom, demande.Etablissement, demande.Email], ['Roux', 'Sam', 'Association locale', INCONNU], 'visible dans Demandes_Annuaire');
      assert.equal((await lignes(PROPRIO, doc.doc, 'Annuaire')).length, 5 + 2, 'l\'Annuaire n\'a pas bougé : la règle de création n\'est pas posée');
      assert.equal(await widget.locator('button[data-action="choisir"]').count(), 0, 'pas de boutons Présent / À confirmer');
      assert.match(await widget.locator('#moi button').innerText(), /Demande envoyée/);
    });

    test('un lecteur voit les présences des autres mais ne peut pas en ajouter', async () => {
      const doc = await nouveau();
      const j = await ouvrir(JEANNE, doc);
      await carte(j.widget, 'Atelier Durable').locator(SEL.present).click();
      await attendre(async () => (await participations(PROPRIO, doc)).length === 1);
      await partager(doc.doc, KARIM, 'viewers');
      const { widget } = await ouvrir(KARIM, doc);
      assert.equal(await widget.locator('button[data-action="choisir"]').count(), 0, 'pas de boutons de choix');
      assert.match(await widget.locator(SEL.etat).innerText(), /pas reconnu/);
      await attendre(async () => (await comptes(widget, 'Atelier Durable')).join() === '1,0');
      assert.equal((await participations(PROPRIO, doc)).length, 1);
    });
  });

  describe('document ouvert à tout le monde, écriture réservée aux personnes de l\'Annuaire connectées', () => {
    /** La fenêtre s'ouvre d'office au chargement ; le bouton de l'en-tête est aussi là pour la rouvrir. */
    const fenetreAcces = async (widget) => {
      await widget.locator('#acces[open]').waitFor({ timeout: 15000 });
      assert.equal(await widget.locator('#moi button').count(), 1, 'bouton de l\'en-tête');
    };

    /** Appel de l'API sans aucune connexion (personne anonyme). */
    const anonyme = async (methode, chemin, corps) => {
      const r = await fetch(`${GRIST}/api${chemin}`, { method: methode, headers: { 'X-Requested-With': 'XMLHttpRequest', ...(corps ? { 'Content-Type': 'application/json' } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
      return r.status;
    };

    test('une personne anonyme voit le planning et une fenêtre lui explique la connexion ; elle ne lit ni n\'écrit rien d\'autre', async () => {
      const doc = await nouveau({ publique: true });
      const { widget } = await ouvrir(null, doc);
      assert.equal(await widget.locator(SEL.evenement).count(), 30);
      assert.equal(await widget.locator('button[data-action="choisir"]').count(), 0, 'pas de boutons de choix');
      await fenetreAcces(widget);
      assert.match(await widget.locator('#acces h2').innerText(), /Connectez-vous pour participer/);
      assert.match(await widget.locator('#acces').innerText(), /Choisissez ProConnect[\s\S]*même connexion que pour Resana/);
      assert.match(await widget.locator(SEL.etat).innerText(), /connectez-vous à Grist avec votre adresse professionnelle/);
      assert.equal(await widget.locator(SEL.etat).evaluate((e) => e.classList.contains('etat--erreur')), false, 'ce n\'est pas présenté comme une panne');
      assert.equal(await anonyme('GET', `/docs/${doc.doc}/tables/Annuaire/records`), 403, 'l\'Annuaire reste caché');
      assert.equal(await anonyme('GET', `/docs/${doc.doc}/tables/Evenements/records`), 200, 'le planning est public');
      assert.equal(await anonyme('GET', `/docs/${doc.doc}/tables/Demandes_Annuaire/records`), 403, 'les demandes d\'ajout aussi');
      const lue = await (await fetch(`${GRIST}/api/docs/${doc.doc}/tables/Participations/records`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).json();
      assert.ok(lue.records.every((l) => !('Email' in l.fields) && !('Utilisateur' in l.fields)), 'ni e-mail ni personne dans Participations');
      assert.equal(await anonyme('POST', `/docs/${doc.doc}/apply`, [['AddRecord', 'Participations', null, { Statut: 'sur' }]]), 403);
      assert.equal(await anonyme('POST', `/docs/${doc.doc}/apply`, [['AddRecord', 'Demandes_Annuaire', null, { Nom: 'x' }]]), 403, 'pas de demande sans être connecté');
      assert.equal(await anonyme('POST', `/docs/${doc.doc}/apply`, [['RemoveTable', 'Etablissement']]), 403);
      assert.equal(await anonyme('POST', `/docs/${doc.doc}/apply`, [['UpdateRecord', 'Evenements', 1, { Titre: 'x' }]]), 403);
      assert.equal((await participations(PROPRIO, doc)).length, 0, 'aucune ligne laissée');
      assert.equal((await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire')).length, 0, 'aucune ligne de sondage laissée');
    });

    test('une personne de l\'Annuaire qui n\'est pas partagée nommément se reconnaît, coche, et les autres la voient', async () => {
      const doc = await nouveau({ publique: true });
      const j = await ouvrir(JEANNE, doc);
      assert.equal(await j.widget.locator(SEL.nom).innerText(), 'Jeanne Delmas');
      assert.equal(await j.widget.locator('#acces[open]').count(), 0, 'aucune fenêtre pour une personne reconnue');
      await carte(j.widget, 'Atelier Durable').locator(SEL.present).click();
      await attendre(async () => (await miennes(PROPRIO, doc, JEANNE)).length === 1);
      const k = await ouvrir(KARIM, doc);
      await attendre(async () => (await comptes(k.widget, 'Atelier Durable')).join() === '1,0');
      await carte(k.widget, 'Atelier Durable').locator(SEL.ligneParticipants).click();
      assert.match(await carte(k.widget, 'Atelier Durable').locator(`${SEL.liste} li`).first().innerText(), /Jeanne Delmas/);
      // elle ne peut pas écrire à la place d'un autre ni toucher à la structure
      const evt = await evenementId(doc, 'Atelier Durable');
      await assert.rejects(appliquer(JEANNE, doc.doc, [['AddRecord', 'Participations', null, { Email: KARIM, Evenement: evt, Statut: 'sur' }]]), /403/);
      await assert.rejects(appliquer(JEANNE, doc.doc, [['RemoveTable', 'Etablissement']]), /403/);
      await assert.rejects(appliquer(JEANNE, doc.doc, [['UpdateRecord', 'Evenements', 1, { Titre: 'x' }]]), /403/);
      assert.equal((await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire')).length, 0, 'le widget n\'écrit rien dans les demandes pour une personne reconnue');
    });

    describe('inscription automatique (par défaut) : pas de fenêtre, la personne est inscrite pendant le chargement', () => {
      const CLAIRE = 'claire.martin@ensc.fr';   // ensc.fr n'est pas le domaine principal de Bordeaux INP mais l'un de ceux de sa colonne alt_domain

      test('inscrite pendant le chargement avec son e-mail de connexion, le nom de son compte et l\'établissement d\'un domaine secondaire ; reconnue aussitôt, elle coche', async () => {
        const doc = await nouveau({ publique: true });
        const avant = await lignes(PROPRIO, doc.doc, 'Annuaire');
        const { widget, page } = await ouvrir(CLAIRE, doc);
        await attendre(async () => (await widget.locator(SEL.nom).innerText()) === 'Claire Martin', { message: 'la personne n\'est pas reconnue' });
        assert.equal(await widget.locator('#acces[open]').count(), 0, 'aucune fenêtre');
        assert.equal(await widget.locator('#acces input').count(), 0, 'aucun formulaire');
        assert.equal(await widget.locator('button[data-action="finir-inscription"]').count(), 0);
        assert.equal(await widget.locator(SEL.etat).innerText(), '', 'aucun message : la personne n\'a rien vu');
        assert.ok(page.chargementsWidget <= 3, `le widget ne se recharge qu'une fois (${page.chargementsWidget} chargements)`);
        const annuaire = await lignes(PROPRIO, doc.doc, 'Annuaire');
        assert.equal(annuaire.length, avant.length + 1, 'une seule ligne ajoutée');
        assert.deepEqual(annuaire.slice(0, avant.length), avant, 'les lignes existantes n\'ont pas bougé');
        const nouvelle = annuaire[annuaire.length - 1];
        assert.deepEqual([nouvelle.prenom, nouvelle.nom, nouvelle.email, nouvelle.nom_de_domaine, nouvelle.Etablissement], ['Claire', 'Martin', CLAIRE, 'ensc.fr', 'Bordeaux INP']);
        const demandes = await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire');
        assert.equal(demandes.length, 1, 'une trace');
        assert.deepEqual([demandes[0].Prenom, demandes[0].Nom, demandes[0].Email, demandes[0].Email_saisi, demandes[0].Etablissement], ['Claire', 'Martin', CLAIRE, CLAIRE, 'Bordeaux INP']);
        assert.equal(demandes[0].Nom_connexion, 'claire.martin', 'le nom du compte Grist, ajouté par Grist');
        assert.ok(Math.abs(demandes[0].Date - Date.now() / 1000) < 600, 'date ajoutée par Grist');
        await carte(widget, 'Atelier Durable').locator(SEL.present).click();
        await attendre(async () => (await miennes(PROPRIO, doc, CLAIRE)).length === 1);
        const [presence] = await miennes(PROPRIO, doc, CLAIRE);
        assert.equal(presence.Statut, 'présent');
        assert.ok(presence.Utilisateur, 'liée à sa ligne de l\'Annuaire');
        // elle n'a rien obtenu de plus que sa propre ligne
        await assert.rejects(appliquer(CLAIRE, doc.doc, [['AddRecord', 'Annuaire', null, { nom: 'bis', email: CLAIRE }]]), /403/);
        await assert.rejects(appliquer(CLAIRE, doc.doc, [['UpdateRecord', 'Annuaire', nouvelle.id, { email: JEANNE }]]), /403/);
        await assert.rejects(appliquer(CLAIRE, doc.doc, [['UpdateRecord', 'Annuaire', 1, { Fonction: 'x' }]]), /403/);
        assert.deepEqual(page.erreurs, []);
        // elle revient : plus rien à faire, aucune trace de plus
        await page.context().close();
        const encore = await ouvrir(CLAIRE, doc);
        assert.equal(await encore.widget.locator(SEL.nom).innerText(), 'Claire Martin');
        assert.equal((await lignes(PROPRIO, doc.doc, 'Annuaire')).length, avant.length + 1);
        assert.equal((await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire')).length, 1);
      });

      test('domaine inconnu : inscrite sans établissement, avec son domaine ; la colonne alt_domain peut aussi être une liste de choix', async () => {
        const doc = await nouveau({ publique: true });
        const { widget } = await ouvrir(INCONNU, doc);
        await attendre(async () => (await widget.locator(SEL.nom).innerText()) === 'Inconnu', { message: 'la personne n\'est pas reconnue' });
        const annuaire = await lignes(PROPRIO, doc.doc, 'Annuaire');
        const sans = annuaire[annuaire.length - 1];
        assert.deepEqual([sans.prenom, sans.nom, sans.email, sans.nom_de_domaine, sans.Etablissement], ['', 'Inconnu', INCONNU, 'exemple.org', '']);
        // alt_domain en liste de choix (INRAE : inra.fr, irstea.fr)
        await appliquer(PROPRIO, doc.doc, [['ModifyColumn', 'Etablissement', 'alt_domain', { type: 'ChoiceList', widgetOptions: JSON.stringify({ choices: ['inra.fr', 'irstea.fr'] }) }]]);
        await appliquer(PROPRIO, doc.doc, [['UpdateRecord', 'Etablissement', 5, { alt_domain: ['L', 'inra.fr', 'irstea.fr'] }]]);
        const PAUL = 'paul.durand@irstea.fr';
        const { widget: w2 } = await ouvrir(PAUL, doc);
        await attendre(async () => (await w2.locator(SEL.nom).innerText()) === 'Paul Durand', { message: 'Paul n\'est pas reconnu' });
        const apres = await lignes(PROPRIO, doc.doc, 'Annuaire');
        const paul = apres[apres.length - 1];
        assert.deepEqual([paul.email, paul.nom_de_domaine, paul.Etablissement], [PAUL, 'irstea.fr', 'INRAE']);
      });

      test('règles actuelles d\'Antoine (création refusée) : la trace est enregistrée une fois, la personne en est informée, aucun bouton ni fenêtre, aucun doublon aux ouvertures suivantes', async () => {
        const doc = await nouveau({ regles: true });
        await partager(doc.doc, INCONNU, 'editors');
        const { widget, page } = await ouvrir(INCONNU, doc);
        await attendre(async () => /demande est enregistrée/.test(await widget.locator(SEL.etat).innerText()), { message: 'pas de message de demande enregistrée' });
        assert.equal(await widget.locator('#acces[open]').count(), 0, 'aucune fenêtre');
        assert.equal(await widget.locator('button[data-action="choisir"]').count(), 0, 'pas de boutons Présent / À confirmer');
        assert.equal(await widget.locator(SEL.etat).evaluate((e) => e.classList.contains('etat--erreur')), false);
        const [demande] = await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire');
        assert.deepEqual([demande.Nom, demande.Prenom, demande.Email], ['Inconnu', '', INCONNU]);
        assert.equal((await lignes(PROPRIO, doc.doc, 'Annuaire')).length, 5 + 2, 'l\'Annuaire n\'a pas bougé');
        assert.equal(page.navigations, 1, 'pas de rechargement');
        await page.context().close();
        const encore = await ouvrir(INCONNU, doc);
        await attendre(async () => /demande est enregistrée/.test(await encore.widget.locator(SEL.etat).innerText()));
        assert.equal((await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire')).length, 1, 'pas de deuxième trace');
      });

      test('demande enregistrée quand les règles refusaient, puis règle de création posée : la personne revient et est inscrite sans nouvelle trace', async () => {
        const doc = await nouveau({ publique: true });
        const regles = (await api(PROPRIO, 'GET', `/docs/${doc.doc}/tables/_grist_ACLRules/records`)).records;
        const creation = regles.find((r) => r.fields.aclFormula.startsWith('user.IsLoggedIn and not user.acl.id'));
        await appliquer(PROPRIO, doc.doc, [['UpdateRecord', '_grist_ACLRules', creation.id, { permissionsText: '-C' }]]);
        const premiere = await ouvrir(INCONNU, doc);
        await attendre(async () => /demande est enregistrée/.test(await premiere.widget.locator(SEL.etat).innerText()));
        assert.equal((await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire')).length, 1);
        assert.equal((await lignes(PROPRIO, doc.doc, 'Annuaire')).length, 5 + 2, 'l\'Annuaire n\'a pas bougé');
        await premiere.page.context().close();
        await appliquer(PROPRIO, doc.doc, [['UpdateRecord', '_grist_ACLRules', creation.id, { permissionsText: '+C' }]]);
        const { widget } = await ouvrir(INCONNU, doc);
        await attendre(async () => (await widget.locator(SEL.nom).innerText()) === 'Inconnu', { message: 'la personne n\'est pas reconnue après la pose de la règle' });
        assert.equal((await lignes(PROPRIO, doc.doc, 'Annuaire')).length, 5 + 2 + 1, 'une seule ligne ajoutée');
        assert.equal((await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire')).length, 1, 'pas de deuxième trace');
      });

      test('personne anonyme : toujours la fenêtre de connexion, aucune inscription ; une personne déjà dans l\'Annuaire n\'écrit rien', async () => {
        const doc = await nouveau({ publique: true });
        const anon = await ouvrir(null, doc);
        await anon.widget.locator('#acces[open]').waitFor({ timeout: 15000 });
        assert.match(await anon.widget.locator('#acces h2').innerText(), /Connectez-vous pour participer/);
        const j = await ouvrir(JEANNE, doc);
        assert.equal(await j.widget.locator(SEL.nom).innerText(), 'Jeanne Delmas');
        assert.equal((await lignes(PROPRIO, doc.doc, 'Annuaire')).length, 5 + 2);
        assert.equal((await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire')).length, 0);
      });
    });

    test('une personne connectée mais absente de l\'Annuaire s\'inscrit par le formulaire, est reconnue aussitôt et coche', async () => {
      const doc = await nouveau({ publique: true });
      const avant = await lignes(PROPRIO, doc.doc, 'Annuaire');
      const { widget, page } = await ouvrir(INCONNU, doc, { formulaire: true });
      assert.equal(await widget.locator(SEL.evenement).count(), 30);
      assert.equal(await widget.locator('button[data-action="choisir"]').count(), 0);
      await fenetreAcces(widget);
      assert.match(await widget.locator('#acces').innerText(), /avec inconnu@exemple\.org/i);
      assert.match(await widget.locator(SEL.etat).innerText(), /inconnu@exemple\.org\) n’est pas dans la table « Annuaire »/);
      assert.equal(await widget.locator('#acces input[name="emailSaisi"]').inputValue(), INCONNU);
      assert.equal((await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire')).length, 0, 'la ligne de sondage a été supprimée');
      await widget.locator('#acces input[name="prenom"]').fill('Sam');
      await widget.locator('#acces input[name="nom"]').fill('Roux');
      await widget.locator('#acces input[name="emailSaisi"]').fill('sam.roux@association.example');
      await widget.locator('#acces input[name="etablissement"]').fill('Association locale');
      await widget.locator('#acces').getByRole('button', { name: 'M’inscrire' }).click();
      // Grist recharge la page de la personne (son attribut « acl » a changé) : le widget la reconnaît
      const apres = await attendre(() => {
        const f = page.frames().find((x) => x.url().startsWith(srv.url));
        return f && f.locator(SEL.nom).innerText({ timeout: 500 }).then((t) => t === 'Sam Roux' && f, () => false);
      }, { delai: 30000, message: 'la personne n\'est pas reconnue après son inscription' });
      assert.equal(await apres.locator('#acces[open]').count(), 0, 'plus de fenêtre');
      const annuaire = await lignes(PROPRIO, doc.doc, 'Annuaire');
      assert.equal(annuaire.length, avant.length + 1, 'une seule ligne ajoutée');
      assert.deepEqual(annuaire.slice(0, avant.length), avant, 'les lignes existantes n\'ont pas bougé');
      const nouvelle = annuaire[annuaire.length - 1];
      assert.deepEqual([nouvelle.nom, nouvelle.prenom, nouvelle.email, nouvelle.nom_de_domaine, nouvelle.Etablissement], ['Roux', 'Sam', INCONNU, 'exemple.org', 'Association locale']);
      const [demande] = await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire');
      assert.deepEqual([demande.Nom, demande.Prenom, demande.Email_saisi, demande.Etablissement, demande.Email], ['Roux', 'Sam', 'sam.roux@association.example', 'Association locale', INCONNU], 'journal de la demande');
      assert.ok(Math.abs(demande.Date - Date.now() / 1000) < 600, 'date ajoutée par Grist');
      // elle coche comme tout le monde
      await carte(apres, 'Atelier Durable').locator(SEL.present).click();
      await attendre(async () => (await miennes(PROPRIO, doc, INCONNU)).length === 1);
      const [presence] = await miennes(PROPRIO, doc, INCONNU);
      assert.equal(presence.Statut, 'présent');
      assert.ok(presence.Utilisateur, 'liée à sa ligne de l\'Annuaire');
      // ... et c'est tout : une seule inscription, pas de ligne au nom d'un autre, aucune modification de l'Annuaire
      await assert.rejects(appliquer(INCONNU, doc.doc, [['AddRecord', 'Annuaire', null, { nom: 'bis', email: INCONNU }]]), /403/);
      await assert.rejects(appliquer(INCONNU, doc.doc, [['UpdateRecord', 'Annuaire', nouvelle.id, { email: JEANNE }]]), /403/);
      await assert.rejects(appliquer(INCONNU, doc.doc, [['UpdateRecord', 'Annuaire', 1, { Fonction: 'x' }]]), /403/);
      await assert.rejects(appliquer(INCONNU, doc.doc, [['RemoveRecord', 'Annuaire', 1]]), /403/);
    });

    test('inscription refusée par les règles : la demande reste enregistrée, la personne est prévenue', async () => {
      const doc = await nouveau({ publique: true });
      // une règle de plus (déjà en place chez Antoine aujourd'hui) : personne ne crée sa ligne dans l'Annuaire
      const regles = (await api(PROPRIO, 'GET', `/docs/${doc.doc}/tables/_grist_ACLRules/records`)).records;
      const creation = regles.find((r) => r.fields.aclFormula.startsWith('user.IsLoggedIn and not user.acl.id'));
      await appliquer(PROPRIO, doc.doc, [['UpdateRecord', '_grist_ACLRules', creation.id, { permissionsText: '-C' }]]);
      const { widget } = await ouvrir(INCONNU, doc, { formulaire: true });
      await fenetreAcces(widget);
      await widget.locator('#acces input[name="prenom"]').fill('Sam');
      await widget.locator('#acces input[name="nom"]').fill('Roux');
      await widget.locator('#acces input[name="etablissement"]').fill('Association locale');
      await widget.locator('#acces').getByRole('button', { name: 'M’inscrire' }).click();
      await attendre(async () => /votre demande est enregistrée/.test(await widget.locator('#acces h2').innerText()), { message: 'pas de confirmation de la demande' });
      assert.equal((await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire')).length, 1);
      assert.equal((await lignes(PROPRIO, doc.doc, 'Annuaire')).length, 5 + 2, 'l\'Annuaire n\'a pas bougé');
    });

    test('demande enregistrée quand les règles refusaient, puis règle de création posée : « Finir mon inscription » inscrit la personne sans nouvelle demande', async () => {
      const doc = await nouveau({ publique: true });
      const regles = (await api(PROPRIO, 'GET', `/docs/${doc.doc}/tables/_grist_ACLRules/records`)).records;
      const creation = regles.find((r) => r.fields.aclFormula.startsWith('user.IsLoggedIn and not user.acl.id'));
      await appliquer(PROPRIO, doc.doc, [['UpdateRecord', '_grist_ACLRules', creation.id, { permissionsText: '-C' }]]);
      const premiere = await ouvrir(INCONNU, doc, { formulaire: true });
      await fenetreAcces(premiere.widget);
      await premiere.widget.locator('#acces input[name="prenom"]').fill('Sam');
      await premiere.widget.locator('#acces input[name="nom"]').fill('Roux');
      await premiere.widget.locator('#acces input[name="etablissement"]').fill('Association locale');
      await premiere.widget.locator('#acces').getByRole('button', { name: 'M’inscrire' }).click();
      await attendre(async () => /votre demande est enregistrée/.test(await premiere.widget.locator('#acces h2').innerText()), { message: 'pas de confirmation de la demande' });
      assert.equal(await premiere.widget.locator('#acces').getByRole('button', { name: 'Finir mon inscription' }).count(), 0, 'elle vient d\'être refusée : pas de bouton');
      await premiere.page.context().close();
      // Antoine pose la règle de création : la personne revient et termine son inscription elle-même
      await appliquer(PROPRIO, doc.doc, [['UpdateRecord', '_grist_ACLRules', creation.id, { permissionsText: '+C' }]]);
      const { widget, page } = await ouvrir(INCONNU, doc, { formulaire: true });
      await fenetreAcces(widget);
      assert.match(await widget.locator('#acces h2').innerText(), /Votre demande est enregistrée/);
      assert.equal(await widget.locator('#acces form').count(), 0, 'pas de nouveau formulaire');
      assert.match(await widget.locator('#moi button').innerText(), /Finir mon inscription/);
      await widget.locator('#acces').getByRole('button', { name: 'Finir mon inscription' }).click();
      const apres = await attendre(() => {
        const f = page.frames().find((x) => x.url().startsWith(srv.url));
        return f && f.locator(SEL.nom).innerText({ timeout: 500 }).then((t) => t === 'Sam Roux' && f, () => false);
      }, { delai: 30000, message: 'la personne n\'est pas reconnue après avoir fini son inscription' });
      assert.equal(await apres.locator('#acces[open]').count(), 0, 'plus de fenêtre');
      const annuaire = await lignes(PROPRIO, doc.doc, 'Annuaire');
      assert.equal(annuaire.length, 5 + 2 + 1, 'une seule ligne ajoutée');
      const nouvelle = annuaire[annuaire.length - 1];
      assert.deepEqual([nouvelle.nom, nouvelle.prenom, nouvelle.email, nouvelle.nom_de_domaine, nouvelle.Etablissement], ['Roux', 'Sam', INCONNU, 'exemple.org', 'Association locale']);
      assert.equal((await lignes(PROPRIO, doc.doc, 'Demandes_Annuaire')).length, 1, 'pas de deuxième demande');
      await carte(apres, 'Atelier Durable').locator(SEL.present).click();
      await attendre(async () => (await miennes(PROPRIO, doc, INCONNU)).length === 1);
    });

    test('une table ajoutée plus tard est fermée aux personnes hors Annuaire d\'office', async () => {
      const doc = await nouveau({ publique: true });
      await appliquer(PROPRIO, doc.doc, [['AddTable', 'Brouillon', [{ id: 'A', type: 'Text', isFormula: false }]], ['AddRecord', 'Brouillon', null, { A: 'secret' }]]);
      assert.equal(await anonyme('GET', `/docs/${doc.doc}/tables/Brouillon/records`), 403);
      await assert.rejects(lignes(INCONNU, doc.doc, 'Brouillon'), /403/);
      assert.equal((await lignes(JEANNE, doc.doc, 'Brouillon')).length, 1, 'une personne de l\'Annuaire la lit');
    });
  });

  describe('logos et liens', () => {
    test('le logo d\'un établissement (pièce jointe Grist) s\'affiche ; sans logo, les initiales', async () => {
      const doc = await nouveau({ logos: true });
      const { widget } = await ouvrir(PROPRIO, doc);   // Antoine : Université de Bordeaux (logo)
      await attendre(async () => widget.locator(`${SEL.moi} img.avatar`).evaluate((i) => i.complete && i.naturalWidth > 0), { message: 'logo non chargé' });
      const sophie = await ouvrir('sophie.roux@exemple.org', doc);   // aucun établissement connu : initiales
      assert.equal(await sophie.widget.locator(`${SEL.moi} img.avatar`).count(), 0);
      assert.equal(await sophie.widget.locator(`${SEL.moi} span.avatar`).innerText(), 'SR');
    });

    test('le lieu s\'ouvre dans un nouvel onglet depuis Grist (cadre isolé du widget)', async () => {
      const doc = await nouveau();
      const { page, widget } = await ouvrir(PROPRIO, doc);
      await page.context().route('https://www.google.com/**', (r) => r.fulfill({ contentType: 'text/html', body: 'carte' }));
      await widget.click('[data-jour="2026-11-24"]');
      const [onglet] = await Promise.all([page.context().waitForEvent('page'), carte(widget, 'Les Evolutive Learning').locator(SEL.lieu).click()]);
      await onglet.waitForLoadState();
      assert.match(onglet.url(), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    });

    test('un événement modifié dans Grist apparaît à la relecture suivante', async () => {
      const doc = await nouveau();
      const { widget } = await ouvrir(PROPRIO, doc);
      const evt = await evenementId(doc, 'Atelier Durable');
      await appliquer(PROPRIO, doc.doc, [['UpdateRecord', 'Evenements', evt, { Titre: 'Atelier Durable (salle changée)', Lieu: 'Nouvelle salle' }]]);
      await widget.evaluate(() => chargerEvenements());
      await attendre(async () => (await carte(widget, 'salle changée').count()) === 1);
      assert.match(await carte(widget, 'salle changée').locator(SEL.lieu).innerText(), /Nouvelle salle/);
    });
  });

  describe('sécurité du widget', () => {
    test('colonne « Email » masquée aux éditeurs et structure modifiable : aucune colonne en trop, aucune présence perdue', async () => {
      const doc = await nouveau();
      const evt = await evenementId(doc, 'Atelier Durable');
      await appliquer(JEANNE, doc.doc, [['AddRecord', 'Participations', null, { Evenement: evt, Statut: 'présent' }]]);
      const [ressource] = await appliquer(PROPRIO, doc.doc, [['AddRecord', '_grist_ACLResources', null, { tableId: 'Participations', colIds: 'Email' }]]);
      await appliquer(PROPRIO, doc.doc, [
        ['AddRecord', '_grist_ACLRules', null, { resource: ressource, aclFormula: 'user.Access in [OWNER]', permissionsText: '+R', memo: '', rulePos: 1 }],
        ['AddRecord', '_grist_ACLRules', null, { resource: ressource, aclFormula: '', permissionsText: '-R', memo: '', rulePos: 2 }],
      ]);
      const colonnesAvant = Object.keys(await colonnes(doc)).sort();
      const avant = sansEcho(await participations(PROPRIO, doc));
      assert.equal(avant.length, 1);
      const { page } = await ouvrir(KARIM, doc);   // il ne voit pas la colonne : le widget ne doit pas en recréer une
      await pause(1500);
      assert.deepEqual(Object.keys(await colonnes(doc)).sort(), colonnesAvant, 'pas de colonne « Email2 »');
      assert.deepEqual(sansEcho(await participations(PROPRIO, doc)), avant);
      assert.deepEqual(page.erreurs, []);
    });

    test('des colonnes qui contiennent déjà des e-mails ne sont jamais supprimées par la « réparation »', async () => {
      const doc = await nouveau({ preparer: false });
      await appliquer(PROPRIO, doc.doc, [
        ['AddColumn', 'Participations', 'Email', { type: 'Text', isFormula: false, formula: 'user.Email', recalcWhen: 1 }],
        ['AddColumn', 'Participations', 'Utilisateur', { type: 'Ref:Annuaire', isFormula: true, formula: 'return None' }],
        ['AddColumn', 'Participations', 'Evenement', { type: 'Ref:Evenements', isFormula: false }],
        ['AddColumn', 'Participations', 'Statut', { type: 'Choice', isFormula: false }],
      ]);
      const evt = await evenementId(doc, 'Atelier Durable');
      await appliquer(PROPRIO, doc.doc, [['AddRecord', 'Participations', null, { Email: JEANNE, Evenement: evt, Statut: 'présent' }]]);
      const avant = sansEcho(await participations(PROPRIO, doc));
      await ouvrir(PROPRIO, doc);
      await pause(1500);
      assert.equal((await colonnes(doc)).Email.recalcWhen, 1, 'la colonne n\'a pas été recréée');
      assert.deepEqual(sansEcho(await participations(PROPRIO, doc)), avant, 'l\'e-mail de la présence est toujours là');
    });
  });
});
