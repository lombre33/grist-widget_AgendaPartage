/* Tests unitaires des fonctions pures de widget.js, appelées dans le navigateur (elles sont globales dans la page de dev/). */
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { serveur, lancerNavigateur } = require('./helpers');

let srv; let navigateur; let page;
before(async () => {
  srv = await serveur();
  navigateur = await lancerNavigateur();
  page = await navigateur.newPage();
  await page.goto(`${srv.url}/dev/index.html`);
  await page.waitForSelector('.evt');
});
after(async () => { await navigateur.close(); await srv.fermer(); });

/** Appelle une fonction (ou lit une constante) de widget.js. */
const f = (nom, ...args) => page.evaluate(([n, a]) => { const v = (0, eval)(n); return typeof v === 'function' ? v(...a) : v; }, [nom, args]);
const NBSP = '\u00a0';

describe('lecture des valeurs Grist', () => {
  test('texte : vide pour null, undefined et cellules masquées ([\'C\']), sinon la valeur rognée', async () => {
    assert.equal(await f('texte', null), '');
    assert.equal(await f('texte', undefined), '');
    assert.equal(await f('texte', ['C']), '');
    assert.equal(await f('texte', ['L', 1]), '');
    assert.equal(await f('texte', '  bonjour  '), 'bonjour');
    assert.equal(await f('texte', 12), '12');
    assert.equal(await f('texte', 0), '0');
    assert.equal(await f('texte', false), 'false');
  });

  test('echapper : neutralise le HTML', async () => {
    assert.equal(await f('echapper', '<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    assert.equal(await f('echapper', `l'été & l'hiver`), 'l&#39;été &amp; l&#39;hiver');
    assert.equal(await f('echapper', null), '');
  });

  test('sansAccent : minuscules sans accents', async () => {
    assert.equal(await f('sansAccent', 'Université Bordeaux Montaigne'), 'universite bordeaux montaigne');
    assert.equal(await f('sansAccent', 'À CONFIRMER'), 'a confirmer');
    assert.equal(await f('sansAccent', null), '');
  });

  test('idLigne : nombre, texte, { tableId, rowId } (onRecords), valeur encodée [\'R\', table, n] ; 0 sinon', async () => {
    for (const [valeur, attendu] of [
      [5, 5], ['7', 7], [{ tableId: 'Annuaire', rowId: 3 }, 3], [{ tableId: 'Annuaire', rowId: '9' }, 9], [['R', 'Annuaire', 4], 4],
      [0, 0], [null, 0], [undefined, 0], ['', 0], ['abc', 0], [{}, 0], [{ tableId: 'Annuaire', rowId: 0 }, 0], [['C'], 0], [NaN, 0], [true, 1],
    ]) assert.equal(await f('idLigne', valeur), attendu, JSON.stringify(valeur));
  });

  test('liste : tableau simple, liste encodée [\'L\', …], sinon vide', async () => {
    assert.deepEqual(await f('liste', ['L', 1, 2]), [1, 2]);
    assert.deepEqual(await f('liste', [1, 2]), [1, 2]);
    assert.deepEqual(await f('liste', null), []);
    assert.deepEqual(await f('liste', 'x'), []);
    assert.deepEqual(await f('liste', ['L']), []);
  });

  test('urlSure : seulement http(s)', async () => {
    assert.equal(await f('urlSure', 'https://www.u-bordeaux.fr/x'), 'https://www.u-bordeaux.fr/x');
    assert.equal(await f('urlSure', ' http://exemple.org '), 'http://exemple.org');
    assert.equal(await f('urlSure', 'javascript:alert(1)'), '');
    assert.equal(await f('urlSure', 'data:text/html,<b>'), '');
    assert.equal(await f('urlSure', '//exemple.org'), '');
    assert.equal(await f('urlSure', null), '');
  });

  test('codeStatut : les libellés actuels et les anciennes valeurs', async () => {
    for (const v of ['présent', 'Présent', 'PRESENT', 'présente', 'sûr', 'sur', 'Sûr']) assert.equal(await f('codeStatut', v), 'sur', v);
    for (const v of ['à confirmer', 'À confirmer', 'a confirmer', 'probable', 'Probable']) assert.equal(await f('codeStatut', v), 'probable', v);
    for (const v of ['', null, undefined, 'peut-être', 'absent', ['C']]) assert.equal(await f('codeStatut', v), null, String(v));
  });
});

describe('dates et heures', () => {
  test('versIso : secondes Grist (minuit UTC ou minuit à Paris), objet Date, texte', async () => {
    assert.equal(await f('versIso', Date.UTC(2026, 10, 23) / 1000), '2026-11-23');
    assert.equal(await f('versIso', Date.UTC(2026, 10, 22, 23) / 1000), '2026-11-23');   // minuit du 23, heure de Paris
    assert.equal(await f('versIso', '2026-11-27'), '2026-11-27');
    assert.equal(await f('versIso', '2026-11-27T00:00:00Z'), '2026-11-27');
    assert.equal(await f('versIso', '23/11/2026'), '2026-11-23');
    assert.equal(await f('versIso', '3/1/2027'), '2027-01-03');
    for (const v of ['', null, 'demain', ['C']]) assert.equal(await f('versIso', v), '', String(v));
  });

  test('versIso : un objet Date', async () => {
    assert.equal(await page.evaluate(() => versIso(new Date(Date.UTC(2026, 10, 24)))), '2026-11-24');
  });

  test('versHeure : « 09:30 », « 9h30 », « 9 h », « 14H15 », fraction de jour', async () => {
    assert.deepEqual(await f('versHeure', '09:30'), { h: 9, m: 30 });
    assert.deepEqual(await f('versHeure', '9h30'), { h: 9, m: 30 });
    assert.deepEqual(await f('versHeure', '9 h'), { h: 9, m: 0 });
    assert.deepEqual(await f('versHeure', '14H15'), { h: 14, m: 15 });
    assert.deepEqual(await f('versHeure', '18:00'), { h: 18, m: 0 });
    assert.deepEqual(await f('versHeure', 0.5), { h: 12, m: 0 });
    assert.deepEqual(await f('versHeure', 0.3958333333), { h: 9, m: 30 });
    assert.deepEqual(await f('versHeure', 0), { h: 0, m: 0 });
    for (const v of ['', null, 'matin', 1, 25, ['C']]) assert.equal(await f('versHeure', v), null, String(v));
  });

  test('formaterHeure : espaces insécables, minutes sur deux chiffres', async () => {
    assert.equal(await f('formaterHeure', { h: 9, m: 30 }), `9${NBSP}h${NBSP}30`);
    assert.equal(await f('formaterHeure', { h: 14, m: 0 }), `14${NBSP}h`);
    assert.equal(await f('formaterHeure', { h: 9, m: 5 }), `9${NBSP}h${NBSP}05`);
  });

  test('minutesDe : sans heure, après tout le monde', async () => {
    assert.equal(await f('minutesDe', { h: 9, m: 30 }), 570);
    assert.ok((await f('minutesDe', null)) > (await f('minutesDe', { h: 23, m: 59 })));
  });

  test('infosJour : nom, numéro et mois en français', async () => {
    assert.deepEqual(await f('infosJour', '2026-11-23'), { nom: 'lundi', numero: 23, mois: 'novembre' });
    assert.deepEqual(await f('infosJour', '2026-11-27'), { nom: 'vendredi', numero: 27, mois: 'novembre' });
  });
});

describe('événements', () => {
  const ligne = { id: 4, Jour: Date.UTC(2026, 10, 24) / 1000, Debut: '14:00', Fin: '16:00', Titre: '  Atelier  ', Sous_titre: null, Type: 'Atelier', Temps_fort: '', Lieu: 'BU', Ville: 'Talence', Adresse: '1 rue X', Public: 'Tous', Description: 'Texte', Lien: 'javascript:alert(1)' };

  test('normaliserEvenement : nettoie chaque champ', async () => {
    assert.deepEqual(await f('normaliserEvenement', ligne), {
      id: 4, jour: '2026-11-24', debut: { h: 14, m: 0 }, fin: { h: 16, m: 0 }, titre: 'Atelier', sousTitre: '', type: 'Atelier', tempsFort: '',
      lieu: 'BU', ville: 'Talence', adresse: '1 rue X', public: 'Tous', cibles: [], description: 'Texte', lien: '',
    });
  });

  test('normaliserEvenement : colonnes absentes ou masquées', async () => {
    const e = await f('normaliserEvenement', { id: 1, Jour: '2026-11-23', Titre: 'X', Lieu: ['C'] });
    assert.equal(e.lieu, ''); assert.equal(e.debut, null); assert.equal(e.fin, null); assert.equal(e.lien, '');
  });

  test('lireCibles : liste de choix, tableau ou texte ; accents et casse ignorés, valeurs inconnues écartées, ordre des pastilles', async () => {
    assert.deepEqual(await f('lireCibles', ['L', 'Recherche', 'Pédagogie']), ['pedagogie', 'recherche']);
    assert.deepEqual(await f('lireCibles', ['étudiants', 'Entreprises']), ['etudiants', 'entreprises']);
    assert.deepEqual(await f('lireCibles', ['L', 'Personnels', 'Étudiants']), ['etudiants', 'personnels']);
    assert.deepEqual(await f('lireCibles', 'personnel, Recherche'), ['recherche', 'personnels']);
    assert.deepEqual(await f('lireCibles', ['L', 'Personnes']), []);
    assert.deepEqual(await f('lireCibles', 'pedagogie, ETUDIANTS ; Acteurs socio-économiques'), ['pedagogie', 'etudiants', 'entreprises']);
    assert.deepEqual(await f('lireCibles', ['L', 'Grand public', 'Recherche']), ['recherche']);
    for (const vide of [null, undefined, '', ['C'], ['L'], 12]) assert.deepEqual(await f('lireCibles', vide), []);
  });

  test('normaliserEvenement : publics visés lus dans la colonne Cibles', async () => {
    assert.deepEqual((await f('normaliserEvenement', { ...ligne, Cibles: ['L', 'Étudiants', 'Recherche'] })).cibles, ['recherche', 'etudiants']);
  });

  describe('ciblesDesSeances : remplir la colonne Cibles d\'après les plannings', () => {
    const plannings = [
      ['2026-11-23', '09:30', 'Atelier « Durable »', ['Pédagogie', 'Étudiants']],
      ['2026-11-23', '14:00', 'Table ronde', ['Recherche']],
      ['2026-11-24', '09:00', 'CampusIA', ['Pédagogie']],
      ['2026-11-24', '11:30', 'CampusIA', ['Pédagogie', 'Recherche']],
    ];
    const seance = (id, jour, h, m, titre) => ({ id, jour, debut: h == null ? null : { h, m }, titre });
    const trouver = async (evenements) => Object.fromEntries(await page.evaluate(([e, p]) => [...ciblesDesSeances(e, p)], [evenements, plannings]));

    test('jour, début et titre identiques : les publics des plannings', async () => {
      assert.deepEqual(await trouver([seance(1, '2026-11-23', 9, 30, 'Atelier « Durable »'), seance(2, '2026-11-23', 14, 0, 'Table ronde')]),
        { 1: ['Pédagogie', 'Étudiants'], 2: ['Recherche'] });
    });

    test('guillemets, apostrophes, espaces insécables, accents et majuscules du titre ne comptent pas', async () => {
      assert.deepEqual(await trouver([seance(1, '2026-11-23', 9, 30, `  atelier${NBSP}"durable"  `)]), { 1: ['Pédagogie', 'Étudiants'] });
      assert.deepEqual(await trouver([seance(1, '2026-11-23', 9, 30, 'ATELIER  DURABLE')]), { 1: ['Pédagogie', 'Étudiants'] });
    });

    test('heure modifiée ou absente : reconnu au jour et au titre seulement si ce titre est unique ce jour-là', async () => {
      assert.deepEqual(await trouver([seance(1, '2026-11-23', 10, 0, 'Table ronde')]), { 1: ['Recherche'] });
      assert.deepEqual(await trouver([seance(1, '2026-11-23', null, 0, 'Table ronde')]), { 1: ['Recherche'] });
      // deux « CampusIA » le même jour : sans la bonne heure, on ne devine pas
      assert.deepEqual(await trouver([seance(1, '2026-11-24', 10, 0, 'CampusIA'), seance(2, '2026-11-24', 15, 0, 'CampusIA')]), {});
      assert.deepEqual(await trouver([seance(1, '2026-11-24', 9, 0, 'CampusIA'), seance(2, '2026-11-24', 11, 30, 'CampusIA')]), { 1: ['Pédagogie'], 2: ['Pédagogie', 'Recherche'] });
    });

    test('séance inconnue, autre jour ou plannings vides : aucun public', async () => {
      assert.deepEqual(await trouver([seance(1, '2026-11-25', 9, 30, 'Atelier « Durable »'), seance(2, '2026-11-23', 9, 30, 'Autre chose')]), {});
      assert.deepEqual(await page.evaluate(() => [...ciblesDesSeances([{ id: 1, jour: '2026-11-23', debut: null, titre: 'X' }], [])]), []);
      assert.deepEqual(await page.evaluate(() => [...ciblesDesSeances([], window.CIBLES_PLANNING)]), []);
    });

    test('les plannings livrés (cibles-planning.js) donnent exactement la colonne Cibles de l\'Excel pour les 30 séances de dev/evenements.js', async () => {
      const [trouvees, attendues, total] = await page.evaluate(() => {
        const evenements = window.MOCK_EVENEMENTS.map(normaliserEvenement);
        const t = ciblesDesSeances(evenements);
        return [evenements.map((e) => t.get(e.id) || []), window.MOCK_EVENEMENTS.map((e) => (e.Cibles || ['L']).slice(1)), window.CIBLES_PLANNING.length];
      });
      assert.deepEqual(trouvees, attendues);
      assert.equal(total, 30);
    });
  });

  test('lienCarte : adresse, sinon lieu et ville, sinon rien ; caractères encodés', async () => {
    assert.equal(await f('lienCarte', { adresse: '1 rue Éric, 33400 Talence', lieu: 'BU', ville: 'Talence' }), 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('1 rue Éric, 33400 Talence'));
    assert.equal(await f('lienCarte', { adresse: '', lieu: 'Locaux du CATIE', ville: 'Talence' }), 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Locaux du CATIE, Talence'));
    assert.equal(await f('lienCarte', { adresse: '', lieu: 'Locaux du CATIE', ville: '' }), 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Locaux du CATIE'));
    assert.equal(await f('lienCarte', { adresse: '', lieu: '', ville: 'Pessac' }), 'https://www.google.com/maps/search/?api=1&query=Pessac');
    assert.equal(await f('lienCarte', { adresse: '', lieu: '', ville: '' }), '');
    assert.match(await f('lienCarte', { adresse: 'a&b=c#d', lieu: '', ville: '' }), /query=a%26b%3Dc%23d$/);
  });

  test('lignesDeTable : colonnes -> lignes', async () => {
    assert.deepEqual(await f('lignesDeTable', { id: [1, 2], nom: ['a', 'b'] }), [{ id: 1, nom: 'a' }, { id: 2, nom: 'b' }]);
    assert.deepEqual(await f('lignesDeTable', { id: [] }), []);
  });

  test('typo : espaces insécables avant « : ; ! ? » et autour des guillemets français, HTML échappé', async () => {
    assert.equal(await f('typo', 'Quoi : bien ?'), `Quoi${NBSP}: bien${NBSP}?`);
    assert.equal(await f('typo', '« Bonjour »'), `«${NBSP}Bonjour${NBSP}»`);
    assert.equal(await f('typo', '<b>x</b> !'), `&lt;b&gt;x&lt;/b&gt;${NBSP}!`);
  });

  test('nombre : singulier jusqu\'à 1, pluriel au-delà', async () => {
    assert.equal(await f('nombre', 0, ['présent', 'présents']), '0 présent');
    assert.equal(await f('nombre', 1, ['présent', 'présents']), '1 présent');
    assert.equal(await f('nombre', 2, ['présent', 'présents']), '2 présents');
  });
});

describe('personnes et logos', () => {
  test('lirePersonnes : e-mail masqué par les règles d\'accès = vide', async () => {
    const gens = await f('lirePersonnes', { id: [1, 2], prenom: ['Léa', 'Hugo'], nom: ['Dupont', 'Leroy'], email: ['lea@x.fr', ['C']], Etablissement: ['UB', 'INP'], nom_de_domaine: ['x.fr', 'y.fr'] });
    assert.deepEqual(gens.map((p) => [p.id, p.prenom, p.nom, p.email, p.etablissement, p.domaine]), [[1, 'Léa', 'Dupont', 'lea@x.fr', 'UB', 'x.fr'], [2, 'Hugo', 'Leroy', '', 'INP', 'y.fr']]);
  });

  test('nomComplet : prénom et nom, sans espace superflu', async () => {
    assert.equal(await f('nomComplet', { prenom: 'Léa', nom: 'Dupont' }), 'Léa Dupont');
    assert.equal(await f('nomComplet', { prenom: '', nom: 'Dupont' }), 'Dupont');
    assert.equal(await f('nomComplet', { prenom: 'Léa', nom: '' }), 'Léa');
    assert.equal(await f('nomComplet', { prenom: '', nom: '' }), '');
  });

  test('trouverLogo : par nom de domaine d\'abord, puis par nom d\'établissement (sans accents ni casse)', async () => {
    const logo = (personne) => page.evaluate((p) => {
      const avant = etat.logos;
      const fiche = (logo) => ({ cle: logo, nom: logo, acronyme: '', logo });
      etat.logos = { parDomaine: new Map([['u-bordeaux.fr', fiche('LOGO-UB')]]), parNom: new Map([['universite bordeaux montaigne', fiche('LOGO-BM')], ['bordeaux inp', fiche('LOGO-INP')]]) };
      const r = trouverLogo(p);
      etat.logos = avant;
      return r;
    }, personne);
    assert.equal(await logo({ domaine: 'u-bordeaux.fr', etablissement: 'Bordeaux INP' }), 'LOGO-UB');
    assert.equal(await logo({ domaine: 'U-Bordeaux.fr', etablissement: '' }), 'LOGO-UB');
    assert.equal(await logo({ domaine: 'inconnu.org', etablissement: 'Université Bordeaux Montaigne' }), 'LOGO-BM');
    assert.equal(await logo({ domaine: '', etablissement: 'BORDEAUX INP' }), 'LOGO-INP');
    assert.equal(await logo({ domaine: 'inconnu.org', etablissement: 'Association' }), null);
  });

  test('trouverEtablissement : la fiche de l\'établissement (domaine, puis nom), sinon le texte de l\'Annuaire, sinon le domaine', async () => {
    const etab = (personne) => page.evaluate((p) => {
      const avant = etat.logos;
      const ub = { cle: 'u-bordeaux.fr', nom: 'Université de Bordeaux', acronyme: 'UB', logo: null };
      const inp = { cle: 'bordeaux-inp.fr', nom: 'Bordeaux INP', acronyme: 'INP', logo: null };
      etat.logos = { parDomaine: new Map([['u-bordeaux.fr', ub]]), parNom: new Map([['bordeaux inp', inp]]) };
      const r = trouverEtablissement(p);
      etat.logos = avant;
      return r;
    }, personne);
    assert.deepEqual(await etab({ domaine: 'u-bordeaux.fr', etablissement: 'autre' }), { cle: 'u-bordeaux.fr', nom: 'Université de Bordeaux', acronyme: 'UB', logo: null });
    assert.equal((await etab({ domaine: 'inconnu.org', etablissement: 'Bordeaux INP' })).nom, 'Bordeaux INP');
    assert.deepEqual(await etab({ domaine: 'inconnu.org', etablissement: 'Association Café' }), { cle: 'association cafe', nom: 'Association Café', acronyme: '' });
    assert.deepEqual(await etab({ domaine: 'inconnu.org', etablissement: '' }), { cle: 'inconnu.org', nom: 'inconnu.org', acronyme: '' });
  });

  test('groupesDe : un groupe par établissement, les plus nombreux d\'abord (puis par nom), avec le décompte par statut', async () => {
    const groupes = await page.evaluate(() => {
      const e = (nom) => ({ cle: nom.toLowerCase(), nom });
      const g = (n, etab, statut) => ({ nom: n, etab: e(etab), statut, logo: null });
      return groupesDe([g('a', 'Zeta', 'sur'), g('b', 'Alpha', 'probable'), g('c', 'Zeta', 'probable'), g('d', 'Beta', 'sur'), g('e', 'Zeta', 'sur')])
        .map((x) => [x.etab.nom, x.sur, x.probable, x.gens.map((p) => p.nom).join('')]);
    });
    assert.deepEqual(groupes, [['Zeta', 2, 1, 'ace'], ['Alpha', 0, 1, 'b'], ['Beta', 1, 0, 'd']]);
  });

  test('logoSrc : lien web ou data:image, ou pièce jointe Grist avec jeton ; jamais javascript:', async () => {
    assert.equal(await f('logoSrc', 'https://exemple.org/logo.png'), 'https://exemple.org/logo.png');
    assert.equal(await f('logoSrc', ' data:image/svg+xml,abc '), 'data:image/svg+xml,abc');
    assert.equal(await f('logoSrc', 'javascript:alert(1)'), '');
    assert.equal(await f('logoSrc', 'data:text/html,<b>'), '');
    assert.equal(await f('logoSrc', ''), '');
    assert.equal(await f('logoSrc', null), '');
    const piece = (valeur, jeton) => page.evaluate(([v, j]) => { const avant = etat.jeton; etat.jeton = j; const r = logoSrc(v); etat.jeton = avant; return r; }, [valeur, jeton]);
    const jeton = { token: 'a b/c', baseUrl: 'https://grist.exemple/api/docs/abc', expire: Date.now() + 1e6 };
    assert.equal(await piece(['L', 12], jeton), 'https://grist.exemple/api/docs/abc/attachments/12/download?auth=a%20b%2Fc');
    assert.equal(await piece(['L', 12, 13], jeton), 'https://grist.exemple/api/docs/abc/attachments/12/download?auth=a%20b%2Fc');
    assert.equal(await piece(['L', 12], null), '');
    assert.equal(await piece(['L'], jeton), '');
  });
});

describe('présences', () => {
  /** Remplace l'état le temps d'un calcul, puis le remet. */
  const avec = (donnees, calcul) => page.evaluate(([d, c]) => {
    const sauve = { moi: etat.moi, presences: etat.presences, choixEnCours: etat.choixEnCours };
    etat.moi = d.moi; etat.presences = d.presences; etat.choixEnCours = new Map(d.choix || []);
    try { return (0, eval)(c); } finally { Object.assign(etat, sauve); }
  }, [donnees, calcul]);
  const moi = { id: 1, prenom: 'Alix', nom: 'Marchand', logo: null };
  const p = (utilisateur, prenom, nom, evenement, statut) => ({ id: utilisateur * 100 + evenement, evenement, utilisateur, statut, prenom, nom, logo: null });

  test('statutEnregistre : « sur » dès qu\'une de mes lignes l\'est, « probable » sinon, null sans ligne', async () => {
    const presences = [p(1, 'Alix', 'Marchand', 7, 'probable'), p(1, 'Alix', 'Marchand', 7, 'sur'), p(1, 'Alix', 'Marchand', 8, 'probable'), p(2, 'Léa', 'Dupont', 9, 'sur')];
    assert.equal(await avec({ moi, presences }, 'statutEnregistre(7)'), 'sur');
    assert.equal(await avec({ moi, presences }, 'statutEnregistre(8)'), 'probable');
    assert.equal(await avec({ moi, presences }, 'statutEnregistre(9)'), null);   // la ligne d'une autre personne n'est pas la mienne
    assert.equal(await avec({ moi: null, presences }, 'statutEnregistre(7)'), null);
  });

  test('monStatut : mon dernier clic l\'emporte sur ce qui est enregistré, y compris un retrait (null)', async () => {
    const presences = [p(1, 'Alix', 'Marchand', 7, 'sur')];
    assert.equal(await avec({ moi, presences }, 'monStatut(7)'), 'sur');
    assert.equal(await avec({ moi, presences, choix: [[7, { statut: 'probable' }]] }, 'monStatut(7)'), 'probable');
    assert.equal(await avec({ moi, presences, choix: [[7, { statut: null }]] }, 'monStatut(7)'), null);
    assert.equal(await avec({ moi: null, presences, choix: [[7, { statut: 'sur' }]] }, 'monStatut(7)'), null);
  });

  test('participantsDe : présents d\'abord, puis ordre alphabétique des noms de famille ; je figure avec mon choix ; un seul statut par personne', async () => {
    const presences = [
      p(3, 'Zoé', 'Zola', 7, 'sur'), p(2, 'Léa', 'Dupont', 7, 'probable'), p(4, 'Hugo', 'Leroy', 7, 'sur'),
      p(2, 'Léa', 'Dupont', 9, 'sur'),                                                 // autre événement
      p(5, 'Inès', 'Moreau', 7, 'probable'), p(5, 'Inès', 'Moreau', 7, 'sur'),         // doublon : « présent » gagne
      p(6, 'Paul', 'Garcia', 7, 'sur'), p(6, 'Paul', 'Garcia', 7, 'probable'),
      p(1, 'Alix', 'Marchand', 7, 'probable'),                                     // ma ligne enregistrée : remplacée par mon choix
    ];
    const gens = await avec({ moi, presences, choix: [[7, { statut: 'sur' }]] }, 'participantsDe(7)');
    assert.deepEqual(gens.map((g) => [`${g.prenom} ${g.nom}`, g.statut, g.moi]), [
      ['Alix Marchand', 'sur', true], ['Paul Garcia', 'sur', false], ['Hugo Leroy', 'sur', false], ['Inès Moreau', 'sur', false], ['Zoé Zola', 'sur', false], ['Léa Dupont', 'probable', false],
    ]);
    assert.deepEqual((await avec({ moi, presences }, 'participantsDe(9)')).map((g) => g.prenom), ['Léa']);
    assert.deepEqual(await avec({ moi, presences }, 'participantsDe(99)'), []);
  });

  test('participantsDe : sans moi (personne non reconnue), seules les lignes des autres', async () => {
    const gens = await avec({ moi: null, presences: [p(2, 'Léa', 'Dupont', 7, 'sur')] }, 'participantsDe(7)');
    assert.deepEqual(gens.map((g) => [g.prenom, g.moi]), [['Léa', false]]);
  });
});

describe('configuration', () => {
  test('la formule de la colonne « Utilisateur » rapproche l\'e-mail de connexion de l\'Annuaire sans tenir compte de la casse', async () => {
    const formule = await f('FORMULE_PERSONNE');
    assert.match(formule, /\$Email/);
    assert.match(formule, /Annuaire\.all/);
    assert.match(formule, /\.strip\(\)\.lower\(\)/);
    assert.match(formule, /return next\(/);
  });

  test('les libellés et les statuts sont cohérents', async () => {
    assert.deepEqual(await f('CONFIG.statuts'), { sur: 'présent', probable: 'à confirmer' });
    assert.deepEqual(Object.keys(await f('LIBELLES')), ['sur', 'probable']);
    for (const code of ['sur', 'probable']) assert.equal(await f('codeStatut', (await f('CONFIG.statuts'))[code]), code, 'chaque statut écrit est relu');
  });

  test('index.html : pas de CSP qui empêcherait le script de Grist de s\'exécuter (build eval), pas de script, gestionnaire ni style en ligne', () => {
    const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../index.html'), 'utf8');
    // Le 20/10/2026, une CSP sans 'unsafe-eval' a empêché le script de docs.getgrist.com de s'exécuter : le widget
    // affichait « s'utilise dans Grist » chez Antoine. Une CSP ne peut revenir qu'avec 'unsafe-eval' (ou un script sans eval).
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
    if (csp) {
      const script = csp[1].split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src ')) || csp[1];
      assert.match(script, /'unsafe-eval'/, 'la CSP bloque eval : le script de Grist ne s\'exécute plus');
    }
    assert.ok(!/<script(?![^>]*\bsrc=)/.test(html) && !/\son[a-z]+=/.test(html) && !/\sstyle=/.test(html), 'index.html ne contient ni script, ni gestionnaire, ni style en ligne');
  });

  test('rienAPerdre : les colonnes de connexion vides peuvent être recréées, pas celles qui contiennent des valeurs (même masquées)', async () => {
    assert.equal(await f('rienAPerdre', { Email: ['', ''], Utilisateur: [0, 0] }), true);
    assert.equal(await f('rienAPerdre', {}), true);
    assert.equal(await f('rienAPerdre', { Email: ['', 'a@b.fr'], Utilisateur: [0, 0] }), false);
    assert.equal(await f('rienAPerdre', { Email: ['', ''], Utilisateur: [0, 3] }), false);
    assert.equal(await f('rienAPerdre', { Email: [['C'], ['C']], Utilisateur: [0, 0] }), false, 'valeur masquée par les règles d\'accès : on ne touche à rien');
  });

  test('la version est affichée en bas de page', async () => {
    assert.match(await page.locator('#version').innerText(), new RegExp(`^Version ${(await f('VERSION')).replace('·', '·')}`));
  });
});

describe('inscription automatique : nom, prénom et établissement', () => {
  const noms = (compte, email = 'x@exemple.org') => f('nomsDepuisCompte', compte, email);

  test('nomsDepuisCompte : « Prénom NOM », « NOM Prénom », « Prénom Nom », particules, prénoms composés', async () => {
    assert.deepEqual(await noms('Jean-Pierre DUPONT'), { prenom: 'Jean-Pierre', nom: 'Dupont' });
    assert.deepEqual(await noms('DUPONT Jean'), { prenom: 'Jean', nom: 'Dupont' });
    assert.deepEqual(await noms('Jean Dupont'), { prenom: 'Jean', nom: 'Dupont' });
    assert.deepEqual(await noms('Anne Marie Dupont'), { prenom: 'Anne Marie', nom: 'Dupont' });
    assert.deepEqual(await noms('Marie de la Fontaine'), { prenom: 'Marie', nom: 'de la Fontaine' });
    assert.deepEqual(await noms('Marie DE LA FONTAINE'), { prenom: 'Marie', nom: 'De la Fontaine' });
    assert.deepEqual(await noms('Léa DUPONT-MARTIN'), { prenom: 'Léa', nom: 'Dupont-Martin' });
    assert.deepEqual(await noms('JEAN DUPONT'), { prenom: 'Jean', nom: 'Dupont' });
    assert.deepEqual(await noms('  Jean   Dupont '), { prenom: 'Jean', nom: 'Dupont' });
    assert.deepEqual(await noms('Dupont'), { prenom: '', nom: 'Dupont' });
    assert.deepEqual(await noms('Ève McDonald'), { prenom: 'Ève', nom: 'McDonald' });
  });

  test('nomsDepuisCompte : sans nom de compte, ou quand Grist n\'a mis que l\'adresse, on lit prenom.nom@domaine', async () => {
    assert.deepEqual(await noms('', 'jean.dupont@u-bordeaux.fr'), { prenom: 'Jean', nom: 'Dupont' });
    assert.deepEqual(await noms(null, 'jean-pierre.dupont@u-bordeaux.fr'), { prenom: 'Jean-Pierre', nom: 'Dupont' });
    assert.deepEqual(await noms('jean.dupont', 'jean.dupont@u-bordeaux.fr'), { prenom: 'Jean', nom: 'Dupont' });
    assert.deepEqual(await noms('jean.dupont@u-bordeaux.fr', 'jean.dupont@u-bordeaux.fr'), { prenom: 'Jean', nom: 'Dupont' });
    assert.deepEqual(await noms('', 'jean-dupont@u-bordeaux.fr'), { prenom: 'Jean', nom: 'Dupont' });
    assert.deepEqual(await noms('', 'marie.dupont2@u-bordeaux.fr'), { prenom: 'Marie', nom: 'Dupont' });
    assert.deepEqual(await noms('', 'dupont@u-bordeaux.fr'), { prenom: '', nom: 'Dupont' });
    assert.deepEqual(await noms('dupont', 'dupont@u-bordeaux.fr'), { prenom: '', nom: 'Dupont' });
    assert.deepEqual(await noms('c.chatilli', 'c.chatilli@dr15.cnrs.fr'), { prenom: 'C.', nom: 'Chatilli' });
    assert.deepEqual(await noms('Marie.DE.LA.FONTAINE', 'marie.de.la.fontaine@inrae.fr'), { prenom: 'Marie', nom: 'De la Fontaine' });
    assert.deepEqual(await noms('', 'j.dupont@u-bordeaux.fr'), { prenom: 'J.', nom: 'Dupont' });
  });

  test('etablissementPourDomaine : le domaine exact, ou un sous-domaine d\'un établissement ; jamais un domaine qui ne fait que finir pareil', async () => {
    assert.deepEqual(await f('etablissementPourDomaine', 'u-bordeaux.fr'), { nom: 'Université de Bordeaux', domaine: 'u-bordeaux.fr' });
    assert.deepEqual(await f('etablissementPourDomaine', 'etu.u-bordeaux.fr'), { nom: 'Université de Bordeaux', domaine: 'u-bordeaux.fr' });
    assert.deepEqual(await f('etablissementPourDomaine', 'BORDEAUX-INP.fr'), { nom: 'Bordeaux INP', domaine: 'bordeaux-inp.fr' });
    // colonne alt_domain : texte à séparateurs (Bordeaux INP) ou liste de choix (INRAE)
    assert.deepEqual(await f('etablissementPourDomaine', 'enseirb-matmeca.fr'), { nom: 'Bordeaux INP', domaine: 'enseirb-matmeca.fr' });
    assert.deepEqual(await f('etablissementPourDomaine', 'etu.ensc.fr'), { nom: 'Bordeaux INP', domaine: 'ensc.fr' });
    assert.deepEqual(await f('etablissementPourDomaine', 'irstea.fr'), { nom: 'INRAE', domaine: 'irstea.fr' });
    assert.equal(await f('etablissementPourDomaine', 'autre-u-bordeaux.fr'), null);
    assert.equal(await f('etablissementPourDomaine', 'exemple.org'), null);
    assert.equal(await f('etablissementPourDomaine', 'fr'), null);
    assert.equal(await f('etablissementPourDomaine', ''), null);
  });

  test('identiteDeConnexion : tout ce qu\'écrit l\'inscription automatique', async () => {
    assert.deepEqual(await f('identiteDeConnexion', 'jean-pierre.dupont@etu.u-bordeaux.fr', 'Jean-Pierre DUPONT'),
      { prenom: 'Jean-Pierre', nom: 'Dupont', etablissement: 'Université de Bordeaux', domaine: 'u-bordeaux.fr' });
    assert.deepEqual(await f('identiteDeConnexion', 'sam.roux@asso.example', 'Sam Roux'),
      { prenom: 'Sam', nom: 'Roux', etablissement: '', domaine: 'asso.example' });
  });
});

describe('établissements à plusieurs noms de domaine (colonne alt_domain)', () => {
  test('domainesEtablissement : texte à séparateurs, liste de choix, colonne vide ou absente', async () => {
    assert.deepEqual(await f('domainesEtablissement', { nom_de_domaine: 'A-B.fr', alt_domain: 'x.fr, y.fr;z.fr\nw.fr' }), ['a-b.fr', 'x.fr', 'y.fr', 'z.fr', 'w.fr']);
    assert.deepEqual(await f('domainesEtablissement', { nom_de_domaine: 'a.fr', alt_domain: ['L', 'x.fr', 'Y.fr'] }), ['a.fr', 'x.fr', 'y.fr']);
    assert.deepEqual(await f('domainesEtablissement', { nom_de_domaine: 'a.fr', alt_domain: '' }), ['a.fr']);
    assert.deepEqual(await f('domainesEtablissement', { nom_de_domaine: 'a.fr' }), ['a.fr']);
    assert.deepEqual(await f('domainesEtablissement', { nom_de_domaine: 'a.fr', alt_domain: ['C'] }), ['a.fr']);
    assert.deepEqual(await f('domainesEtablissement', { nom_de_domaine: 'a.fr', alt_domain: '@b.fr' }), ['a.fr', 'b.fr']);
  });

  test('une personne dont le domaine est un autre nom de domaine de l\'établissement a son logo et son établissement', async () => {
    const logo = await f('trouverLogo', { domaine: 'enseirb-matmeca.fr', etablissement: '' });
    assert.match(logo, /^data:image\/svg/);
    assert.equal(logo, await f('trouverLogo', { domaine: 'bordeaux-inp.fr', etablissement: '' }));
    assert.equal((await f('trouverEtablissement', { domaine: 'irstea.fr', etablissement: '' })).nom, 'INRAE');
    assert.equal((await f('trouverEtablissement', { domaine: 'irstea.fr', etablissement: '' })).cle, (await f('trouverEtablissement', { domaine: 'inrae.fr', etablissement: '' })).cle, 'même groupe que le domaine principal');
  });
});

describe('visiteurs anonymes et page de connexion', () => {
  test('estAnonyme : l\'adresse que Grist donne à qui n\'est pas connecté, sans tenir compte de la casse ni des espaces', async () => {
    for (const email of ['anon@getgrist.com', ' ANON@getgrist.com ']) assert.equal(await f('estAnonyme', email), true, email);
    for (const email of ['', null, undefined, 'jeanne.delmas@u-bordeaux.fr', 'anon@exemple.org', 'anon@getgrist.com.fr']) assert.equal(await f('estAnonyme', email), false, String(email));
  });

  test('chercherAdresseConnexion : la page de connexion de Grist d\'après l\'adresse de l\'API du document, avec retour sur le document', async () => {
    const cas = await page.evaluate(async () => {
      const vrai = grist.docApi.getAccessToken;
      const retourInitial = CONFIG.connexion.retour;
      const avec = async (baseUrl, retour = '') => {
        grist.docApi.getAccessToken = async () => ({ token: 't', baseUrl, ttlMsecs: 1000 });
        CONFIG.connexion.retour = retour;
        return chercherAdresseConnexion();
      };
      try {
        const r = {
          saas: await avec('https://docs.getgrist.com/api/docs/abc123'),
          equipe: await avec('https://docs.getgrist.com/o/mon-equipe/api/docs/abc123'),
          retour: await avec('https://docs.getgrist.com/api/docs/abc123', '/{doc}/Planning/p/4?style=singlePage'),
          retourEquipe: await avec('https://grist.numerique.gouv.fr/o/pui-bordeaux/api/docs/h13zaBFF4FQJ', '/{doc}/Planning/p/4?style=singlePage'),
          inattendue: await avec('https://docs.getgrist.com/autre/chose'),
          protocole: await avec('javascript:alert(1)//api/docs/x'),
        };
        grist.docApi.getAccessToken = async () => { throw new Error('refus'); };
        r.erreur = await chercherAdresseConnexion();
        return r;
      } finally { grist.docApi.getAccessToken = vrai; CONFIG.connexion.retour = retourInitial; }
    });
    assert.deepEqual(cas, {
      saas: 'https://docs.getgrist.com/login?next=%2Fabc123',
      equipe: 'https://docs.getgrist.com/o/mon-equipe/login?next=%2Fabc123',
      retour: 'https://docs.getgrist.com/login?next=%2Fabc123%2FPlanning%2Fp%2F4%3Fstyle%3DsinglePage',
      retourEquipe: 'https://grist.numerique.gouv.fr/o/pui-bordeaux/login?next=%2Fh13zaBFF4FQJ%2FPlanning%2Fp%2F4%3Fstyle%3DsinglePage',
      inattendue: '',
      protocole: '',
      erreur: '',
    });
  });
});
