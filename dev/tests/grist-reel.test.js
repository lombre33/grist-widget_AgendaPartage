/* Le widget dans un vrai Grist (image officielle, voir dev/grist/serveur.sh), avec plusieurs personnes connectées
   en même temps : première ouverture, enregistrement des choix, relecture, mise à jour en direct, règles d'accès
   d'Antoine, personnes sans droit, logos en pièces jointes. Ces tests sont ignorés si Grist ne répond pas. */
'use strict';
const { spawnSync } = require('node:child_process');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { serveur, lancerNavigateur, attendre, pause, SEL } = require('./helpers');
const { GRIST, PROPRIETAIRE, api, appliquer, lignes, partager, contexteNavigateur } = require('../grist/lib');
const { creerDocument, installerReglesAntoine, installerReglesRecommandees, ajouterLogos, supprimerDocument } = require('../grist/document');

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
  async function nouveau({ regles = false, recommandees = false, logos = false, preparer = true, cibles = true } = {}) {
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
    return r;
  }

  /** Ouvre la page du widget comme cette personne ; renvoie la page Grist et le cadre du widget. */
  async function ouvrir(utilisateur, doc, { largeur = 1300, hauteur = 900 } = {}) {
    const contexte = await contexteNavigateur(navigateur, utilisateur, { viewport: { width: largeur, height: hauteur } });
    const page = await contexte.newPage();
    page.erreurs = [];
    page.on('pageerror', (e) => page.erreurs.push(e.message));
    page.violationsCsp = [];    // refus de la politique de sécurité (CSP) de index.html
    page.on('console', (m) => { if (/Content Security Policy/.test(m.text())) page.violationsCsp.push(m.text()); });
    page.navigations = 0;       // chargements de la page Grist
    page.chargementsWidget = 0; // chargements du cadre du widget (Grist le recharge quand il recharge le document)
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) page.navigations += 1;
      else if (f.url().startsWith(srv.url)) page.chargementsWidget += 1;
    });
    await page.goto(`${GRIST}/${doc.doc}/x/p/${doc.page}`);
    const widget = await attendre(() => page.frames().find((f) => f.url().startsWith(srv.url)), { message: 'le widget ne s\'est pas chargé' });
    await widget.waitForSelector(SEL.evenement, { timeout: 30000 }).catch(async () => {
      throw new Error(`aucun événement affiché : ${(await widget.locator('body').innerText()).slice(0, 300)}`);
    });
    await attendre(() => widget.locator(SEL.pied).innerText().then((t) => t.includes('ligne')), { message: 'présences non reçues' });
    await page.keyboard.press('Escape');   // ferme la visite guidée de Grist
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
      assert.deepEqual(await widget.locator('.bulle').allInnerTexts(), ['Pédagogie', 'Recherche', 'Étudiants', 'Entreprises']);
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

    test('sans colonne Cibles : pas de rangée de bulles, planning inchangé', async () => {
      const doc = await nouveau({ cibles: false });
      const { page, widget } = await ouvrir(PROPRIO, doc);
      assert.equal(await widget.locator('#cibles').isVisible(), false);
      assert.equal(await widget.locator(SEL.evenement).count(), 30);
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
      const { widget } = await ouvrir(INCONNU, doc);
      assert.match(await widget.locator(SEL.etat).textContent(), /inconnu@exemple\.org\) n’est pas dans la table « Annuaire »/);
      assert.equal(await widget.locator('button[data-action="choisir"]').count(), 0);
      assert.equal(await widget.locator(SEL.evenement).count(), 30);
      assert.equal((await participations(PROPRIO, doc)).length, 0, 'aucune ligne laissée');
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

    test('la politique de sécurité (CSP) est active et le widget fonctionne avec : logo en pièce jointe, choix enregistré', async () => {
      const doc = await nouveau({ logos: true });
      const { page, widget } = await ouvrir(JEANNE, doc);
      assert.equal(await widget.evaluate(() => Boolean(document.querySelector('meta[http-equiv="Content-Security-Policy"]'))), true);
      await attendre(async () => widget.locator(`${SEL.moi} img.avatar`).evaluate((i) => i.complete && i.naturalWidth > 0), { message: 'logo non chargé' });
      const c = carte(widget, 'Atelier Durable');
      await c.locator(SEL.present).click();
      await attendre(async () => (await participations(PROPRIO, doc)).some((l) => l.Statut === 'présent'), { message: 'présence non enregistrée' });
      // seule la feuille de style que le script de Grist ajoute pour son thème est refusée : sans effet sur le widget
      assert.deepEqual(page.violationsCsp.filter((m) => !/inline style/.test(m)), []);
      // et la politique refuse bien ce qu'elle doit refuser : appel réseau, script en ligne, script externe
      assert.equal(await widget.evaluate(() => fetch('https://example.org/').then(() => 'ouvert', () => 'bloqué')), 'bloqué');
      await widget.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__enLigne = 1'; document.body.append(s); });
      await attendre(() => page.violationsCsp.some((m) => /inline script/.test(m)), { message: 'script en ligne non refusé' });
      assert.equal(await widget.evaluate(() => window.__enLigne), undefined);
      await widget.evaluate(() => { const s = document.createElement('script'); s.src = 'https://exemple.invalid/x.js'; document.body.append(s); });
      await attendre(() => page.violationsCsp.some((m) => /exemple\.invalid/.test(m)), { message: 'script externe non refusé' });
    });
  });
});
