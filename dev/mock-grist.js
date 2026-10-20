/* Faux Grist pour tester le widget dans un simple navigateur (voir dev/index.html).
   Il imite uniquement la partie de grist-plugin-api.js utilisée par widget.js.
   Ne sert qu'au développement : il n'est jamais chargé par index.html.

   Options d'URL :  ?moi=2          se connecter comme l'utilisateur n° 2 (1 par défaut)
                    ?anonyme        simuler une personne non reconnue
                    ?vide           démarrer sans aucune présence */
(function () {
  const params = new URLSearchParams(location.search);

  // --- Personnes (faux logos : pastilles colorées générées ici) ---------------------------
  const pastille = (lettres, fond) =>
    'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="${fond}"/>` +
      `<text x="20" y="26" font-family="Arial" font-size="15" font-weight="700" text-anchor="middle" fill="#fff">${lettres}</text></svg>`);
  const LOGOS = { ub: pastille('UB', '#a51140'), inp: pastille('INP', '#0b6e99'), bm: pastille('BM', '#2e7d32'), sp: pastille('SP', '#e65100'), inrae: pastille('IN', '#00695c') };
  const UTILISATEURS = [
    { id: 1, Email: 'camille.martin@exemple.fr', Nom: 'Martin', Prenom: 'Camille', Logo: LOGOS.ub },
    { id: 2, Email: 'karim.benali@exemple.fr', Nom: 'Benali', Prenom: 'Karim', Logo: LOGOS.inp },
    { id: 3, Email: 'lea.dupont@exemple.fr', Nom: 'Dupont', Prenom: 'Léa', Logo: LOGOS.bm },
    { id: 4, Email: 'hugo.leroy@exemple.fr', Nom: 'Leroy', Prenom: 'Hugo', Logo: LOGOS.sp },
    { id: 5, Email: 'ines.moreau@exemple.fr', Nom: 'Moreau', Prenom: 'Inès', Logo: LOGOS.inrae },
    { id: 6, Email: 'paul.garcia@exemple.fr', Nom: 'Garcia', Prenom: 'Paul', Logo: LOGOS.ub },
    { id: 7, Email: 'sophie.roux@exemple.fr', Nom: 'Roux', Prenom: 'Sophie', Logo: '' },
    { id: 8, Email: 'yanis.fabre@exemple.fr', Nom: 'Fabre', Prenom: 'Yanis', Logo: LOGOS.inp },
  ];
  const moiId = Number(params.get('moi')) || 1;
  const parId = (id) => UTILISATEURS.find((u) => u.id === id);

  // --- Table Presences : colonnes réelles volontairement différentes des noms du widget ------
  const COLONNES_REELLES = { evenement: 'Evt', utilisateur: 'Personne', statut: 'Statut', nom: 'Nom', prenom: 'Prenom', logo: 'Logo' };
  let prochainId = 1;
  let presences = [];
  const ajouter = (evt, utilisateur, statut) => {
    const u = parId(utilisateur);
    presences.push({ id: prochainId++, Evt: evt, Personne: utilisateur, Statut: statut, Nom: u.Nom, Prenom: u.Prenom, Logo: u.Logo });
  };
  if (!params.has('vide')) {
    const demo = [[1, 3, 'sûr'], [1, 4, 'probable'], [2, 5, 'sûr'], [5, 2, 'sûr'], [5, 6, 'sûr'], [5, 7, 'probable'], [5, 8, 'sûr'], [5, 3, 'probable'],
      [7, 5, 'sûr'], [9, 1, 'sûr'], [9, 5, 'sûr'], [9, 8, 'sûr'], [9, 4, 'probable'], [9, 6, 'sûr'], [9, 7, 'sûr'], [17, 6, 'sûr'], [19, 2, 'probable'],
      [19, 5, 'sûr'], [21, 3, 'sûr'], [22, 8, 'sûr'], [26, 4, 'sûr'], [26, 6, 'sûr'], [26, 7, 'sûr'], [26, 3, 'sûr'], [26, 8, 'probable']];
    demo.forEach(([e, u, s]) => ajouter(e, u, s));
    ajouter(7, moiId, 'probable');
  }

  // --- API simulée ---------------------------------------------------------------------------
  let rappel = null;
  let associations = null;
  const notifier = () => setTimeout(() => rappel && rappel(presences.map((p) => ({ ...p })), associations), 120);

  const grist = {
    simule: true,
    ready(options) {
      associations = {};
      (options.columns || []).forEach((c) => { associations[c.name] = COLONNES_REELLES[c.name]; });
      console.info('[faux Grist] ready', options);
      notifier();
    },
    onRecords(cb) { rappel = cb; },
    mapColumnNames(enregistrements) {
      if (!associations) return null;
      const traduire = (r) => {
        const sortie = { id: r.id };
        for (const [logique, reel] of Object.entries(associations)) sortie[logique] = r[reel];
        return sortie;
      };
      return Array.isArray(enregistrements) ? enregistrements.map(traduire) : traduire(enregistrements);
    },
    mapColumnNamesBack(champs) {
      return Object.fromEntries(Object.entries(champs).map(([k, v]) => [associations[k] || k, v]));
    },
    getTable() {
      return {
        async create({ fields }) {
          await attendre();
          const u = parId(fields.Personne);
          presences.push({ id: prochainId++, Nom: u.Nom, Prenom: u.Prenom, Logo: u.Logo, ...fields });
          notifier();
        },
        async update({ id, fields }) {
          await attendre();
          Object.assign(presences.find((p) => p.id === id), fields);
          notifier();
        },
        async destroy(ids) {
          await attendre();
          presences = presences.filter((p) => ![].concat(ids).includes(p.id));
          notifier();
        },
      };
    },
    docApi: {
      async fetchTable(nom) {
        await attendre(40);
        let lignes;
        if (nom === 'Evenements') lignes = window.MOCK_EVENEMENTS;
        else if (nom === 'Utilisateurs') lignes = params.has('anonyme') ? [] : [parId(moiId)];
        else throw new Error(`Table inconnue : ${nom}`);
        const colonnes = Object.keys(lignes[0] || { id: 0 });
        return Object.fromEntries(colonnes.map((c) => [c, lignes.map((l) => l[c])]));
      },
      async getAccessToken() { return { token: 'faux', baseUrl: 'https://exemple.invalid/api/docs/x', ttlMsecs: 600000 }; },
    },
  };
  const attendre = (ms = 150) => new Promise((r) => setTimeout(r, ms));
  window.grist = grist;

  // --- Petite barre de test : simuler le comportement des autres participants -----------------
  window.addEventListener('DOMContentLoaded', () => {
    const barre = document.createElement('div');
    barre.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;gap:8px;align-items:center;padding:6px 12px;background:#222;color:#fff;font:12px Arial';
    barre.innerHTML = '<span>Faux Grist</span><button id="simuler" style="font:inherit">Un autre participant bouge</button><span id="simuler-info" style="opacity:.7"></span>';
    document.body.appendChild(barre);
    document.body.style.paddingBottom = '56px';
    document.getElementById('simuler').addEventListener('click', () => {
      const autres = UTILISATEURS.filter((u) => u.id !== moiId);
      const u = autres[Math.floor(Math.random() * autres.length)];
      const evt = 1 + Math.floor(Math.random() * window.MOCK_EVENEMENTS.length);
      const existante = presences.find((p) => p.Evt === evt && p.Personne === u.id);
      if (existante) presences = presences.filter((p) => p !== existante);
      else ajouter(evt, u.id, Math.random() < 0.6 ? 'sûr' : 'probable');
      document.getElementById('simuler-info').textContent = `${u.Prenom} ${existante ? 'se retire de' : 'ajoute'} l’événement ${evt}`;
      notifier();
    });
  });
})();
