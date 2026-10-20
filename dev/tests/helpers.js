/* Outils communs aux tests : serveur de fichiers du dépôt, navigateur Playwright, attente d'une condition.
   Les tests sont lancés par `node --test dev/tests/` (Node 22 ; Playwright doit être installé : `npm install --no-save playwright`). */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.resolve(__dirname, '../..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};

function playwright() {
  for (const nom of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(nom); } catch { /* essai suivant */ }
  }
  throw new Error('Playwright est introuvable : npm install --no-save playwright');
}

function executableChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const dossier = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    const choix = fs.readdirSync(dossier).filter((n) => n.startsWith('chromium-')).sort().reverse()[0];
    const chemin = choix && path.join(dossier, choix, 'chrome-linux', 'chrome');
    return chemin && fs.existsSync(chemin) ? chemin : undefined;
  } catch { return undefined; }
}

/** Sert les fichiers du dépôt (le widget) sur un port libre. */
function serveur() {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let chemin = path.join(RACINE, decodeURIComponent(url.pathname));
    if (!chemin.startsWith(RACINE)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(chemin) && fs.statSync(chemin).isDirectory()) chemin = path.join(chemin, 'index.html');
    fs.readFile(chemin, (err, contenu) => {
      if (err) { res.writeHead(404).end('introuvable'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(chemin)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(contenu);
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    resolve({ url: `http://127.0.0.1:${port}`, port, fermer: () => new Promise((ok) => srv.close(ok)) });
  }));
}

const lancerNavigateur = () => playwright().chromium.launch({ executablePath: executableChromium(), args: ['--no-sandbox'] });

/** Attend qu'une condition (fonction, éventuellement asynchrone) devienne vraie ; renvoie sa valeur. */
async function attendre(condition, { delai = 15000, pas = 100, message = 'condition non remplie' } = {}) {
  const fin = Date.now() + delai;
  let derniere;
  for (;;) {
    try { derniere = await condition(); if (derniere) return derniere; } catch (err) { derniere = err; }
    if (Date.now() > fin) throw new Error(`${message}${derniere instanceof Error ? ` (${derniere.message})` : ''}`);
    await new Promise((r) => setTimeout(r, pas));
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sélecteurs de l'interface (à adapter ici si le HTML du widget change). */
const SEL = {
  evenement: '.evt', resume: '.evt__resume', present: 'button[data-valeur="sur"]', aConfirmer: 'button[data-valeur="probable"]',
  toast: '#toast', etat: '#etat', moi: '.moi', nom: '.moi > span:not(.avatar)', filtre: '#filtre', ligneParticipants: '.evt__qui', liste: '.liste-qui', detail: '[id^="detail-"]',
  jourActif: '.jour--actif', onglet: '.onglet', pied: '#version', lieu: 'a.evt__carte',
  personne: '.evt__personne', info: '.evt__info', infos: '[id^="infos-"]',
};

/** Erreurs de console attendues dans certains scénarios (échecs simulés) : on ne les compte pas comme des anomalies. */
const ERREURS_ATTENDUES = /Blocked by table|n’apparaît pas|ligne écrite sans|Reconnaissance par la table|Création des colonnes|Cannot read properties of undefined|Failed to load resource|ERR_TUNNEL|RPC_ONCALL|Unexpected token/;

/**
 * Ouvre le widget dans un contexte neuf. `erreurs` recueille les erreurs JavaScript et de console inattendues.
 * `ouvrirFaux` charge dev/index.html (faux Grist, options dans `requete`, ex. '?ambigu&moi=2').
 */
async function ouvrirFaux(navigateur, base, { largeur = 1400, hauteur = 900, requete = '' } = {}) {
  const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur } });
  const page = await contexte.newPage();
  page.erreurs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !ERREURS_ATTENDUES.test(m.text())) page.erreurs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => page.erreurs.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/dev/index.html${requete}`);
  await page.waitForSelector(SEL.evenement);
  await attendre(() => page.evaluate(() => window.MOCK_ACTIONS !== undefined && document.querySelector('#version').textContent.includes('ligne')), { message: 'le widget n\'a pas fini de charger' });
  return page;
}

module.exports = { RACINE, playwright, serveur, lancerNavigateur, attendre, pause, SEL, ERREURS_ATTENDUES, ouvrirFaux };
