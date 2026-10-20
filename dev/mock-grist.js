/* Faux Grist pour tester le widget dans un simple navigateur (voir dev/index.html).
   Il imite uniquement la partie de grist-plugin-api.js utilisée par widget.js,
   avec la même structure de tables que le document Grist (Annuaire, Etablissement, Evenements, Participations).
   Les présences sont dans Participations (une ligne par présence) et arrivent en direct, comme dans Grist
   (onRecords rend les références sous la forme { tableId, rowId }, fetchTable sous celle de simples numéros).
   Ne sert qu'au développement : il n'est jamais chargé par index.html.

   Options d'URL :  ?moi=2          se connecter comme la personne n° 2 (1 par défaut)
                    ?restreint      l'Annuaire ne montre que sa propre ligne (au lieu de masquer les e-mails des autres)
                    ?ambigu         tous les e-mails de l'Annuaire sont lisibles (cas réel) : la connexion seule doit suffire
                    ?anonyme        personne non connectée à Grist (e-mail de connexion vide, aucun e-mail lisible)
                    ?inconnu        connecté avec une adresse absente de l'Annuaire
                    ?public         document ouvert à tout le monde : l'Annuaire et l'écriture dans Participations sont fermés à qui n'y figure pas
                                    (à combiner avec ?anonyme ou ?inconnu) ; il reste la table des demandes d'ajout
                    ?sans-demandes  la table Demandes_Annuaire n'existe pas encore (le widget la crée) ; avec ?sans-droits il n'y arrive pas
                    ?demande-refusee  l'enregistrement d'une demande d'ajout échoue
                    ?demande-faite  la personne a déjà fait sa demande d'ajout
                    ?sans-declencheur  la formule « à la création » (user.Email) ne donne rien : le widget se rabat sur l'e-mail lisible
                    ?declencheur-casse  Email et Utilisateur existent déjà mais ont été créées avec recalcWhen 1 (jamais calculées) : le widget doit les recréer
                    ?sans-ajout     les règles d'accès interdisent d'ajouter une ligne dans Participations
                    ?sans-colonnes  Participations n'a pas encore ses colonnes : le widget doit les créer
                    ?sans-droits    ... mais la structure du document n'est pas modifiable par cette personne
                    ?ecriture-refusee  les règles d'accès refusent d'enregistrer, modifier ou supprimer une présence
                    ?ecriture-perdue   Grist accepte l'écriture d'une présence mais la ligne n'existe pas ensuite
                    ?utilisateur-vide  la ligne d'une présence est écrite sans « Utilisateur » (la formule « à la création » ne donne rien)
                    ?doublons       deux lignes à mon nom pour l'événement 3 (« à confirmer » et « présent »)
                    ?orphelines     deux lignes de connexion restées dans Participations (la sienne et celle d'une autre personne)
                    ?sans-cibles    la table Evenements n'a pas la colonne Cibles (le filtre « Pour qui ? » n'apparaît pas)
                    ?sans-personnels  la colonne Cibles ne contient que les quatre publics des plannings (aucune séance « Personnels »)
                    ?vide           démarrer sans aucune présence
                    ?foule          60 personnes de plus inscrites à l'événement 3 (liste longue, groupée par établissement)

   Pour les tests : window.MOCK_ACTIONS liste les lots d'actions reçus par applyUserActions. Toute action sur
   l'Annuaire est refusée : le widget ne doit pas y écrire (l'attribut utilisateur « acl » recharge le document). */
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
  if (params.has('foule')) {   // 60 personnes de plus, toutes inscrites à l'événement 3 : pour voir la liste groupée par établissement
    for (let i = 9; i <= 68; i++) {
      const e = ETABLISSEMENTS[i % ETABLISSEMENTS.length];
      ANNUAIRE.push(personne(i, `Prénom${i}`, `Nom${i}`, e.nom_de_domaine, e.Nom_complet));
    }
  }

  // --- Participations : une ligne par présence + les lignes de connexion éphémères du widget -------
  const emailConnecte = params.has('anonyme') ? '' : params.has('inconnu') ? 'quelquun@exemple.org' : parId(moiId).email;
  const tout = !params.has('sans-colonnes') && !params.has('declencheur-casse');
  const colonnesParticipations = ['A', 'B', 'C'];   // colonnes par défaut d'une table Grist neuve
  const infosColonnes = {};
  if (tout) {
    colonnesParticipations.push('Email', 'Utilisateur', 'Evenement', 'Statut');
    infosColonnes.Email = { recalcWhen: 0 };
  } else if (params.has('declencheur-casse')) {   // état du vrai document après la première version : recalcWhen 1 = jamais calculée à la création
    colonnesParticipations.push('Email', 'Utilisateur');
    infosColonnes.Email = { recalcWhen: 1 };
  }
  let participations = [];
  let prochaineParticipation = 1;
  // Formule « Utilisateur » : la personne de l'Annuaire qui a l'e-mail de connexion
  const personneDe = (mail) => (ANNUAIRE.find((p) => mail && p.email.toLowerCase() === mail.toLowerCase()) || { id: 0 }).id;
  const ajouterPresence = (personneId, evenement, statut) =>
    participations.push({ id: prochaineParticipation++, Email: parId(personneId).email, Utilisateur: personneId, Evenement: evenement, Statut: statut });
  if (tout && !params.has('vide')) {
    // [événement, personne, statut] : « sûr » et « probable » (anciennes valeurs) restent lus
    const demo = [[1, 3, 'sûr'], [1, 4, 'probable'], [2, 5, 'présent'], [5, 2, 'présent'], [5, 6, 'présent'], [5, 7, 'à confirmer'], [5, 8, 'présent'], [5, 3, 'à confirmer'],
      [7, 5, 'présent'], [9, 1, 'présent'], [9, 5, 'présent'], [9, 8, 'présent'], [9, 4, 'à confirmer'], [9, 6, 'présent'], [9, 7, 'présent'], [17, 6, 'présent'], [19, 2, 'à confirmer'],
      [19, 5, 'présent'], [21, 3, 'présent'], [22, 8, 'présent'], [26, 4, 'présent'], [26, 6, 'présent'], [26, 7, 'présent'], [26, 3, 'présent'], [26, 8, 'à confirmer'],
      [7, moiId, 'à confirmer']];
    demo.forEach(([e, p, st]) => ajouterPresence(p, e, st));
    if (params.has('foule')) ANNUAIRE.filter((p) => p.id >= 9).forEach((p) => ajouterPresence(p.id, 3, p.id % 5 ? 'présent' : 'à confirmer'));
  }

  // Lignes de connexion restées là (page fermée avant leur suppression) : sans événement ni statut
  if (tout && params.has('orphelines')) for (const autre of [moiId, moiId === 2 ? 3 : 2]) {
    participations.push({ id: prochaineParticipation++, Email: parId(autre).email, Utilisateur: autre, Evenement: 0, Statut: '' });
  }

  // Doublons : deux lignes à mon nom pour un même événement (un double clic d'une ancienne version)
  if (tout && params.has('doublons')) for (const statut of ['à confirmer', 'présent']) ajouterPresence(moiId, 3, statut);

  // --- Demandes d'ajout à l'Annuaire : la personne ne voit que les siennes (comme les règles recommandées du README) ---------
  let demandeCreee = !params.has('sans-demandes');
  let demandes = [];
  let prochaineDemande = 1;
  if (params.has('demande-faite')) demandes.push({ id: prochaineDemande++, Nom: 'Quelquun', Prenom: 'Un', Email_saisi: 'quelquun@exemple.org', Etablissement: 'Association locale', Email: emailConnecte, Date: 1792400000 });
  // Document ouvert à tout le monde : qui n'est pas dans l'Annuaire n'y lit rien et n'écrit pas dans Participations
  const fermeAuxInconnus = () => params.has('public') && !(ANNUAIRE.find((p) => emailConnecte && p.email.toLowerCase() === emailConnecte.toLowerCase()));

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
  const enColonnes = (lignes, cols = Object.keys(lignes[0] || { id: 0 })) =>
    Object.fromEntries(cols.map((c) => [c, lignes.map((l) => l[c])]));
  window.MOCK_ACTIONS = [];
  window.MOCK_COLONNES = infosColonnes;   // définitions des colonnes créées dans Participations
  let rappel = null;
  // Dans onRecords (contrairement à fetchTable), Grist rend une référence sous la forme { tableId, rowId }
  const reference = (tableId, rowId) => (rowId ? { tableId, rowId } : 0);
  const enregistrements = () => participations.map(({ ...l }) => (fermeAuxInconnus() ? (delete l.Email, delete l.Utilisateur, l) : l)).map((l) => ({ ...l, Utilisateur: reference('Annuaire', l.Utilisateur), Evenement: reference('Evenements', l.Evenement) }));
  const notifier = () => setTimeout(() => rappel && rappel(enregistrements(), null), 120);
  const estMienne = (ligne) => (ligne.Email || '').toLowerCase() === emailConnecte.toLowerCase();

  window.grist = {
    simule: true,
    ready(options) {
      console.info('[faux Grist] ready', options);
      notifier();
    },
    onRecords(cb, options) {
      console.info('[faux Grist] onRecords', options);
      rappel = cb;
    },
    docApi: {
      async fetchTable(nom) {
        await attendre(40);
        if (nom === 'Evenements') {
          const t = enColonnes(window.MOCK_EVENEMENTS);
          if (params.has('sans-cibles')) delete t.Cibles;
          if (params.has('sans-personnels')) t.Cibles = t.Cibles.map((v) => { const l = (v || []).slice(1).filter((x) => x !== 'Personnels'); return l.length ? ['L', ...l] : null; });
          return t;
        }
        if (nom === 'Annuaire' && fermeAuxInconnus()) throw new Error('Blocked by table read access rules');
        if (nom === 'Demandes_Annuaire') {
          if (!demandeCreee) throw new Error(`Table inconnue : ${nom}`);
          return enColonnes(demandes.filter((l) => emailConnecte && l.Email === emailConnecte), ['id', 'Nom', 'Prenom', 'Email_saisi', 'Etablissement', 'Email', 'Date']);
        }
        if (nom === 'Annuaire') return enColonnes(annuaireVisible(), ['id', 'prenom', 'nom', 'email', 'Etablissement', 'nom_de_domaine']);
        if (nom === 'Etablissement') return enColonnes(ETABLISSEMENTS);
        if (nom === 'Participations') return enColonnes(participations, ['id', ...colonnesParticipations.filter((c) => !(fermeAuxInconnus() && ['Email', 'Utilisateur'].includes(c)))]);
        throw new Error(`Table inconnue : ${nom}`);
      },
      async applyUserActions(actions) {
        await attendre();
        window.MOCK_ACTIONS.push(JSON.parse(JSON.stringify(actions)));
        const retValues = [];
        for (const [type, table, ...args] of actions) {
          retValues.push(null);
          if (table === 'Annuaire') throw new Error('Le widget ne doit pas écrire dans l’Annuaire (attribut utilisateur : rechargement du document)');
          if (table === 'Demandes_Annuaire') {
            if (type === 'AddTable') {
              if (params.has('sans-droits')) throw new Error('Blocked by table structure access rules');
              demandeCreee = true;
              retValues[retValues.length - 1] = { table_id: 'Demandes_Annuaire' };
            } else if (type === 'AddRecord') {
              const valeurs = args[1] || {};
              if (!demandeCreee) throw new Error(`Table inconnue : ${table}`);
              if (!emailConnecte || params.has('demande-refusee') && valeurs.Nom) throw new Error('Blocked by table create access rules');
              const ligne = { id: prochaineDemande++, Email: emailConnecte, Date: Math.floor(Date.now() / 1000), ...valeurs };
              demandes.push(ligne);
              retValues[retValues.length - 1] = ligne.id;
            } else if (type === 'RemoveRecord') {
              demandes = demandes.filter((l) => l.id !== args[0]);
            }
            continue;
          }
          if (table !== 'Participations') throw new Error(`Table inconnue : ${table}`);
          if ((type === 'AddColumn' || type === 'RemoveColumn') && (params.has('sans-droits') || fermeAuxInconnus())) throw new Error('Blocked by table structure access rules');
          if (type === 'AddColumn') {
            colonnesParticipations.push(args[0]);
            infosColonnes[args[0]] = args[1];
          } else if (type === 'RemoveColumn') {
            colonnesParticipations.splice(colonnesParticipations.indexOf(args[0]), 1);
            delete infosColonnes[args[0]];
            participations.forEach((l) => delete l[args[0]]);
          } else if (type === 'AddRecord') {
            const valeurs = args[1] || {};
            if (fermeAuxInconnus()) throw new Error('Blocked by table create access rules');
            if (params.has('sans-ajout') || (params.has('ecriture-refusee') && 'Evenement' in valeurs)) throw new Error('Blocked by table create access rules');
            for (const col of Object.keys(valeurs)) if (!colonnesParticipations.includes(col)) throw new Error(`Colonne inconnue : ${col}`);
            // comme Grist : une colonne « recalcWhen 1 » n'est pas calculée à la création de la ligne
            const declenche = !params.has('sans-declencheur') && colonnesParticipations.includes('Email') && (infosColonnes.Email || {}).recalcWhen !== 1;
            const email = declenche ? emailConnecte : '';
            const ligne = { id: prochaineParticipation++, Email: email, Utilisateur: personneDe(email), ...valeurs };
            if (params.has('utilisateur-vide') && 'Evenement' in valeurs) ligne.Utilisateur = 0;
            if (!(params.has('ecriture-perdue') && 'Evenement' in valeurs)) participations.push(ligne);
            retValues[retValues.length - 1] = ligne.id;
            notifier();
          } else if (type === 'UpdateRecord') {
            const [id, champs] = args;
            const ligne = participations.find((l) => l.id === id);
            if (params.has('ecriture-refusee') || !ligne || !estMienne(ligne)) throw new Error('Blocked by table update access rules');
            Object.assign(ligne, champs);
            notifier();
          } else if (type === 'BulkRemoveRecord' || type === 'RemoveRecord') {
            const ids = [].concat(args[0]);
            const lignes = participations.filter((l) => ids.includes(l.id));
            if (type === 'BulkRemoveRecord' && (params.has('ecriture-refusee') || lignes.some((l) => !estMienne(l)))) throw new Error('Blocked by table delete access rules');
            participations = participations.filter((l) => !ids.includes(l.id));
            notifier();
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
    if (window.MOCK_SANS_BARRE) return;   // maquettes : pas de barre de test
    const barre = document.createElement('div');
    barre.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;gap:8px;align-items:center;padding:6px 12px;background:#222;color:#fff;font:12px Arial';
    barre.innerHTML = '<span>Faux Grist</span><button id="simuler" style="font:inherit">Un autre participant bouge</button><span id="simuler-info" style="opacity:.7"></span>';
    document.body.appendChild(barre);
    document.body.style.paddingBottom = '56px';
    document.getElementById('simuler').addEventListener('click', () => {
      const autres = ANNUAIRE.filter((p) => p.id !== moiId);
      const p = autres[Math.floor(Math.random() * autres.length)];
      const evt = 1 + Math.floor(Math.random() * window.MOCK_EVENEMENTS.length);
      const existante = participations.find((l) => l.Evenement === evt && l.Utilisateur === p.id);
      if (existante) participations = participations.filter((l) => l !== existante);
      else ajouterPresence(p.id, evt, Math.random() < 0.6 ? 'présent' : 'à confirmer');
      document.getElementById('simuler-info').textContent = `${p.prenom} ${existante ? 'se retire de' : 'ajoute'} l’événement ${evt}`;
      notifier();
    });
  });
})();
