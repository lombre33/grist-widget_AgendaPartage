/* Mise à jour du planning du 22/10 sur un document déjà en service : le widget corrige en place les cellules de Evenements listées dans
   maj-planning.js (corrigerPlanning). Départ = la table Evenements de la version du 13/10 avec des présences déjà enregistrées par plusieurs
   personnes ; arrivée = la version du 22/10 (dev/evenements.js), sans qu'aucune présence ne bouge. Joué dans un vrai Grist (voir
   dev/grist/serveur.sh), ignoré s'il ne répond pas. */
'use strict';
const { spawnSync } = require('node:child_process');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { serveur, lancerNavigateur, attendre, pause, SEL } = require('./helpers');
const { GRIST, PROPRIETAIRE, appliquer, lignes, partager, contexteNavigateur } = require('../grist/lib');
const { creerDocument, installerReglesAntoine, supprimerDocument, evenements } = require('../grist/document');

const PROPRIO = PROPRIETAIRE;
const JEANNE = 'jeanne.delmas@u-bordeaux.fr';
const KARIM = 'karim.benali@bordeaux-inp.fr';

/** Charge un fichier de données `window.X = …` du dépôt (require ne rejoue pas un fichier déjà chargé : on garde le résultat). */
const caches = new Map();
function charger(fichier, nom) {
  if (!caches.has(fichier)) {
    global.window = {};
    require(fichier);
    caches.set(fichier, global.window[nom]);
    delete global.window;
  }
  return caches.get(fichier);
}
const evenementsAvant = () => charger('./fixtures/evenements-avant-22-oct.js', 'MOCK_EVENEMENTS');   // les 30 séances de la version du 13/10
const corrections = () => charger('../../maj-planning.js', 'MAJ_PLANNING');

// [personne, début du titre AVANT la mise à jour, statut] : les sept séances modifiées, plus quelques autres
const PRESENCES = [
  [JEANNE, 'Entractes', 'présent'], [JEANNE, 'Les Evolutive', 'présent'], [JEANNE, 'Construire autrement', 'présent'], [JEANNE, 'Soirée des entreprises', 'présent'],
  [JEANNE, 'Serious game', 'présent'], [JEANNE, 'Explorer l’Espace', 'à confirmer'], [JEANNE, 'L’Échoppe', 'à confirmer'],
  [KARIM, 'Construire autrement', 'présent'], [KARIM, 'Explorer l’Espace', 'présent'], [KARIM, 'Soirée des entreprises', 'à confirmer'],
  [KARIM, 'Atelier Durable', 'présent'], [KARIM, 'Entractes', 'à confirmer'],
  [PROPRIO, 'L’Échoppe', 'présent'], [PROPRIO, 'Serious game', 'présent'], [PROPRIO, 'Matinale', 'présent'], [PROPRIO, 'Les Evolutive', 'à confirmer'],
];

const grist = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--noproxy', '*', '-m', '3', `${GRIST}/status`], { encoding: 'utf8' });
const disponible = grist.stdout.trim() === '200';
const espaces = (t) => String(t ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const COLONNES = ['Jour', 'Debut', 'Fin', 'Titre', 'Sous_titre', 'Type', 'Temps_fort', 'Lieu', 'Ville', 'Adresse', 'Public', 'Cibles', 'Description', 'Lien'];
const comme = (evt) => Object.fromEntries(COLONNES.map((c) => [c, evt[c] ?? '']));

describe('mise à jour du planning du 22/10 (cellules corrigées en place par le widget)', () => {
  test('maj-planning.js contient exactement ce qui sépare l\'ancien Excel du nouveau', () => {
    const avant = evenementsAvant();
    const apres = evenements();
    assert.equal(avant.length, apres.length);
    const attendu = [];
    avant.forEach((a, i) => {
      for (const champ of Object.keys(a)) {
        if (JSON.stringify(a[champ]) !== JSON.stringify(apres[i][champ])) attendu.push([a.Titre, champ, apres[i][champ]]);
      }
    });
    assert.equal(attendu.length, 7);
    const dansFichier = corrections().flatMap((m) => Object.keys(m.apres).map((champ) => [m.titre, champ, champ === 'Cibles' ? ['L', ...m.apres.Cibles] : m.apres[champ]]));
    assert.deepEqual(dansFichier.map((x) => JSON.stringify(x)).sort(), attendu.map((x) => JSON.stringify(x)).sort());
    for (const m of corrections()) {   // « avant » = ce qu'il y a dans l'ancien Excel, pour la même séance
      const ancienne = avant.find((a) => a.Titre === m.titre);
      assert.ok(ancienne, m.titre);
      for (const [champ, valeur] of Object.entries(m.avant)) assert.deepEqual(champ === 'Cibles' ? ancienne.Cibles.slice(1) : ancienne[champ], valeur);
    }
  });

  describe('vrai Grist', { skip: disponible ? false : `Grist ne répond pas sur ${GRIST} : lancer sh dev/grist/serveur.sh` }, () => {
    let srv; let navigateur; const docs = [];
    before(async () => { srv = await serveur(); navigateur = await lancerNavigateur(); });
    after(async () => { await navigateur.close(); await srv.fermer(); for (const d of docs) await supprimerDocument(d); });

    const lireEvenements = (doc) => lignes(PROPRIO, doc.doc, 'Evenements');
    const lirePresences = (doc) => lignes(PROPRIO, doc.doc, 'Participations');

    /** Ouvre la page du widget comme cette personne. `sansCorrection` : le widget ne corrige rien (pour garder l'état d'avant). */
    async function ouvrir(utilisateur, doc, { sansCorrection = false } = {}) {
      const contexte = await contexteNavigateur(navigateur, utilisateur, { viewport: { width: 1300, height: 900 }, sansCorrection });
      await contexte.addInitScript(() => {   // note les messages du widget (le temps qu'ils restent affichés est court)
        window.__messages = [];
        document.addEventListener('DOMContentLoaded', () => {
          const toast = document.getElementById('toast');
          if (toast) new MutationObserver(() => { if (toast.textContent) window.__messages.push(toast.textContent); }).observe(toast, { childList: true, characterData: true, subtree: true });
        });
      });
      const page = await contexte.newPage();
      page.erreurs = [];
      page.on('pageerror', (e) => page.erreurs.push(e.message));
      await page.goto(`${GRIST}/${doc.doc}/x/p/${doc.page}`);
      const widget = await attendre(() => page.frames().find((f) => f.url().startsWith(srv.url)), { message: 'le widget ne s\'est pas chargé' });
      await widget.waitForSelector(SEL.evenement, { timeout: 30000 });
      await attendre(() => widget.locator(SEL.pied).innerText().then((t) => t.includes('ligne')), { message: 'présences non reçues' });
      await page.mainFrame().evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
      await page.keyboard.press('Escape');
      await pause(300);
      return { page, widget, contexte, messages: () => widget.evaluate(() => window.__messages), messagesGrist: () => page.locator('.test-notifier-toast-message').allInnerTexts() };
    }

    /** Un document en service : événements de la version du 13/10, présences de trois personnes (le widget n'a encore rien corrigé). */
    async function enService({ regles = false } = {}) {
      const r = await creerDocument(`Test maj ${new Date().toISOString()}`, { widget: `${srv.url}/index.html`, liste: evenementsAvant() });
      docs.push(r.doc);
      for (const email of r.emails.slice(1)) await partager(r.doc, email, 'editors');
      const { page } = await ouvrir(PROPRIO, r, { sansCorrection: true });   // première ouverture par le propriétaire : le widget crée les colonnes de Participations
      await page.context().close();
      const evts = await lireEvenements(r);
      const id = (debut) => evts.find((e) => e.Titre.startsWith(debut)).id;
      for (const [qui, debut, statut] of PRESENCES) await appliquer(qui, r.doc, [['AddRecord', 'Participations', null, { Evenement: id(debut), Statut: statut }]]);
      assert.equal((await lirePresences(r)).length, PRESENCES.length);
      if (regles) await installerReglesAntoine(r.doc);   // Evenements modifiable par les seuls propriétaires
      return r;
    }

    /** Ce que la personne voit : pour chaque séance, son titre, les compteurs présent / à confirmer et son propre choix. */
    const instantane = (widget) => widget.evaluate(() => [...document.querySelectorAll('.evt')].map((e) => ({
      titre: e.querySelector('.evt__titre').textContent,
      comptes: ['sur', 'probable'].map((c) => Number(((e.querySelector(`.compte--${c}`) || {}).textContent || '0').match(/\d+/)[0])),
      moi: ['sur', 'probable'].map((c) => e.querySelector(`button[data-valeur="${c}"]`).getAttribute('aria-pressed')),
    })));
    const sansTitre = (liste) => liste.map(({ comptes, moi }) => ({ comptes, moi }));
    const monProgramme = async (widget) => Number(((await widget.locator(SEL.filtre).innerText().catch(() => '')).match(/Mon programme \((\d+)\)/) || [0, 0])[1]);   // sans présence, le filtre n'affiche pas de nombre
    const titresAttendus = () => evenements().map((e) => espaces(`${e.Titre}${e.Sous_titre ? `. ${e.Sous_titre}` : ''}`));
    const MESSAGE = /Planning mis à jour : 7 séances corrigées.*Les présences sont conservées/;

    test('le propriétaire ouvre le widget : les sept cellules sont corrigées, les mêmes lignes restent, toutes les présences restent sur leurs séances', async () => {
      const doc = await enService();
      const karim = await ouvrir(KARIM, doc, { sansCorrection: true });   // reste ouverte pendant toute l'opération
      const avantKarim = await instantane(karim.widget);
      assert.equal(await monProgramme(karim.widget), 5);
      const evtsAvant = await lireEvenements(doc);
      const presencesAvant = await lirePresences(doc);

      const proprio = await ouvrir(PROPRIO, doc);
      assert.match((await proprio.messages()).join('\n'), MESSAGE);
      assert.deepEqual(proprio.page.erreurs, []);

      // Evenements = exactement la version du 22/10 (dev/evenements.js), mêmes numéros de ligne qu'avant, sept lignes changées
      const evtsApres = await lireEvenements(doc);
      assert.deepEqual(evtsApres.map((e) => e.id), evtsAvant.map((e) => e.id));
      assert.deepEqual(evtsApres.map(comme), evenements().map(comme));
      assert.equal(evtsApres.filter((e, i) => JSON.stringify(comme(e)) !== JSON.stringify(comme(evtsAvant[i]))).length, 7, 'sept lignes changées, pas une de plus');

      // les présences : identiques, ligne pour ligne (même Evenement, même statut, même personne)
      assert.deepEqual(await lirePresences(doc), presencesAvant);

      // la page du propriétaire montre déjà les nouveaux titres ; ses choix sont intacts
      const siens = await instantane(proprio.widget);
      assert.deepEqual(siens.map((e) => espaces(e.titre)), titresAttendus());
      assert.equal(await monProgramme(proprio.widget), 4);

      // la page de Karim, restée ouverte : le widget relit les événements chaque minute (CONFIG.rafraichissementMs), puis nouveaux titres, mêmes participants, mêmes choix
      await attendre(async () => (await instantane(karim.widget)).some((e) => espaces(e.titre).startsWith('Space Meet-Up')), { delai: 90000, pas: 1000, message: 'la page ouverte n\'a pas relu les événements' });
      const apresKarim = await instantane(karim.widget);
      assert.deepEqual(sansTitre(apresKarim), sansTitre(avantKarim));
      assert.deepEqual(apresKarim.map((e) => espaces(e.titre)), titresAttendus());
      assert.deepEqual(karim.page.erreurs, []);

      // une personne qui arrive après : Jeanne retrouve ses sept choix, sur les bonnes séances, et rien n'est réécrit
      const jeanne = await ouvrir(JEANNE, doc);
      assert.deepEqual(await jeanne.messages(), [], 'plus rien à corriger : aucun message');
      assert.equal(await monProgramme(jeanne.widget), 7);
      const ses = await instantane(jeanne.widget);
      const choix = (titreDebut) => ses.find((e) => espaces(e.titre).startsWith(titreDebut)).moi;
      assert.deepEqual(choix('Salon des entreprises'), ['true', 'false']);
      assert.deepEqual(choix('Space Meet-Up'), ['false', 'true']);
      assert.deepEqual(choix('Échoppe des Sciences'), ['false', 'true']);
      assert.deepEqual(choix('Construire autrement : bois de feuillus'), ['true', 'false']);
      assert.deepEqual(choix('Serious Game'), ['true', 'false']);
      assert.deepEqual(sansTitre(ses).map((e) => e.comptes), sansTitre(avantKarim).map((e) => e.comptes), 'mêmes compteurs que la page ouverte avant');
      // les deux séances désormais ouvertes aux entreprises apparaissent dans ce filtre : 13 + 2
      await jeanne.widget.locator('[data-cible="entreprises"]').evaluate((b) => b.click());
      assert.equal(await jeanne.widget.locator(SEL.evenement).count(), 15);
      assert.deepEqual(jeanne.page.erreurs, []);
      assert.deepEqual(await lireEvenements(doc), evtsApres);
      assert.deepEqual(await lirePresences(doc), presencesAvant);
    });

    test('avec les règles d\'Antoine (Evenements modifiable par les seuls propriétaires) : une éditrice ne change rien, sans bruit ; le propriétaire corrige', async () => {
      const doc = await enService({ regles: true });
      const evtsAvant = await lireEvenements(doc);
      const presencesAvant = await lirePresences(doc);

      const jeanne = await ouvrir(JEANNE, doc);
      await pause(1500);
      assert.deepEqual(await lireEvenements(doc), evtsAvant, 'refusé en bloc : rien n\'est écrit, pas même à moitié');
      assert.deepEqual(await jeanne.messages(), []);
      assert.deepEqual(jeanne.page.erreurs, []);
      assert.deepEqual(await jeanne.messagesGrist(), [], 'aucun message d\'erreur de Grist devant l\'éditrice');
      assert.ok((await instantane(jeanne.widget)).some((e) => espaces(e.titre).startsWith('Soirée des entreprises')), 'elle voit encore l\'ancien titre');
      assert.equal(await monProgramme(jeanne.widget), 7);

      const proprio = await ouvrir(PROPRIO, doc);
      assert.match((await proprio.messages()).join('\n'), MESSAGE);
      assert.deepEqual((await lireEvenements(doc)).map(comme), evenements().map(comme));
      assert.deepEqual(await lirePresences(doc), presencesAvant);
    });

    test('une cellule retouchée à la main n\'est pas écrasée, le reste est corrigé ; rouvrir ne change plus rien', async () => {
      const doc = await enService();
      const evts = await lireEvenements(doc);
      const soiree = evts.find((e) => e.Titre.startsWith('Soirée des entreprises'));
      const entractes = evts.find((e) => e.Titre.startsWith('Entractes'));
      await appliquer(PROPRIO, doc.doc, [
        ['UpdateRecord', 'Evenements', soiree.id, { Titre: 'Soirée des entreprises (titre retouché à la main)' }],
        ['UpdateRecord', 'Evenements', entractes.id, { Cibles: ['L', 'Recherche', 'Étudiants'] }],
      ]);
      const presencesAvant = await lirePresences(doc);

      const proprio = await ouvrir(PROPRIO, doc);
      assert.match((await proprio.messages()).join('\n'), /Planning mis à jour : 5 séances corrigées/);
      assert.deepEqual(proprio.page.erreurs, []);
      const apres = await lireEvenements(doc);
      assert.equal(apres.find((e) => e.id === soiree.id).Titre, 'Soirée des entreprises (titre retouché à la main)');
      assert.deepEqual(apres.find((e) => e.id === entractes.id).Cibles, ['L', 'Recherche', 'Étudiants']);
      assert.ok(apres.some((e) => e.Titre === 'Échoppe des Sciences'));
      assert.deepEqual(await lirePresences(doc), presencesAvant);

      const encore = await ouvrir(PROPRIO, doc);
      assert.deepEqual(await encore.messages(), []);
      assert.deepEqual(await lireEvenements(doc), apres, 'rouvrir ne change rien');
    });

    test('sans colonne Cibles : les titres sont corrigés d\'abord, puis la colonne est créée et remplie d\'après les plannings du 22/10', async () => {
      const r = await creerDocument(`Test maj ${new Date().toISOString()}`, { widget: `${srv.url}/index.html`, liste: evenementsAvant(), cibles: false });
      docs.push(r.doc);
      const proprio = await ouvrir(PROPRIO, r);
      assert.deepEqual(proprio.page.erreurs, []);
      assert.deepEqual((await lireEvenements(r)).map(comme), evenements().map(comme), 'titres corrigés, Cibles créée avec les valeurs du 22/10');
    });

    test('contre-exemple : vider puis réimporter la table Evenements efface toutes les présences (Grist remet à zéro les références vers les lignes supprimées)', async () => {
      const doc = await enService();
      const evts = await lireEvenements(doc);
      await appliquer(PROPRIO, doc.doc, [['BulkRemoveRecord', 'Evenements', evts.map((e) => e.id)]]);
      assert.ok((await lirePresences(doc)).every((l) => l.Evenement === 0), 'dès la suppression des lignes, les références sont remises à zéro');
      const nouveaux = evenements();
      await appliquer(PROPRIO, doc.doc, [['BulkAddRecord', 'Evenements', nouveaux.map(() => null), Object.fromEntries(COLONNES.map((c) => [c, nouveaux.map((e) => e[c] ?? null)]))]]);
      assert.ok((await lirePresences(doc)).every((l) => l.Evenement === 0), 'la réimportation ne les rétablit pas');
      const jeanne = await ouvrir(JEANNE, doc, { sansCorrection: true });
      assert.equal(await monProgramme(jeanne.widget), 0, 'Jeanne ne retrouve aucun de ses sept choix');
    });
  });
});
