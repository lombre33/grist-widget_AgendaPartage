/* Outils pour piloter un vrai Grist local (voir serveur.sh) : API REST, création d'un document de test
   avec la même structure que celui d'Antoine (Annuaire, Etablissement, Evenements, Participations). */
const GRIST = process.env.GRIST_URL || 'http://127.0.0.1:8484';
const WIDGET = process.env.WIDGET_URL || 'http://127.0.0.1:8765/index.html';
const PROPRIETAIRE = 'alix.marchand@u-bordeaux.fr';

const sessions = new Map();

/** Ouvre une session Grist au nom d'une adresse e-mail (connexion « forward auth » : l'en-tête X-Forwarded-User suffit). */
async function session(utilisateur) {
  if (!sessions.has(utilisateur)) {
    const reponse = await fetch(`${GRIST}/auth/login?next=/`, { redirect: 'manual', headers: { 'X-Forwarded-User': utilisateur } });
    const cookie = reponse.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('grist_core='));
    if (!cookie) throw new Error(`connexion impossible pour ${utilisateur} (${reponse.status})`);
    sessions.set(utilisateur, cookie);
  }
  return sessions.get(utilisateur);
}

/** Appel de l'API REST de Grist, au nom d'une adresse e-mail. */
async function api(utilisateur, methode, chemin, corps) {
  const reponse = await fetch(`${GRIST}/api${chemin}`, {
    method: methode,
    headers: { Cookie: await session(utilisateur), 'X-Requested-With': 'XMLHttpRequest', ...(corps === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  if (!reponse.ok) throw new Error(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 300)}`);
  return texte ? JSON.parse(texte) : null;
}

/** Connecte un contexte de navigateur Playwright comme cette personne (le cookie sert aussi au WebSocket de Grist). */
async function connecter(contexte, utilisateur) {
  await contexte.addCookies([{ name: 'grist_core', value: decodeURIComponent((await session(utilisateur)).split('=').slice(1).join('=')), url: GRIST }]);
}

/**
 * Contexte de navigateur connecté à Grist comme cette personne ; le script grist-plugin-api.js est pris sur le Grist local
 * (pas d'accès à Internet nécessaire). Par défaut il est servi en « build eval » (tout le script passé à eval) : le script de
 * docs.getgrist.com est de ce type, et une politique de sécurité sans 'unsafe-eval' l'empêcherait de s'exécuter
 * (le widget affichait alors « s'utilise dans Grist »). Avec { apiEval: false } on sert le script tel quel.
 */
async function contexteNavigateur(navigateur, utilisateur, { apiEval = true, scriptApi, formulaire = false, sansCorrection = false, ...options } = {}) {
  const contexte = await navigateur.newContext({ viewport: { width: 1300, height: 900 }, ...options });
  if (utilisateur) await connecter(contexte, utilisateur);   // sans adresse : personne anonyme (document ouvert à tout le monde)
  const brut = scriptApi || await (await fetch(`${GRIST}/grist-plugin-api.js`)).text();
  const script = apiEval && !scriptApi ? `eval(${JSON.stringify(brut)});` : brut;   // { scriptApi } : texte à servir tel quel (par exemple le vrai script)
  await contexte.route('https://docs.getgrist.com/grist-plugin-api.js', (r) => r.fulfill({ contentType: 'text/javascript', body: script }));
  if (formulaire || sansCorrection) {   // réglages de CONFIG changés à la volée, dans la copie de widget.js que charge ce navigateur
    await contexte.route(/\/widget\.js(\?.*)?$/, async (r) => {
      const reponse = await r.fetch();
      let corps = await reponse.text();
      if (formulaire) corps = corps.replace("inscription: 'automatique'", "inscription: 'formulaire'");   // { formulaire } : la fenêtre à la place de l'inscription « automatique »
      if (sansCorrection) corps = corps.replace('corrigerPlanning: true', 'corrigerPlanning: false');   // { sansCorrection } : le widget ne corrige pas les cellules de Evenements
      await r.fulfill({ response: reponse, body: corps });
    });
  }
  return contexte;
}

/** Applique des actions utilisateur (AddTable, AddRecord, UpdateRecord…) ; renvoie les valeurs de retour. */
const appliquer = async (utilisateur, doc, actions) => (await api(utilisateur, 'POST', `/docs/${doc}/apply`, actions)).retValues;

/** Lit une table (en colonnes, comme fetchTable du widget) ; les lignes sont [{id, ...colonnes}] */
async function lignes(utilisateur, doc, table) {
  const { records } = await api(utilisateur, 'GET', `/docs/${doc}/tables/${table}/records`);
  return records.map((r) => ({ id: r.id, ...r.fields }));
}

/** Donne un rôle (« editors », « viewers », « owners ») à une adresse e-mail sur le document. */
const partager = (doc, email, role) => api(PROPRIETAIRE, 'PATCH', `/docs/${doc}/access`, { delta: { users: { [email]: role } } });

/** Le vrai script servi par docs.getgrist.com, ou null si ce site n'est pas joignable (par exemple derrière un pare-feu). */
let vraiScript;
async function scriptApiReel() {
  if (vraiScript === undefined) {
    vraiScript = await fetch('https://docs.getgrist.com/grist-plugin-api.js', { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.text() : null), () => null);
  }
  return vraiScript;
}

module.exports = { scriptApiReel, GRIST, WIDGET, PROPRIETAIRE, session, api, connecter, contexteNavigateur, appliquer, lignes, partager };
