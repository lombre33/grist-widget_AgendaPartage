/* Le widget dans un navigateur avec le faux Grist de dev/ : affichage, choix, reconnaissance de la personne,
   erreurs d'écriture, première ouverture. Les options d'URL du faux Grist sont décrites en tête de dev/mock-grist.js. */
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { serveur, lancerNavigateur, attendre, pause, SEL, ouvrirFaux } = require('./helpers');

let srv; let navigateur;
before(async () => { srv = await serveur(); navigateur = await lancerNavigateur(); });
after(async () => { await navigateur.close(); await srv.fermer(); });

const ouvrir = (options) => ouvrirFaux(navigateur, srv.url, options);
const carte = (page, titre) => page.locator(SEL.evenement, { hasText: titre });
const resume = (page, titre) => carte(page, titre).locator(`${SEL.resume}, ${SEL.personne}`).innerText();
/** [nombre de présents, nombre à confirmer] d'un événement, lus dans les compteurs (indépendant de la largeur d'écran). */
const comptes = (page, titre) => carte(page, titre).evaluate((e) => ['sur', 'probable'].map((c) => Number(((e.querySelector(`.compte--${c}`) || {}).textContent || '0').match(/\d+/)[0])));
const actions = (page) => page.evaluate(() => window.MOCK_ACTIONS);
const lignes = (page) => page.evaluate(async () => {
  const t = await grist.docApi.fetchTable('Participations');
  return t.id.map((id, i) => ({ id, email: t.Email && t.Email[i], evt: t.Evenement && t.Evenement[i], statut: t.Statut && t.Statut[i], utilisateur: t.Utilisateur && t.Utilisateur[i] }));
});
const aucuneErreur = (page) => assert.deepEqual(page.erreurs, [], 'erreurs inattendues dans la console');
const texteAttendu = (page, selecteur, regle) => attendre(async () => regle.test(await page.locator(selecteur).innerText()), { message: `${selecteur} ne correspond pas à ${regle}` });
const pressed = (page, titre, bouton) => carte(page, titre).locator(bouton).getAttribute('aria-pressed');

describe('affichage', () => {
  test('bureau : tous les événements, les cinq jours, le nom de la personne connectée', async () => {
    const page = await ouvrir();
    assert.equal(await page.locator(SEL.evenement).count(), 30);
    assert.equal(await page.locator(SEL.nom).innerText(), 'Camille Martin');
    assert.deepEqual(await comptes(page, 'Les Evolutive Learning'), [5, 1]);
    assert.match(await page.locator(SEL.pied).innerText(), /^Version \S+ · \S+ · \d+ lignes? dans « Participations »$/);
    aucuneErreur(page);
  });

  test('mobile : un jour à la fois, onglets pour changer de jour, boutons toujours visibles', async () => {
    const page = await ouvrir({ largeur: 390, hauteur: 844 });
    assert.equal(await page.locator(SEL.jourActif).count(), 1);
    assert.equal(await page.locator(SEL.onglet).count(), 5);
    assert.match(await page.locator(SEL.evenement).first().locator('.choix').innerText(), /Présent[\s\S]*À confirmer/);
    assert.deepEqual(await comptes(page, 'Le Transmedia'), [1, 1]);
    await page.click('[data-jour="2026-11-25"]');
    assert.match(await page.locator(`${SEL.jourActif} .jour__date`).innerText(), /25 novembre/);
    aucuneErreur(page);
  });

  for (const [nom, largeur, hauteur] of [['mobile', 390, 844], ['petit mobile', 320, 640], ['tablette', 820, 1000], ['bureau', 1400, 900]]) {
    test(`${nom} : jamais de défilement horizontal`, async () => {
      const page = await ouvrir({ largeur, hauteur });
      const sansDefilement = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      await page.locator(`${SEL.ligneParticipants}:visible`).first().click();
      await page.locator(`${SEL.info}:visible`).first().click();
      assert.ok(await sansDefilement(), 'défilement horizontal avec la liste et les infos ouvertes');
      const onglets = page.locator(`${SEL.onglet}:visible`);
      for (let i = 0; i < await onglets.count(); i++) {
        await onglets.nth(i).click();
        assert.ok(await sansDefilement(), `défilement horizontal, onglet ${i + 1}`);
      }
    });
  }

  test('participants : liste avec leur statut et leur établissement, qui s\'ouvre et se referme', async () => {
    const page = await ouvrir();
    const evolu = carte(page, 'Les Evolutive Learning');
    const bouton = evolu.locator(SEL.ligneParticipants);
    assert.equal(await bouton.getAttribute('aria-expanded'), 'false');
    await bouton.click();
    assert.equal(await bouton.getAttribute('aria-expanded'), 'true');
    const items = await evolu.locator(`${SEL.liste} li`).allInnerTexts();
    assert.equal(items.length, 6);
    assert.ok(items[0].includes('Présent'));
    assert.ok(items.some((x) => x.includes('À confirmer')));
    assert.ok(items.some((x) => x.includes('Université de Bordeaux')), 'l\'établissement figure à côté du nom');
    await bouton.click();
    assert.equal(await evolu.locator(`${SEL.liste}`).count(), 0, 'la liste se referme');
    aucuneErreur(page);
  });

  test('informations pratiques : le « i » déplie l\'adresse (vers la carte), le public et la fiche du site', async () => {
    const page = await ouvrir();
    const evolu = carte(page, 'Les Evolutive Learning');
    const info = evolu.locator(SEL.info);
    assert.equal(await info.getAttribute('aria-expanded'), 'false');
    assert.equal(await evolu.locator(SEL.infos).count(), 0);
    await info.click();
    assert.equal(await info.getAttribute('aria-expanded'), 'true');
    assert.equal(await evolu.locator(`${SEL.infos} a`).count(), 2);   // adresse (carte) + fiche du site
    assert.equal(await evolu.locator(`${SEL.infos} dd a`).getAttribute('href'), await evolu.locator(SEL.lieu).getAttribute('href'));
    assert.match(await evolu.locator(SEL.infos).innerText(), /Enseignants-chercheurs/);
    await info.click();
    assert.equal(await evolu.locator(SEL.infos).count(), 0);
  });

  test('longue liste (60 personnes) : groupée par établissement, limitée, avec « Voir les autres »', async () => {
    const page = await ouvrir({ requete: '?foule' });
    const c = carte(page, 'Atelier Durable');
    assert.deepEqual(await comptes(page, 'Atelier Durable'), [48, 12]);
    await c.locator(SEL.ligneParticipants).click();
    assert.ok(await c.locator('.groupe').count() >= 1, 'les noms sont rangés sous le nom de leur établissement');
    assert.match(await c.locator('.groupe__tete').first().innerText(), /\d+$/, 'chaque groupe indique son nombre de personnes');
    assert.equal(await c.locator(`${SEL.liste} li`).count(), 12, 'liste limitée à douze noms');
    assert.match(await c.locator('.detail__tout').innerText(), /Voir les 48 autres/);
    await c.locator('.detail__tout').click();
    assert.equal(await c.locator(`${SEL.liste} li`).count(), 60);
    assert.equal(await c.locator('.groupe').count(), 5, 'un groupe par établissement');
    assert.match(await c.locator('.detail__tout').innerText(), /Réduire la liste/);
    await c.locator('.detail__tout').click();
    assert.equal(await c.locator(`${SEL.liste} li`).count(), 12);
  });

  test('onglets : le nombre d\'événements de mon programme s\'affiche sur chaque jour et se met à jour', async () => {
    const page = await ouvrir({ largeur: 390, hauteur: 844 });
    const badge = (jour) => page.locator(`[data-jour="${jour}"] .onglet__n`);
    assert.equal(await badge('2026-11-23').count(), 0);
    assert.equal(await badge('2026-11-24').innerText(), '2');
    await carte(page, 'Atelier Durable').locator(SEL.present).click();
    await attendre(async () => (await badge('2026-11-23').count()) === 1 && (await badge('2026-11-23').innerText()) === '1');
  });

  test('anciennes valeurs « sûr » et « probable » toujours comptées', async () => {
    const page = await ouvrir();
    assert.deepEqual(await comptes(page, 'Le Transmedia'), [1, 1]);
  });

  test('filtre « Mon programme »', async () => {
    const page = await ouvrir();
    assert.match(await page.locator(SEL.filtre).innerText(), /Mon programme \(2\)/);
    await page.locator(SEL.filtre).click();
    assert.equal(await page.locator(SEL.evenement).count(), 2);
    await page.locator(SEL.filtre).click();
    assert.equal(await page.locator(SEL.evenement).count(), 30);
  });

  test('temps réel : un autre participant bouge, l\'affichage suit sans relecture ni rechargement', async () => {
    const page = await ouvrir();
    await page.evaluate(() => { document.body.dataset.pasRecharge = 'oui'; });
    const avant = await page.locator(SEL.resume).allInnerTexts();
    for (let i = 0; i < 6; i++) { await page.click('#simuler'); await pause(80); }
    await attendre(async () => JSON.stringify(await page.locator(SEL.resume).allInnerTexts()) !== JSON.stringify(avant), { message: 'aucune mise à jour en direct' });
    assert.equal(await page.evaluate(() => document.body.dataset.pasRecharge), 'oui');
  });
});

describe('publics visés (Pour qui ?)', () => {
  const bulle = (page, code) => page.locator(`[data-cible="${code}"]`);
  const titres = (page) => page.locator(`${SEL.evenement} .evt__titre`).allInnerTexts();

  test('une bulle par public au-dessus des jours, aucune cochée au départ, rien de changé sur les fiches', async () => {
    const page = await ouvrir();
    assert.deepEqual(await page.locator('.bulle').allInnerTexts(), ['Pédagogie', 'Recherche', 'Étudiants', 'Entreprises', 'Personnels']);
    assert.equal(await page.locator('.bulle[aria-pressed="true"]').count(), 0);
    assert.equal(await page.locator(SEL.evenement).count(), 30);
    assert.equal(await page.locator(`${SEL.evenement} .cible, ${SEL.evenement} .bulle`).count(), 0, 'les fiches ne montrent aucun public');
    aucuneErreur(page);
  });

  test('cocher un public ne garde que ses événements, plusieurs publics s\'additionnent, décocher revient à tout', async () => {
    const page = await ouvrir();
    await bulle(page, 'etudiants').click();
    assert.equal(await page.locator(SEL.evenement).count(), 7);
    assert.equal(await bulle(page, 'etudiants').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#cibles-nb').innerText(), /^7 événements sur 30$/);
    await bulle(page, 'recherche').click();
    assert.equal(await page.locator(SEL.evenement).count(), 20);   // 7 + 16, dont 3 en commun
    await bulle(page, 'etudiants').click();
    await bulle(page, 'recherche').click();
    assert.equal(await page.locator(SEL.evenement).count(), 30);
    aucuneErreur(page);
  });

  test('la conférence ouverte aux quatre publics reste, l\'événement réservé aux personnels disparaît dès qu\'on filtre un autre public', async () => {
    const page = await ouvrir();
    assert.equal(await carte(page, 'No wrong door').count(), 1);
    await bulle(page, 'entreprises').click();
    assert.equal(await carte(page, 'L’IA au service des patients').count(), 1);
    assert.equal(await carte(page, 'No wrong door').count(), 0);
    assert.equal(await page.locator(SEL.evenement).count(), 13);
  });

  test('Personnels : une seule séance (le serious game), qui s\'additionne aux autres publics, sans toucher à leurs comptes', async () => {
    const page = await ouvrir();
    await bulle(page, 'personnels').click();
    const affiches = await titres(page);
    assert.equal(affiches.length, 1);
    assert.match(affiches[0], /^Serious game .*No wrong door.* avec le Pôle universitaire d’innovation Bordeaux$/);
    assert.match(await page.locator('#cibles-nb').innerText(), /^1 événement sur 30$/);
    assert.equal(await bulle(page, 'personnels').getAttribute('aria-pressed'), 'true');
    await bulle(page, 'etudiants').click();
    assert.equal(await page.locator(SEL.evenement).count(), 8);   // 7 étudiants + le serious game
    await bulle(page, 'personnels').click();
    assert.equal(await page.locator(SEL.evenement).count(), 7);
    for (const [code, attendu] of [['pedagogie', 13], ['recherche', 16], ['entreprises', 13]]) {
      await page.reload();
      await page.waitForSelector(SEL.evenement);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.waitForSelector(SEL.evenement);
      await bulle(page, code).click();
      assert.equal(await page.locator(SEL.evenement).count(), attendu, code);
    }
    aucuneErreur(page);
  });

  test('aucune séance « Personnels » dans la colonne : la rangée garde ses quatre bulles et le serious game n\'est plus rattaché à un public', async () => {
    const page = await ouvrir({ requete: '?sans-personnels' });
    assert.deepEqual(await page.locator('.bulle').allInnerTexts(), ['Pédagogie', 'Recherche', 'Étudiants', 'Entreprises']);
    assert.equal(await bulle(page, 'personnels').count(), 0);
    assert.equal(await page.locator(SEL.evenement).count(), 30);
    await bulle(page, 'etudiants').click();
    assert.equal(await page.locator(SEL.evenement).count(), 7);
    await page.evaluate(() => localStorage.setItem('semaine-innovation-2026:cibles', JSON.stringify(['personnels'])));
    await page.reload();
    await page.waitForSelector(SEL.evenement);
    assert.equal(await page.locator(SEL.evenement).count(), 30, 'un choix mémorisé pour une bulle absente est ignoré');
    aucuneErreur(page);
  });

  test('jour sans événement pour ce public : un message, et « Mon programme » se combine au filtre', async () => {
    const page = await ouvrir();
    await bulle(page, 'etudiants').click();
    assert.deepEqual(await page.locator('.jour__vide').allInnerTexts(), ['Aucun événement pour ce public ce jour-là.', 'Aucun événement pour ce public ce jour-là.']);
    await page.click(SEL.filtre);
    assert.equal(await page.locator(SEL.evenement).count(), 0);   // Camille n'a choisi aucun événement pour les étudiants
    assert.equal(await page.locator('.jour__vide').count(), 5);
    aucuneErreur(page);
  });

  test('le choix est gardé au rechargement ; un choix illisible est ignoré', async () => {
    const page = await ouvrir();
    await bulle(page, 'recherche').click();
    await page.reload();
    await page.waitForSelector(SEL.evenement);
    assert.equal(await bulle(page, 'recherche').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator(SEL.evenement).count(), 16);
    await page.evaluate(() => localStorage.setItem('semaine-innovation-2026:cibles', '{pas du json'));
    await page.reload();
    await page.waitForSelector(SEL.evenement);
    assert.equal(await page.locator(SEL.evenement).count(), 30);
  });

  test('sans colonne Cibles, la rangée n\'apparaît pas et le planning est inchangé', async () => {
    const page = await ouvrir({ requete: '?sans-cibles' });
    assert.equal(await page.locator('#cibles').isVisible(), false);
    assert.equal(await page.locator(SEL.evenement).count(), 30);
    aucuneErreur(page);
  });

  test('petit mobile : les bulles tiennent sans défilement horizontal de la page', async () => {
    const page = await ouvrir({ largeur: 320, hauteur: 640 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.equal(await page.locator('.bulle:visible').count(), 5);
  });
});

describe('lieu et carte', () => {
  test('le lieu est un lien Google Maps (adresse si elle existe), dans un nouvel onglet', async () => {
    const page = await ouvrir();
    const lien = carte(page, 'Les Evolutive Learning').locator(SEL.lieu);
    assert.equal(await lien.count(), 1);
    assert.equal(await lien.getAttribute('target'), '_blank');
    assert.match(await lien.getAttribute('rel'), /noopener/);
    assert.equal(await lien.getAttribute('href'), `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Esplanade des Arts et Métiers, 33400 Talence')}`);
    assert.match(await lien.getAttribute('aria-label'), /Voir sur la carte : Arts et Métiers, halle technologique, Talence/);
    assert.match(await lien.innerText(), /Arts et Métiers, halle technologique\s+Talence/);
  });

  test('sans adresse : recherche sur le lieu et la ville', async () => {
    const page = await ouvrir();
    assert.equal(await carte(page, 'Locaux du CATIE').locator(SEL.lieu).getAttribute('href'), `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Locaux du CATIE, ENSEIRB-MATMECA, Talence')}`);
  });

  test('cliquer sur le lieu ouvre la carte sans rien enregistrer ni déplier la carte', async () => {
    const page = await ouvrir();
    await page.context().route('https://www.google.com/**', (r) => r.fulfill({ contentType: 'text/html', body: 'carte' }));
    const evolu = carte(page, 'Les Evolutive Learning');
    const avant = (await actions(page)).length;
    const [onglet] = await Promise.all([page.context().waitForEvent('page'), evolu.locator(SEL.lieu).click()]);
    await onglet.waitForLoadState();
    assert.match(onglet.url(), /^https:\/\/www\.google\.com\/maps\/search\//);
    assert.equal((await actions(page)).length, avant);
    assert.equal(await evolu.locator(SEL.detail).count(), 0);
  });
});

describe('choix de présence', () => {
  test('présent, puis à confirmer, puis retiré : une seule ligne, créée, modifiée, supprimée', async () => {
    const page = await ouvrir();
    const c = carte(page, 'Atelier Durable');
    assert.match(await resume(page, 'Atelier Durable'), /Personne pour l’instant/);
    const evt = Number(await c.locator(SEL.present).getAttribute('data-evt'));

    await c.locator(SEL.present).click();
    await texteAttendu(page, SEL.toast, /Enregistré/);
    assert.equal(await pressed(page, 'Atelier Durable', SEL.present), 'true');
    assert.deepEqual(await comptes(page, 'Atelier Durable'), [1, 0]);
    assert.deepEqual((await actions(page)).at(-1), [['AddRecord', 'Participations', null, { Evenement: evt, Statut: 'présent' }]]);
    let miennes = (await lignes(page)).filter((l) => l.evt === evt);
    assert.equal(miennes.length, 1);
    assert.equal(miennes[0].email, 'camille.martin@u-bordeaux.fr');   // remplie par la formule, pas par le widget

    const lots = (await actions(page)).length;
    await c.locator(SEL.aConfirmer).click();
    await attendre(async () => (await actions(page)).length === lots + 1, { message: 'écriture non faite' });
    assert.deepEqual(await comptes(page, 'Atelier Durable'), [0, 1]);
    assert.deepEqual((await actions(page)).at(-1), [['UpdateRecord', 'Participations', miennes[0].id, { Statut: 'à confirmer' }]]);
    assert.equal((await lignes(page)).filter((l) => l.evt === evt).length, 1, 'pas de nouvelle ligne');

    const lots2 = (await actions(page)).length;
    await c.locator(SEL.aConfirmer).click();   // recliquer sur le choix en cours le retire
    await attendre(async () => (await actions(page)).length === lots2 + 1, { message: 'retrait non fait' });
    await attendre(async () => /Personne pour l’instant/.test(await resume(page, 'Atelier Durable')));
    assert.equal((await actions(page)).at(-1)[0][0], 'BulkRemoveRecord');
    assert.equal((await lignes(page)).filter((l) => l.evt === evt).length, 0);
    aucuneErreur(page);
  });

  test('recliquer sur le même bouton retire le choix', async () => {
    const page = await ouvrir();
    const c = carte(page, 'Atelier Durable');
    await c.locator(SEL.present).click();
    await attendre(async () => (await pressed(page, 'Atelier Durable', SEL.present)) === 'true');
    await attendre(async () => /Enregistré/.test(await page.locator(SEL.toast).innerText()));
    await c.locator(SEL.present).click();
    await attendre(async () => (await pressed(page, 'Atelier Durable', SEL.present)) === 'false');
    await attendre(async () => (await lignes(page)).filter((l) => l.email === 'camille.martin@u-bordeaux.fr').length === 2, { message: 'ligne non supprimée' });   // restent ses deux présences de démonstration
  });

  test('deux clics rapprochés sur deux événements : les deux sont enregistrés', async () => {
    const page = await ouvrir();
    await carte(page, 'Atelier Durable').locator(SEL.present).click();
    await carte(page, 'Le Transmedia').locator(SEL.aConfirmer).click();
    await attendre(async () => (await lignes(page)).filter((l) => l.email === 'camille.martin@u-bordeaux.fr').length === 4, { message: 'les deux lignes ne sont pas toutes enregistrées' });
    const evtDurable = Number(await carte(page, 'Atelier Durable').locator(SEL.present).getAttribute('data-evt'));
    const evtTrans = Number(await carte(page, 'Le Transmedia').locator(SEL.present).getAttribute('data-evt'));
    const miennes = (await lignes(page)).filter((l) => l.email === 'camille.martin@u-bordeaux.fr' && [evtDurable, evtTrans].includes(l.evt));
    assert.deepEqual(miennes.map((l) => [l.evt, l.statut]).sort(), [[evtDurable, 'présent'], [evtTrans, 'à confirmer']].sort());
    await attendre(async () => /Mon programme \(4\)/.test(await page.locator(SEL.filtre).innerText()));
  });

  test('le choix d\'une personne n\'efface pas celui des autres', async () => {
    const page = await ouvrir({ requete: '?moi=2' });
    const avant = (await lignes(page)).filter((l) => l.email !== 'karim.benali@bordeaux-inp.fr').map((l) => [l.id, l.statut]);
    await carte(page, 'Les Evolutive Learning').locator(SEL.present).click();
    await attendre(async () => (await lignes(page)).length > avant.length + 0);
    const apres = (await lignes(page)).filter((l) => l.email !== 'karim.benali@bordeaux-inp.fr').map((l) => [l.id, l.statut]);
    assert.deepEqual(apres, avant);
  });

  test('doublons : le widget n\'en garde qu\'une ligne quand on change de choix, et les supprime tous quand on retire', async () => {
    const page = await ouvrir({ requete: '?doublons' });
    const c = carte(page, 'Atelier Durable');
    assert.equal((await lignes(page)).filter((l) => l.email === 'camille.martin@u-bordeaux.fr' && l.evt === 3).length, 2);
    assert.equal(await pressed(page, 'Atelier Durable', SEL.present), 'true', 'un « présent » parmi les doublons l\'emporte');
    await c.locator(SEL.aConfirmer).click();
    await attendre(async () => (await lignes(page)).filter((l) => l.evt === 3).length === 1, { message: 'doublon non supprimé' });
    const [reste] = (await lignes(page)).filter((l) => l.evt === 3);
    assert.equal(reste.statut, 'à confirmer');
    await c.locator(SEL.aConfirmer).click();
    await attendre(async () => (await lignes(page)).filter((l) => l.evt === 3).length === 0);
  });

  test('ménage : mes lignes de connexion restées là sont supprimées au premier clic, pas celles des autres', async () => {
    const page = await ouvrir({ requete: '?orphelines' });
    const vides = () => lignes(page).then((l) => l.filter((x) => !x.evt));
    assert.equal((await vides()).length, 2);
    assert.deepEqual(await comptes(page, 'Les Evolutive Learning'), [5, 1], 'ces lignes ne comptent pas comme des présences');
    await carte(page, 'Atelier Durable').locator(SEL.present).click();
    await attendre(async () => (await vides()).length === 1, { message: 'ménage non fait' });
    assert.equal((await vides())[0].email, 'karim.benali@bordeaux-inp.fr');
    assert.equal((await lignes(page)).filter((l) => l.evt === 3).length, 1);
  });

  test('aucune ligne de connexion ne reste après le chargement', async () => {
    const page = await ouvrir();
    assert.equal((await lignes(page)).filter((l) => !l.evt).length, 0);
    assert.equal((await actions(page)).filter((l) => l[0][0] === 'AddColumn').length, 0, 'colonnes déjà là : rien à créer');
  });

  test('le widget n\'écrit jamais dans l\'Annuaire (l\'attribut utilisateur « acl » rechargerait le document)', async () => {
    for (const requete of ['', '?ambigu&moi=2', '?sans-colonnes', '?doublons', '?orphelines']) {
      const page = await ouvrir({ requete });
      await page.locator(SEL.evenement).first().locator(SEL.aConfirmer).click();
      await attendre(async () => (await actions(page)).length > 0);
      await pause(300);
      assert.equal((await actions(page)).flat().filter((a) => a[1] === 'Annuaire').length, 0, `action sur l'Annuaire avec ${requete}`);
    }
  });
});

describe('reconnaissance de la personne connectée', () => {
  test('autre personne, sans présence : son logo est celui de son établissement (nom de domaine)', async () => {
    const page = await ouvrir({ requete: '?moi=2&vide' });
    assert.equal(await page.locator(SEL.nom).innerText(), 'Karim Benali');
    assert.equal(await page.locator(`${SEL.moi} img.avatar`).count(), 1);
  });

  test('personne sans établissement connu : ses initiales à la place du logo', async () => {
    const page = await ouvrir({ requete: '?moi=7' });
    assert.match(await page.locator(SEL.nom).innerText(), /Sophie Roux/);
    assert.equal(await page.locator(`${SEL.moi} img.avatar`).count(), 0);
    assert.equal(await page.locator(`${SEL.moi} span.avatar`).innerText(), 'SR');
  });

  test('Annuaire restreint à sa propre ligne', async () => {
    const page = await ouvrir({ requete: '?restreint' });
    assert.equal(await page.locator(SEL.nom).innerText(), 'Camille Martin');
  });

  test('tous les e-mails lisibles (cas réel) : l\'adresse de connexion suffit, ligne de connexion supprimée', async () => {
    const page = await ouvrir({ requete: '?ambigu&moi=2' });
    assert.equal(await page.locator(SEL.nom).innerText(), 'Karim Benali');
    assert.equal(await page.locator(SEL.etat).innerText(), '');
    assert.ok(await page.locator('button[data-action="choisir"]').count() > 0);
    const lots = await actions(page);
    const ajout = lots.find((l) => l[0][0] === 'AddRecord');
    assert.deepEqual(ajout, [['AddRecord', 'Participations', null, {}]]);
    const retrait = lots.find((l) => l[0][0] === 'RemoveRecord');
    assert.deepEqual(retrait, [['RemoveRecord', 'Participations', retrait[0][2]]]);
    assert.equal((await lignes(page)).filter((l) => !l.evt).length, 0);
    await page.locator(SEL.evenement).first().locator(SEL.present).click();
    await attendre(async () => (await lignes(page)).filter((l) => l.email === 'karim.benali@bordeaux-inp.fr').length >= 2);
  });

  test('personne non connectée : message, lecture seule, pas de filtre', async () => {
    const page = await ouvrir({ largeur: 390, hauteur: 844, requete: '?anonyme' });
    assert.match(await page.locator(SEL.etat).innerText(), /pas reconnu/);
    assert.equal(await page.locator('button[data-action="choisir"]').count(), 0);
    assert.equal(await page.locator(SEL.filtre).isHidden(), true);
  });

  test('connectée mais absente de l\'Annuaire : on le dit, avec l\'adresse', async () => {
    const page = await ouvrir({ requete: '?inconnu' });
    assert.match(await page.locator(SEL.etat).innerText(), /quelquun@exemple\.org\) n’est pas dans la table « Annuaire »/);
    assert.equal(await page.locator('button[data-action="choisir"]').count(), 0);
  });

  test('repli : la formule « à la création » ne donne rien, un seul e-mail lisible', async () => {
    const page = await ouvrir({ requete: '?sans-declencheur' });
    assert.equal(await page.locator(SEL.nom).innerText(), 'Camille Martin');
  });

  test('repli impossible : message qui dit pourquoi et quoi faire', async () => {
    let page = await ouvrir({ requete: '?sans-declencheur&ambigu' });
    assert.match(await page.locator(SEL.etat).innerText(), /Vous n’êtes pas reconnu\(e\)/);   // le message clair est visible, le détail technique dans « Détail pour l’administrateur »
    assert.match(await page.locator(SEL.etat).textContent(), /Impossible de vous reconnaître \(adresse de connexion vide\).*table « Participations »/);
    assert.equal(await page.locator('button[data-action="choisir"]').count(), 0);
    page = await ouvrir({ requete: '?sans-ajout&ambigu' });
    assert.match(await page.locator(SEL.etat).textContent(), /Impossible de vous reconnaître \(erreur : Blocked by table create access rules\)/);
    page = await ouvrir({ requete: '?sans-ajout&restreint' });
    assert.equal(await page.locator(SEL.nom).innerText(), 'Camille Martin');
  });
});

describe('première ouverture et colonnes', () => {
  test('le widget crée les quatre colonnes de Participations avec les bons types, puis fonctionne', async () => {
    const page = await ouvrir({ largeur: 390, hauteur: 844, requete: '?sans-colonnes' });
    const creation = (await actions(page)).find((l) => l[0][0] === 'AddColumn');
    assert.deepEqual(creation.map((a) => a.slice(0, 3)), [['AddColumn', 'Participations', 'Email'], ['AddColumn', 'Participations', 'Utilisateur'], ['AddColumn', 'Participations', 'Evenement'], ['AddColumn', 'Participations', 'Statut']]);
    assert.deepEqual(creation[0][3], { type: 'Text', isFormula: false, formula: 'user.Email', recalcWhen: 0, label: 'E-mail de connexion' });
    assert.equal(creation[1][3].type, 'Ref:Annuaire');
    assert.equal(creation[1][3].isFormula, true);
    assert.match(creation[1][3].formula, /\$Email/);
    assert.equal(creation[2][3].type, 'Ref:Evenements');
    assert.equal(creation[3][3].type, 'Choice');
    assert.deepEqual(JSON.parse(creation[3][3].widgetOptions), { choices: ['présent', 'à confirmer'] });
    await texteAttendu(page, SEL.toast, /Configuration terminée/);
    assert.equal(await page.locator(SEL.etat).innerText(), '');
    assert.equal(await page.locator(SEL.nom).innerText(), 'Camille Martin');
    await page.locator(SEL.evenement).first().locator(SEL.present).click();
    await attendre(async () => (await lignes(page)).filter((l) => l.evt && l.statut === 'présent').length === 1, { message: 'présence non enregistrée' });
    await attendre(async () => (await comptes(page, 'Le Transmedia'))[0] === 1);
  });

  test('colonnes de la première version (Email jamais calculée) : recréées toutes seules, une seule fois', async () => {
    const page = await ouvrir({ requete: '?declencheur-casse&ambigu' });
    assert.equal(await page.locator(SEL.nom).innerText(), 'Camille Martin');
    assert.equal(await page.locator(SEL.etat).innerText(), '');
    const lots = await actions(page);
    const reparation = lots.find((l) => l[0][0] === 'RemoveColumn');
    assert.deepEqual(reparation.map((a) => a.slice(0, 3)), [['RemoveColumn', 'Participations', 'Utilisateur'], ['RemoveColumn', 'Participations', 'Email'], ['AddColumn', 'Participations', 'Email'], ['AddColumn', 'Participations', 'Utilisateur']]);
    assert.equal(reparation[2][3].recalcWhen, 0);
    assert.equal(lots.filter((l) => l[0][0] === 'AddRecord').length, 2, 'une ligne de connexion avant, une après la réparation');
    assert.equal((await lignes(page)).filter((l) => !l.evt).length, 0);
  });

  test('même après réparation, la formule ne donne rien : message avec la raison', async () => {
    const page = await ouvrir({ requete: '?declencheur-casse&sans-declencheur&ambigu' });
    assert.match(await page.locator(SEL.etat).textContent(), /Impossible de vous reconnaître \(adresse de connexion vide\)/);
  });

  test('structure non modifiable : une seule tentative, message clair, lecture seule', async () => {
    const page = await ouvrir({ largeur: 390, hauteur: 844, requete: '?sans-colonnes&sans-droits' });
    assert.match(await page.locator(SEL.etat).innerText(), /pas encore prêt à enregistrer les présences/);
    assert.match(await page.locator(SEL.etat).textContent(), /Il manque les colonnes Evenement, Statut dans la table « Participations »/);
    assert.equal(await page.locator('button[data-action="choisir"]').count(), 0);
    assert.equal((await actions(page)).filter((l) => l[0][0] === 'AddColumn').length, 1);
  });
});

describe('erreurs d\'écriture', () => {
  test('refus par les règles d\'accès : le choix revient en arrière, message explicite', async () => {
    const page = await ouvrir({ requete: '?ecriture-refusee' });
    const c = page.locator(SEL.evenement).first();
    await c.locator(SEL.present).click();
    await texteAttendu(page, SEL.toast, /refusé par les règles d’accès/);
    await attendre(async () => (await c.locator(SEL.present).getAttribute('aria-pressed')) === 'false');
  });

  test('écriture acceptée mais ligne absente ensuite : annulé, avec la raison', async () => {
    const page = await ouvrir({ requete: '?ecriture-perdue' });
    const c = page.locator(SEL.evenement).first();
    await c.locator(SEL.present).click();
    await texteAttendu(page, SEL.toast, /n’a pas pu être enregistré \(la ligne n’apparaît pas dans « Participations » après l’écriture\)/);
    await attendre(async () => (await c.locator(SEL.present).getAttribute('aria-pressed')) === 'false');
  });

  test('ligne écrite sans « Utilisateur » : message précis', async () => {
    const page = await ouvrir({ requete: '?utilisateur-vide' });
    await page.locator(SEL.evenement).first().locator(SEL.present).click();
    await texteAttendu(page, SEL.toast, /ligne écrite sans « Utilisateur »/);
  });
});
