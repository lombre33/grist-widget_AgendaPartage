/* Outils pour piloter un vrai Grist local (voir serveur.sh) : API REST, création d'un document de test
   avec la même structure que celui d'Antoine (Annuaire, Etablissement, Evenements, Participations). */
const GRIST = process.env.GRIST_URL || 'http://127.0.0.1:8484';
const WIDGET = process.env.WIDGET_URL || 'http://127.0.0.1:8765/index.html';
const PROPRIETAIRE = 'antoine.philippon@u-bordeaux.fr';

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

/** Contexte de navigateur connecté à Grist comme cette personne ; le script grist-plugin-api.js est pris sur le Grist local (pas d'accès à Internet nécessaire). */
async function contexteNavigateur(navigateur, utilisateur, options = {}) {
  const contexte = await navigateur.newContext({ viewport: { width: 1300, height: 900 }, ...options });
  await connecter(contexte, utilisateur);
  const script = await (await fetch(`${GRIST}/grist-plugin-api.js`)).text();
  await contexte.route('https://docs.getgrist.com/grist-plugin-api.js', (r) => r.fulfill({ contentType: 'text/javascript', body: script }));
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

module.exports = { GRIST, WIDGET, PROPRIETAIRE, session, api, connecter, contexteNavigateur, appliquer, lignes, partager };
