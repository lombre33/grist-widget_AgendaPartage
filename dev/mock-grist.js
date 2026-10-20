/* Faux Grist pour tester le widget dans un simple navigateur (voir dev/index.html).
   Il imite uniquement la partie de grist-plugin-api.js utilisée par widget.js,
   avec la même structure de tables que le document Grist (Annuaire, Etablissement, Evenements, Presences).
   Ne sert qu'au développement : il n'est jamais chargé par index.html.

   Options d'URL :  ?moi=2          se connecter comme la personne n° 2 (1 par défaut)
                    ?restreint      l'Annuaire ne montre que sa propre ligne (au lieu de masquer les e-mails des autres)
                    ?ambigu         tous les e-mails de l'Annuaire sont lisibles : personne n'est reconnu
                    ?anonyme        aucun e-mail lisible : personne non reconnue
                    ?vide           démarrer sans aucune présence */
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
  const logoDe = (p) => (ETABLISSEMENTS.find((e) => e.nom_de_domaine === p.nom_de_domaine) || {}).Logo || '';

  // --- Table Presences : colonnes réelles volontairement différentes des noms du widget ------
  const COLONNES_REELLES = { evenement: 'Evt', utilisateur: 'Personne', statut: 'Statut', nom: 'Nom', prenom: 'Prenom', logo: 'Logo' };
  let prochainId = 1;
  let presences = [];
  const ligne = (evt, personneId, statut) => {
    const p = parId(personneId);
    return { id: prochainId++, Evt: evt, Personne: personneId, Statut: statut, Nom: p.nom, Prenom: p.prenom, Logo: logoDe(p) };
  };
  if (!params.has('vide')) {
    // [événement, personne, statut] — « sûr » et « probable » (ancienne version du widget) restent lus
    const demo = [[1, 3, 'sûr'], [1, 4, 'probable'], [2, 5, 'présent'], [5, 2, 'présent'], [5, 6, 'présent'], [5, 7, 'à confirmer'], [5, 8, 'présent'], [5, 3, 'à confirmer'],
      [7, 5, 'présent'], [9, 1, 'présent'], [9, 5, 'présent'], [9, 8, 'présent'], [9, 4, 'à confirmer'], [9, 6, 'présent'], [9, 7, 'présent'], [17, 6, 'présent'], [19, 2, 'à confirmer'],
      [19, 5, 'présent'], [21, 3, 'présent'], [22, 8, 'présent'], [26, 4, 'présent'], [26, 6, 'présent'], [26, 7, 'présent'], [26, 3, 'présent'], [26, 8, 'à confirmer'],
      [7, moiId, 'à confirmer']];
    demo.forEach(([e, p, s]) => presences.push(ligne(e, p, s)));
  }

  // --- Ce que Grist renvoie pour l'Annuaire selon les règles d'accès --------------------------
  function annuaireVisible() {
    if (params.has('restreint')) return [parId(moiId)];
    return ANNUAIRE.map((p) => {
      const lisible = params.has('ambigu') || (p.id === moiId && !params.has('anonyme'));
      return lisible ? p : { ...p, email: ['C'] };   // ['C'] : cellule masquée par les règles d'accès
    });
  }

  // --- API simulée ---------------------------------------------------------------------------
  const attendre = (ms = 150) => new Promise((r) => setTimeout(r, ms));
  let rappel = null;
  let associations = null;
  const notifier = () => setTimeout(() => rappel && rappel(presences.map((p) => ({ ...p })), associations), 120);
  const enColonnes = (lignes) => {
    const colonnes = Object.keys(lignes[0] || { id: 0 });
    return Object.fromEntries(colonnes.map((c) => [c, lignes.map((l) => l[c])]));
  };

  window.grist = {
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
          const p = parId(fields.Personne);
          presences.push({ id: prochainId++, Nom: p.nom, Prenom: p.prenom, Logo: logoDe(p), ...fields });
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
        if (nom === 'Evenements') return enColonnes(window.MOCK_EVENEMENTS);
        if (nom === 'Annuaire') return enColonnes(annuaireVisible());
        if (nom === 'Etablissement') return enColonnes(ETABLISSEMENTS);
        throw new Error(`Table inconnue : ${nom}`);
      },
      async getAccessToken() { return { token: 'faux', baseUrl: 'https://exemple.invalid/api/docs/x', ttlMsecs: 600000 }; },
    },
  };

  // --- Petite barre de test : simuler le comportement des autres participants -----------------
  window.addEventListener('DOMContentLoaded', () => {
    const barre = document.createElement('div');
    barre.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;gap:8px;align-items:center;padding:6px 12px;background:#222;color:#fff;font:12px Arial';
    barre.innerHTML = '<span>Faux Grist</span><button id="simuler" style="font:inherit">Un autre participant bouge</button><span id="simuler-info" style="opacity:.7"></span>';
    document.body.appendChild(barre);
    document.body.style.paddingBottom = '56px';
    document.getElementById('simuler').addEventListener('click', () => {
      const autres = ANNUAIRE.filter((p) => p.id !== moiId);
      const p = autres[Math.floor(Math.random() * autres.length)];
      const evt = 1 + Math.floor(Math.random() * window.MOCK_EVENEMENTS.length);
      const existante = presences.find((l) => l.Evt === evt && l.Personne === p.id);
      if (existante) presences = presences.filter((l) => l !== existante);
      else presences.push(ligne(evt, p.id, Math.random() < 0.6 ? 'présent' : 'à confirmer'));
      document.getElementById('simuler-info').textContent = `${p.prenom} ${existante ? 'se retire de' : 'ajoute'} l’événement ${evt}`;
      notifier();
    });
  });
})();
