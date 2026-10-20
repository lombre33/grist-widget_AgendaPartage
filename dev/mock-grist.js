/* Faux Grist pour tester le widget dans un simple navigateur (voir dev/index.html).
   Il imite uniquement la partie de grist-plugin-api.js utilisée par widget.js,
   avec la même structure de tables que le document Grist (Annuaire, Etablissement, Evenements).
   Les présences sont dans l'Annuaire, comme dans le vrai document : deux colonnes « liste de références ».
   Ne sert qu'au développement : il n'est jamais chargé par index.html.

   Options d'URL :  ?moi=2          se connecter comme la personne n° 2 (1 par défaut)
                    ?restreint      l'Annuaire ne montre que sa propre ligne (au lieu de masquer les e-mails des autres)
                    ?ambigu         tous les e-mails de l'Annuaire sont lisibles : personne n'est reconnu
                    ?anonyme        personne non connectée à Grist (e-mail de connexion vide, aucun e-mail lisible)
                    ?inconnu        connecté avec une adresse absente de l'Annuaire
                    ?sans-declencheur  la formule « à la création » (user.Email) ne donne rien : le widget se rabat sur l'e-mail lisible
                    ?sans-ajout     les règles d'accès interdisent d'ajouter une ligne dans Participations
                    ?sans-colonnes  l'Annuaire n'a pas encore les colonnes de présence : le widget doit les créer
                    ?sans-droits    ... mais la structure du document n'est pas modifiable par cette personne
                    ?ecriture-refusee  les règles d'accès refusent toute modification de l'Annuaire
                    ?vide           démarrer sans aucune présence

   Pour les tests : window.MOCK_ACTIONS liste les lots d'actions reçus par applyUserActions. */
(function () {
  const params = new URLSearchParams(location.search);

  // --- Établissements (faux logos : pastilles colorées générées ici) -----------------------
  const pastille = (lettres, fond) =>
    'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="${fond}"/>` +
      `<text x="20" y="26" font-family="Arial" font-size="15" font-weight="700" text-anchor="middle" fill="#fff">${lettres}</text></svg>`);
  const ETABLISSEMENTS = [
    { id: 1, Nom_complet: 'Université de Bordeaux', Acronyme: 'UB', Logo: pastille('UB', '#a51140'), nom_de_domaine: 'u-bordeaux.fr' },
    { id: 2, Nom_complet: 'Bordeaux INP', Acronyme: 'INP', Logo: pastille('INP', '#0b6e99'), nom_de_domaine: 'bordeaux-inp.fr' },
    { id: 3, Nom_complet: 'Université Bordeaux Montaigne', Acronyme: 'BM', Logo: pastille('BM', '#2e7d32'), nom_de_domaine: 'u-bordeaux-montaigne.fr' },
    { id: 4, Nom_complet: 'Sciences Po Bordeaux', Acronyme: 'SP', Logo: pastille('SP', '#e65100'), nom_de_domaine: 'sciencespo-bordeaux.fr' },
    { id: 5, Nom_complet: 'INRAE', Acronyme: 'IN', Logo: pastille('IN', '#00695c'), nom_de_domaine: 'inrae.fr' },
  ];

  // --- Annuaire ------------------------------------------------------------------------------
  const personne = (id, prenom, nom, domaine, etablissement) =>
    ({ id, prenom, nom, email: `${prenom}.${nom}@${domaine}`.toLowerCase(), Etablissement: etablissement, nom_de_domaine: domaine });
  const ANNUAIRE = [
    personne(1, 'Camille', 'Martin', 'u-bordeaux.fr', 'Université de Bordeaux'),
    personne(2, 'Karim', 'Benali', 'bordeaux-inp.fr', 'Bordeaux INP'),
    personne(3, 'Léa', 'Dupont', 'u-bordeaux-montaigne.fr', 'Université Bordeaux Montaigne'),
    personne(4, 'Hugo', 'Leroy', 'sciencespo-bordeaux.fr', 'Sciences Po Bordeaux'),
    personne(5, 'Inès', 'Moreau', 'inrae.fr', 'INRAE'),
    personne(6, 'Paul', 'Garcia', 'u-bordeaux.fr', 'Université de Bordeaux'),
    personne(7, 'Sophie', 'Roux', 'exemple.org', 'Association locale'),   // aucun logo : initiales
    personne(8, 'Yanis', 'Fabre', 'bordeaux-inp.fr', 'Bordeaux INP'),
  ];
  const moiId = Number(params.get('moi')) || 1;
  const parId = (id) => ANNUAIRE.find((p) => p.id === id);

  // --- Présences : deux colonnes de l'Annuaire (listes d'identifiants d'événements) --------------
  const COL_SUR = 'Evenements_presents';
  const COL_PROBABLE = 'Evenements_a_confirmer';
  const colonnes = params.has('sans-colonnes') ? [] : [COL_SUR, COL_PROBABLE];
  const listes = new Map();   // identifiant de personne -> { sur: [...], probable: [...] }
  const listesDe = (id) => { if (!listes.has(id)) listes.set(id, { sur: [], probable: [] }); return listes.get(id); };
  const retirerEvt = (id, evt) => { const l = listesDe(id); l.sur = l.sur.filter((x) => x !== evt); l.probable = l.probable.filter((x) => x !== evt); };
  const ajouterEvt = (id, evt, statut) => { retirerEvt(id, evt); listesDe(id)[statut].push(evt); };
  if (!params.has('vide') && !params.has('sans-colonnes')) {
    // [événement, personne, statut]
    const demo = [[1, 3, 'sur'], [1, 4, 'probable'], [2, 5, 'sur'], [5, 2, 'sur'], [5, 6, 'sur'], [5, 7, 'probable'], [5, 8, 'sur'], [5, 3, 'probable'],
      [7, 5, 'sur'], [9, 1, 'sur'], [9, 5, 'sur'], [9, 8, 'sur'], [9, 4, 'probable'], [9, 6, 'sur'], [9, 7, 'sur'], [17, 6, 'sur'], [19, 2, 'probable'],
      [19, 5, 'sur'], [21, 3, 'sur'], [22, 8, 'sur'], [26, 4, 'sur'], [26, 6, 'sur'], [26, 7, 'sur'], [26, 3, 'sur'], [26, 8, 'probable'],
      [7, moiId, 'probable']];
    demo.forEach(([e, p, s]) => ajouterEvt(p, e, s));
  }
  // Ce que renvoie Grist : liste encodée ['L', ...] ou, quand elle est vide, null (les deux formes sont lues par le widget)
  const enListe = (ids, id) => (ids.length ? (id % 2 ? ['L', ...ids] : [...ids]) : null);

  // --- Participations : table vide qui sert de support au widget (colonnes A, B, C par défaut) -----
  const emailConnecte = params.has('anonyme') ? '' : params.has('inconnu') ? 'quelquun@exemple.org' : parId(moiId).email;
  const colonnesParticipations = ['A', 'B', 'C'];
  const infosColonnes = {};
  let participations = [];
  let prochaineParticipation = 1;
  // Formule « Utilisateur » : la personne de l'Annuaire qui a l'e-mail de connexion
  const personneDe = (mail) => (ANNUAIRE.find((p) => mail && p.email.toLowerCase() === mail.toLowerCase()) || { id: 0 }).id;

  // --- Ce que Grist renvoie pour l'Annuaire selon les règles d'accès --------------------------
  function annuaireVisible() {
    const avecPresences = (p) => ({
      ...p,
      ...(colonnes.includes(COL_SUR) ? { [COL_SUR]: enListe(listesDe(p.id).sur, p.id) } : {}),
      ...(colonnes.includes(COL_PROBABLE) ? { [COL_PROBABLE]: enListe(listesDe(p.id).probable, p.id) } : {}),
    });
    if (params.has('restreint')) return [avecPresences(parId(moiId))];
    return ANNUAIRE.map((p) => {
      const lisible = params.has('ambigu') || (p.id === moiId && !params.has('anonyme'));
      return avecPresences(lisible ? p : { ...p, email: ['C'] });   // ['C'] : cellule masquée par les règles d'accès
    });
  }

  // --- API simulée ---------------------------------------------------------------------------
  const attendre = (ms = 150) => new Promise((r) => setTimeout(r, ms));
  const enColonnes = (lignes, cols = Object.keys(lignes[0] || { id: 0 })) =>
    Object.fromEntries(cols.map((c) => [c, lignes.map((l) => l[c])]));
  window.MOCK_ACTIONS = [];
  window.MOCK_COLONNES = infosColonnes;   // définitions des colonnes créées dans Participations

  window.grist = {
    simule: true,
    ready(options) {
      console.info('[faux Grist] ready', options);
    },
    docApi: {
      async fetchTable(nom) {
        await attendre(40);
        if (nom === 'Evenements') return enColonnes(window.MOCK_EVENEMENTS);
        if (nom === 'Annuaire') return enColonnes(annuaireVisible(), ['id', 'prenom', 'nom', 'email', 'Etablissement', 'nom_de_domaine', ...colonnes]);
        if (nom === 'Etablissement') return enColonnes(ETABLISSEMENTS);
        if (nom === 'Participations') return enColonnes(participations, ['id', ...colonnesParticipations]);
        throw new Error(`Table inconnue : ${nom}`);
      },
      async applyUserActions(actions) {
        await attendre();
        window.MOCK_ACTIONS.push(JSON.parse(JSON.stringify(actions)));
        const retValues = [];
        for (const [type, table, ...args] of actions) {
          retValues.push(null);
          if (type === 'AddColumn' && params.has('sans-droits')) throw new Error('Blocked by table structure access rules');
          if (table === 'Participations') {
            if (type === 'AddColumn') {
              colonnesParticipations.push(args[0]);
              infosColonnes[args[0]] = args[1];
            } else if (type === 'AddRecord') {
              if (params.has('sans-ajout')) throw new Error('Blocked by table create access rules');
              const email = params.has('sans-declencheur') ? '' : emailConnecte;
              const ligne = { id: prochaineParticipation++, Email: email, Utilisateur: personneDe(email) };
              participations.push(ligne);
              retValues[retValues.length - 1] = ligne.id;
            } else if (type === 'RemoveRecord') {
              participations = participations.filter((l) => l.id !== args[0]);
            } else {
              throw new Error(`Action inconnue : ${type}`);
            }
            continue;
          }
          if (table !== 'Annuaire') throw new Error(`Table inconnue : ${table}`);
          if (type === 'AddColumn') {
            if (!colonnes.includes(args[0])) colonnes.push(args[0]);
          } else if (type === 'UpdateRecord') {
            const [id, champs] = args;
            if (params.has('ecriture-refusee') || id !== moiId) throw new Error('Blocked by table update access rules');
            for (const [col, valeur] of Object.entries(champs)) {
              if (!colonnes.includes(col)) throw new Error(`Colonne inconnue : ${col}`);
              const ids = (Array.isArray(valeur) ? valeur.filter((x) => x !== 'L') : []);
              listesDe(id)[col === COL_SUR ? 'sur' : 'probable'] = ids;
            }
          } else {
            throw new Error(`Action inconnue : ${type}`);
          }
        }
        return { retValues };
      },
      async getAccessToken() { return { token: 'faux', baseUrl: 'https://exemple.invalid/api/docs/x', ttlMsecs: 600000 }; },
    },
  };

  // --- Petite barre de test : simuler le comportement des autres participants -----------------
  window.addEventListener('DOMContentLoaded', () => {
    const barre = document.createElement('div');
    barre.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;gap:8px;align-items:center;padding:6px 12px;background:#222;color:#fff;font:12px Arial';
    barre.innerHTML = '<span>Faux Grist</span><button id="simuler" style="font:inherit">Un autre participant bouge</button><span id="simuler-info" style="opacity:.7">(visible dans les 5 s)</span>';
    document.body.appendChild(barre);
    document.body.style.paddingBottom = '56px';
    document.getElementById('simuler').addEventListener('click', () => {
      const autres = ANNUAIRE.filter((p) => p.id !== moiId);
      const p = autres[Math.floor(Math.random() * autres.length)];
      const evt = 1 + Math.floor(Math.random() * window.MOCK_EVENEMENTS.length);
      const l = listesDe(p.id);
      const existante = l.sur.includes(evt) || l.probable.includes(evt);
      if (existante) retirerEvt(p.id, evt);
      else ajouterEvt(p.id, evt, Math.random() < 0.6 ? 'sur' : 'probable');
      document.getElementById('simuler-info').textContent = `${p.prenom} ${existante ? 'se retire de' : 'ajoute'} l’événement ${evt}`;
    });
  });
})();
