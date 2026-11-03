/* Compare deux copies du dépôt (par exemple la version en ligne et une branche) : même page de test (faux Grist), mêmes 39 scénarios,
   et le DOM, les actions écrites, la console et le focus doivent être identiques (hors numéro de version). À lancer avant de mettre en ligne
   une modification qui ne doit rien changer pour les personnes qui utilisent déjà le widget.

     git worktree add --detach /tmp/en-ligne <commit en ligne>
     node dev/comparer-versions.js /tmp/en-ligne .

   Les deux copies doivent avoir leur dossier dev/ (faux Grist). Un contrôle utile : ajouter ?variante=… à une des deux adresses doit faire apparaître des différences. */
'use strict';
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path');
const { lancerNavigateur } = require('./tests/helpers');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serveur(racine) {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'); let chemin = path.join(racine, decodeURIComponent(url.pathname));
    if (fs.existsSync(chemin) && fs.statSync(chemin).isDirectory()) chemin = path.join(chemin, 'index.html');
    fs.readFile(chemin, (err, c) => err ? res.writeHead(404).end() : res.writeHead(200, { 'Content-Type': TYPES[path.extname(chemin)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(c));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ port: srv.address().port, fermer: () => srv.close() })));
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const jean = 'inconnu=jean-pierre.dupont@etu.u-bordeaux.fr&nom=Jean-Pierre%20DUPONT';
const SCENARIOS = [
  ['bureau', '', 1400, 900], ['mobile', '', 390, 844], ['petit mobile', '', 320, 640], ['tablette', '', 820, 1000],
  ['ambigu moi=2', '?ambigu&moi=2', 1400, 900], ['restreint', '?restreint', 1400, 900], ['vide', '?vide', 1400, 900], ['foule', '?foule', 1400, 900],
  ['anonyme public', '?public&anonyme', 1400, 900], ['anonyme public mobile', '?public&anonyme', 390, 844], ['anonyme sans fenêtre', '?anonyme', 1400, 900],
  ['inscription auto', `?public&${jean}`, 1400, 900], ['inscription refusée', `?public&${jean}&sans-inscription`, 1400, 900],
  ['inscription sans demandes', `?public&${jean}&sans-demandes`, 1400, 900], ['inscription échec demande', `?public&${jean}&demande-refusee`, 1400, 900],
  ['formulaire', `?public&${jean}&inscription=formulaire`, 1400, 900], ['formulaire mobile', `?public&${jean}&inscription=formulaire`, 390, 844],
  ['demande faite', '?public&inconnu&demande-faite&inscription=formulaire', 1400, 900], ['demande faite auto', '?public&inconnu&demande-faite', 1400, 900],
  ['sans déclencheur', '?sans-declencheur&restreint', 1400, 900], ['déclencheur cassé', '?declencheur-casse', 1400, 900],
  ['sans colonnes', '?sans-colonnes', 1400, 900], ['sans colonnes ni droits', '?sans-colonnes&sans-droits', 1400, 900], ['sans ajout', '?sans-ajout', 1400, 900],
  ['sans cibles', '?sans-cibles', 1400, 900], ['sans cibles ni droits', '?sans-cibles&sans-droits', 1400, 900], ['cibles vides', '?cibles-vides', 1400, 900],
  ['doublons', '?doublons', 1400, 900], ['orphelines', '?orphelines', 1400, 900], ['utilisateur vide', '?utilisateur-vide', 1400, 900],
  ['inconnu non public', '?inconnu', 1400, 900], ['annuaire fermé', '?public&inconnu&sans-demandes&sans-droits', 1400, 900],
];
const ACTIONS = [  // interactions après chargement : [nom, fonction]
  ['détail ouvert', async (p) => { await p.locator('.evt__qui').first().click(); await p.locator('.evt__info').first().click().catch(() => {}); }],
  ['clic Présent puis À confirmer puis retrait', async (p) => {
    const e = p.locator('.evt').nth(2);
    await e.locator('button[data-valeur="sur"]').click(); await pause(900);
    await e.locator('button[data-valeur="probable"]').click(); await pause(900);
    await e.locator('button[data-valeur="probable"]').click(); await pause(900);
  }],
  ['Mon programme + filtre public', async (p) => {
    await p.locator('.evt').nth(0).locator('button[data-valeur="sur"]').click(); await pause(900);
    await p.locator('#filtre').click(); await pause(200);
    const b = p.locator('.bulle').first(); if (await b.count()) { await b.click(); await pause(200); }
  }],
  ['écriture refusée', async (p) => { await p.locator('.evt').nth(1).locator('button[data-valeur="sur"]').click(); await pause(900); }],
];
async function capturer(navigateur, base, requete, largeur, hauteur, action) {
  const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur } });
  const page = await contexte.newPage();
  const journal = [];
  page.on('console', (m) => journal.push(`${m.type()}: ${m.text()}`)); page.on('pageerror', (e) => journal.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/dev/index.html${requete}`);
  await pause(2800);   // le temps de charger, de s'inscrire et de se recharger
  if (action) await action(page);
  await pause(600);
  const r = await page.evaluate(() => ({
    html: document.documentElement.outerHTML.replace(/Version [^<]*?·\s*[a-z]\b/g, 'Version X').replace(/\?v=\d+v/g, ''),
    histo: JSON.stringify(window.MOCK_HISTORIQUE || null), actions: JSON.stringify(window.MOCK_ACTIONS || null),
    focus: document.activeElement && document.activeElement.outerHTML.slice(0, 120),
  }));
  await contexte.close();
  return { ...r, journal: journal.join('\n').replace(/\d+\.\d+ms/g, '').replace(/http:\/\/127\.0\.0\.1:\d+/g, 'H').replace(/:\d+:\d+/g, ':L') };
}
(async () => {
  const [a, b] = await Promise.all([serveur(path.resolve(process.argv[2])), serveur(path.resolve(process.argv[3]))]);
  const nav = await lancerNavigateur();
  let n = 0; let ko = 0;
  const cas = [...SCENARIOS.map(([nom, req, l, h]) => [nom, req, l, h, null]),
    ...ACTIONS.map(([nom, fn]) => [`action: ${nom}`, nom === 'écriture refusée' ? '?ecriture-refusee' : '', 1400, 900, fn]),
    ...ACTIONS.slice(0, 3).map(([nom, fn]) => [`action mobile: ${nom}`, '', 390, 844, fn])];
  for (const [nom, req, l, h, fn] of cas) {
    const [x, y] = await Promise.all([capturer(nav, `http://127.0.0.1:${a.port}`, req, l, h, fn), capturer(nav, `http://127.0.0.1:${b.port}`, req, l, h, fn)]);
    n += 1;
    const diffs = ['html', 'histo', 'actions', 'focus', 'journal'].filter((k) => x[k] !== y[k]);
    if (diffs.length) { ko += 1; console.log(`DIFFÉRENCE  ${nom} ${req} ${l}px : ${diffs.join(', ')}`); for (const k of diffs) { let i = 0; while (x[k][i] === y[k][i]) i++; console.log(`   ${k}: …${x[k].slice(Math.max(0, i - 60), i + 120)}\n   ${' '.repeat(k.length)}  …${y[k].slice(Math.max(0, i - 60), i + 120)}`); } }
    else console.log(`identique   ${nom} ${req} ${l}px  (${x.html.length} octets de DOM)`);
  }
  console.log(`\n${n} scénarios, ${ko} différence(s)`);
  await nav.close(); a.fermer(); b.fermer();
})();
