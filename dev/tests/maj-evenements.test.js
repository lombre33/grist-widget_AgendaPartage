/* Mise à jour du planning du 22/10 sur un document déjà en service (dev/grist/maj-evenements.js, data/modifs-planning-22-oct.json) :
   départ = la table Evenements de la version du 13/10 avec des présences déjà enregistrées par plusieurs personnes ; arrivée = la version
   du 22/10 (dev/evenements.js), sans qu'aucune présence ne bouge. Joué dans un vrai Grist (voir dev/grist/serveur.sh), ignoré s'il ne répond pas. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { serveur, lancerNavigateur, attendre, pause, SEL } = require('./helpers');
const { GRIST, PROPRIETAIRE, api, appliquer, lignes, partager, contexteNavigateur } = require('../grist/lib');
const { creerDocument, supprimerDocument, evenements } = require('../grist/document');
const { maj, planifier } = require('../grist/maj-evenements');

const PROPRIO = PROPRIETAIRE;
const JEANNE = 'jeanne.delmas@u-bordeaux.fr';
const KARIM = 'karim.benali@bordeaux-inp.fr';
const { modifications } = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/modifs-planning-22-oct.json'), 'utf8'));

/** Les séances de la version du 13/10 (avant la mise à jour). */
let avant13;
function evenementsAvant() {
  if (!avant13) {   // require ne rejoue pas un fichier déjà chargé : on garde la liste la première fois
    global.window = {};
    require('./fixtures/evenements-avant-22-oct.js');
    avant13 = global.window.MOCK_EVENEMENTS;
    delete global.window;
  }
  return avant13;
}

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

describe('mise à jour du planning du 22/10 (cellules modifiées en place)', () => {
  test('le fichier de modifications ne contient que ce qui sépare l\'ancien Excel du nouveau', () => {
    const avant = evenementsAvant();
    const apres = evenements();
    const attendu = [];
    avant.forEach((a, i) => {
      for (const champ of Object.keys(a)) {
        if (JSON.stringify(a[champ]) !== JSON.stringify(apres[i][champ])) attendu.push([a.Jour, a.Debut, a.Titre, champ, apres[i][champ]]);
      }
    });
    assert.equal(avant.length, apres.length);
    const dansFichier = modifications.flatMap((m) => Object.keys(m.apres).map((champ) => [m.titre, champ, champ === 'Cibles' ? ['L', ...m.apres.Cibles] : m.apres[champ]]));
    assert.deepEqual(dansFichier.map(([t, c, v]) => JSON.stringify([t, c, v])).sort(), attendu.map(([, , t, c, v]) => JSON.stringify([t, c, v])).sort());
    assert.equal(attendu.length, 7);
  });

  test('planifier : liste de choix, texte, cellule modifiée à la main, séance introuvable ou en double', () => {
    const m = [
      { jour: '2026-11-24', debut: '09:00', titre: 'Entractes', avant: { Cibles: ['Recherche'] }, apres: { Cibles: ['Recherche', 'Entreprises'] } },
    ];
    const ligne = (Cibles) => ({ id: 3, Jour: Date.UTC(2026, 10, 24) / 1000, Debut: '09:00', Titre: 'Entractes', Cibles });
    assert.deepEqual(planifier([ligne(['L', 'Recherche'])], m)[0].cellules, { Cibles: ['L', 'Recherche', 'Entreprises'] });
    assert.deepEqual(planifier([ligne('Recherche')], m)[0].cellules, { Cibles: 'Recherche, Entreprises' });
    assert.equal(planifier([ligne(['L', 'Entreprises', 'Recherche'])], m)[0].etat, 'deja-fait');
    assert.equal(planifier([ligne(['L', 'Recherche', 'Étudiants'])], m)[0].etat, 'different');
    assert.equal(planifier([ligne(null)], m)[0].etat, 'different');
    assert.equal(planifier([], m)[0].etat, 'introuvable');
    assert.equal(planifier([ligne(['L', 'Recherche']), { ...ligne(['L', 'Recherche']), id: 4 }], m)[0].etat, 'ambigu');
    // apostrophe droite ou courbe, majuscules, espaces : même séance
    const t = [{ jour: '2026-11-26', debut: '10:30', titre: 'L’Échoppe des Sciences', avant: { Titre: 'L’Échoppe des Sciences' }, apres: { Titre: 'Échoppe des Sciences' } }];
    assert.equal(planifier([{ id: 1, Jour: Date.UTC(2026, 10, 26) / 1000, Debut: '10:30', Titre: "L'échoppe  des Sciences" }], t)[0].etat, 'a-faire');
  });

  describe('vrai Grist', { skip: disponible ? false : `Grist ne répond pas sur ${GRIST} : lancer sh dev/grist/serveur.sh` }, () => {
    let srv; let navigateur; const docs = [];
    before(async () => { srv = await serveur(); navigateur = await lancerNavigateur(); });
    after(async () => { await navigateur.close(); await srv.fermer(); for (const d of docs) await supprimerDocument(d); });

    const apiProprio = (methode, chemin, corps) => api(PROPRIO, methode, chemin, corps);
    const lireEvenements = (doc) => lignes(PROPRIO, doc.doc, 'Evenements');
    const lirePresences = (doc) => lignes(PROPRIO, doc.doc, 'Participations');

    /** Un document en service : événements de la version du 13/10, présences de trois personnes. */
    async function enService() {
      const r = await creerDocument(`Test maj ${new Date().toISOString()}`, { widget: `${srv.url}/index.html`, liste: evenementsAvant() });
      docs.push(r.doc);
      for (const email of r.emails.slice(1)) await partager(r.doc, email, 'editors');
      const { page } = await ouvrir(PROPRIO, r);   // première ouverture par le propriétaire : le widget crée les colonnes de Participations
      await page.context().close();
      const evts = await lireEvenements(r);
      const id = (debut) => evts.find((e) => e.Titre.startsWith(debut)).id;
      for (const [qui, debut, statut] of PRESENCES) await appliquer(qui, r.doc, [['AddRecord', 'Participations', null, { Evenement: id(debut), Statut: statut }]]);
      assert.equal((await lirePresences(r)).length, PRESENCES.length);
      return r;
    }

    async function ouvrir(utilisateur, doc) {
      const contexte = await contexteNavigateur(navigateur, utilisateur, { viewport: { width: 1300, height: 900 } });
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
      return { page, widget, contexte };
    }

    /** Ce que la personne voit : pour chaque séance, son titre, qui y va (présent / à confirmer, avec les noms) et son propre choix. */
    const instantane = (widget) => widget.evaluate(() => [...document.querySelectorAll('.evt')].map((e) => ({
      titre: e.querySelector('.evt__titre').textContent,
      comptes: ['sur', 'probable'].map((c) => Number(((e.querySelector(`.compte--${c}`) || {}).textContent || '0').match(/\d+/)[0])),
      moi: ['sur', 'probable'].map((c) => e.querySelector(`button[data-valeur="${c}"]`).getAttribute('aria-pressed')),
    })));
    const sansTitre = (liste) => liste.map(({ comptes, moi }) => ({ comptes, moi }));
    const monProgramme = async (widget) => Number(((await widget.locator(SEL.filtre).innerText().catch(() => '')).match(/Mon programme \((\d+)\)/) || [0, 0])[1]);   // sans présence, le filtre n'affiche pas de nombre

    const COLONNES = ['Jour', 'Debut', 'Fin', 'Titre', 'Sous_titre', 'Type', 'Temps_fort', 'Lieu', 'Ville', 'Adresse', 'Public', 'Cibles', 'Description', 'Lien'];
    const comme = (evt) => Object.fromEntries(COLONNES.map((c) => [c, evt[c] ?? '']));

    test('les sept cellules changent, les mêmes lignes restent, toutes les présences restent sur leurs séances (page ouverte avant, page ouverte après)', async () => {
      const doc = await enService();
      const karim = await ouvrir(KARIM, doc);   // reste ouverte pendant toute l'opération : elle doit se mettre à jour en direct
      const avantKarim = await instantane(karim.widget);
      assert.equal(await monProgramme(karim.widget), 5);
      const evtsAvant = await lireEvenements(doc);
      const presencesAvant = await lirePresences(doc);

      // simulation : rien n'est écrit
      const essai = await maj({ api: apiProprio, doc: doc.doc, modifications, appliquer: false });
      assert.deepEqual(essai.plan.map((p) => p.etat), Array(7).fill('a-faire'));
      assert.deepEqual(await lireEvenements(doc), evtsAvant, 'la simulation n\'écrit rien');

      // écriture
      const journal = [];
      const resultat = await maj({ api: apiProprio, doc: doc.doc, modifications, appliquer: true, journal: (l) => journal.push(l) });
      assert.equal(resultat.ecrit, true);
      assert.deepEqual(resultat.verification, []);

      // Evenements = exactement la version du 22/10 (dev/evenements.js), mêmes numéros de ligne qu'avant
      const evtsApres = await lireEvenements(doc);
      assert.deepEqual(evtsApres.map((e) => e.id), evtsAvant.map((e) => e.id));
      assert.deepEqual(evtsApres.map(comme), evenements().map(comme));
      assert.equal(evtsApres.filter((e, i) => JSON.stringify(comme(e)) !== JSON.stringify(comme(evtsAvant[i]))).length, 7, 'sept lignes changées, pas une de plus');

      // les présences : identiques, ligne pour ligne (même Evenement, même statut, même personne)
      assert.deepEqual(await lirePresences(doc), presencesAvant);

      // la page Karim, restée ouverte : le widget relit les événements chaque minute (CONFIG.rafraichissementMs), puis nouveaux titres, mêmes participants, mêmes choix
      await attendre(async () => (await instantane(karim.widget)).some((e) => espaces(e.titre).startsWith('Space Meet-Up')), { delai: 90000, pas: 1000, message: 'la page ouverte n\'a pas relu les événements' });
      const apresKarim = await instantane(karim.widget);
      assert.deepEqual(sansTitre(apresKarim), sansTitre(avantKarim));
      assert.deepEqual(apresKarim.map((e) => espaces(e.titre)), evenements().map((e) => espaces(`${e.Titre}${e.Sous_titre ? `. ${e.Sous_titre}` : ''}`)));
      assert.deepEqual(karim.page.erreurs, []);

      // une personne qui arrive après : Jeanne retrouve ses sept choix, sur les bonnes séances
      const jeanne = await ouvrir(JEANNE, doc);
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

      // rejouer ne change rien
      const encore = await maj({ api: apiProprio, doc: doc.doc, modifications, appliquer: true });
      assert.deepEqual(encore.plan.map((p) => p.etat), Array(7).fill('deja-fait'));
      assert.equal(encore.ecrit, false);
      assert.deepEqual(await lireEvenements(doc), evtsApres);
      assert.deepEqual(await lirePresences(doc), presencesAvant);
    });

    test('une cellule modifiée à la main ou une séance introuvable est signalée et laissée telle quelle ; le reste est appliqué', async () => {
      const doc = await enService();
      const evts = await lireEvenements(doc);
      const soiree = evts.find((e) => e.Titre.startsWith('Soirée des entreprises'));
      const entractes = evts.find((e) => e.Titre.startsWith('Entractes'));
      await appliquer(PROPRIO, doc.doc, [
        ['UpdateRecord', 'Evenements', soiree.id, { Titre: 'Soirée des entreprises (titre retouché à la main)' }],
        ['UpdateRecord', 'Evenements', entractes.id, { Cibles: ['L', 'Recherche', 'Étudiants'] }],
      ]);
      const presencesAvant = await lirePresences(doc);
      const resultat = await maj({ api: apiProprio, doc: doc.doc, modifications, appliquer: true });
      assert.deepEqual(resultat.plan.map((p) => p.etat), ['different', 'a-faire', 'a-faire', 'a-faire', 'introuvable', 'a-faire', 'a-faire']);
      assert.deepEqual(resultat.verification, []);
      const apres = await lireEvenements(doc);
      assert.equal(apres.find((e) => e.id === soiree.id).Titre, 'Soirée des entreprises (titre retouché à la main)');
      assert.deepEqual(apres.find((e) => e.id === entractes.id).Cibles, ['L', 'Recherche', 'Étudiants']);
      assert.ok(apres.some((e) => e.Titre === 'Échoppe des Sciences'));
      assert.deepEqual(await lirePresences(doc), presencesAvant);
    });

    test('contre-exemple : vider puis réimporter la table Evenements efface toutes les présences (Grist remet à zéro les références vers les lignes supprimées)', async () => {
      const doc = await enService();
      const evts = await lireEvenements(doc);
      await appliquer(PROPRIO, doc.doc, [['BulkRemoveRecord', 'Evenements', evts.map((e) => e.id)]]);
      assert.ok((await lirePresences(doc)).every((l) => l.Evenement === 0), 'dès la suppression des lignes, les références sont remises à zéro');
      const nouveaux = evenements();
      await appliquer(PROPRIO, doc.doc, [['BulkAddRecord', 'Evenements', nouveaux.map(() => null), Object.fromEntries(COLONNES.map((c) => [c, nouveaux.map((e) => e[c] ?? null)]))]]);
      assert.ok((await lirePresences(doc)).every((l) => l.Evenement === 0), 'la réimportation ne les rétablit pas');
      const jeanne = await ouvrir(JEANNE, doc);
      assert.equal(await monProgramme(jeanne.widget), 0, 'Jeanne ne retrouve aucun de ses sept choix');
    });
  });
});
