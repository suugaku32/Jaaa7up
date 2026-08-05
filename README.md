# 将棋 — Analyseur de parties

Site statique qui analyse une partie de shogi **entièrement dans le navigateur** :
courbe d'évaluation coup par coup, détection des gaffes, et mode entraînement pour
rejouer les positions ratées.

Aucun backend : le moteur tourne en WebAssembly côté client, donc l'hébergement
GitHub Pages suffit et aucun kifu n'est envoyé sur un serveur.

## Fonctionnalités

- **Lecture du kifu** : formats KIF, KI2 (`▲７六歩`), CSA (`+7776FU`) et USI
  (`position startpos moves 7g7f …`), détectés automatiquement.
- **Courbe d'évaluation** : aire divergente bleu (Sente) / rouge (Gote), survol au
  crosshair, marqueurs de forme distincte pour imprécision / erreur / gaffe.
- **Classement des coups** à la façon lichess : la perte est mesurée en points de
  *win %* (et non en centipions bruts), ce qui évite de qualifier de « gaffe » un
  coup joué dans une position déjà gagnée ou perdue.
- **Mode entraînement** : sur chaque gaffe, on rejoue la position ; le coup proposé
  est réévalué par le moteur et accepté s'il perd au plus 50 centipions par rapport
  au meilleur coup.

## Développement

```bash
npm install
npm run dev
npm run build      # produit dist/, prêt pour Pages
```

Le workflow `.github/workflows/deploy.yml` publie `dist/` sur GitHub Pages à chaque
push sur `main`. Vite est configuré avec `base: './'`, donc le site fonctionne aussi
bien à la racine d'un domaine que sous `/<repo>/`.

## Notes techniques

### Moteur

[YaneuraOu](https://github.com/yaneurao/YaneuraOu) compilé en WebAssembly, via le
paquet npm [`yaneuraou.wasm`](https://www.npmjs.com/package/yaneuraou.wasm)
(port de `arashigaoka`). Les fichiers sont copiés dans `public/engine/` et pilotés
par le protocole USI depuis `src/engine/UsiEngine.ts`.

La fonction d'évaluation embarquée est volontairement petite (~900 Ko) pour rester
raisonnable au chargement. Pour une analyse plus forte, le fork
[`mizar/YaneuraOu.wasm`](https://github.com/mizar/YaneuraOu.wasm) propose des builds
avec des fonctions d'évaluation plus costaudes (Suisho5, ou « SuishoPetite »
allégée) — il suffit de remplacer le contenu de `public/engine/`.

### COOP / COEP sur GitHub Pages

Le moteur multi-thread exige `SharedArrayBuffer`, donc les en-têtes
`Cross-Origin-Embedder-Policy: require-corp` et `Cross-Origin-Opener-Policy: same-origin`
— que GitHub Pages ne permet pas de configurer. On les injecte côté client avec
[`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker) (la technique
utilisée par Lichess pour son Stockfish WASM). Le service worker s'installe au
premier chargement et recharge la page une fois ; c'est pour cela qu'un avertissement
peut apparaître très brièvement à la toute première visite.

`public/coi-config.js` force `COEP: require-corp`. Sans ça, coi-serviceworker
choisit `credentialless` pour tout ce qui n'est ni Chrome ni Firefox — donc pour
Safari, qui ne reconnaît pas cette valeur et se retrouve sans isolation, donc sans
`SharedArrayBuffer`. Tout étant servi depuis la même origine, `require-corp`
convient à tous les navigateurs. Ce réglage est un fichier séparé et non un script
inline, la CSP n'autorisant pas `'unsafe-inline'` pour les scripts.

Le moteur est compilé avec pthreads : sa mémoire WebAssembly est partagée, il ne
peut donc pas s'instancier sans `SharedArrayBuffer`. Il n'existe pas de repli
mono-thread dans ce paquet ; quand l'isolation manque, l'app le diagnostique et
désactive l'analyse plutôt que d'échouer en cours de route.

### Parsing des notations

C'est la partie la moins triviale du projet. `src/shogi/` contient un modèle de
position complet (SFEN, mains, application de coups USI) **et un générateur de coups
légaux**, nécessaire parce que les notations KI2 et certains KIF ne donnent pas la
case de départ : il faut alors retrouver le coup par génération puis désambiguïsation
(左/右/上/引/寄/直). Le CSA, lui, ne marque pas la promotion explicitement — on la
déduit en comparant le code de la pièce à son état sur l'échiquier au moment du coup.

### Parenté avec l'app Tsume

La palette, les pièces en kanji avec halo néon (et les glyphes compacts 杏/圭/全),
ainsi que le schéma d'interaction « sélectionner une pièce → cliquer la case »
reprennent [`suugaku32/tsume`](https://github.com/suugaku32/tsume), pour que les deux
outils forment une famille visuelle.

## Pistes non implémentées

- **Persistance** : rien n'est sauvegardé pour l'instant. L'app Tsume résout ça sans
  backend en synchronisant sur un Gist GitHub (token en `localStorage`) — le même
  mécanisme s'appliquerait ici pour conserver les parties analysées.
- **Répétition espacée** sur les gaffes, sur le modèle du système Woodpecker /
  FSRS déjà présent dans Tsume.
- Analyse en tâche de fond (Web Worker) pour ne pas figer l'UI sur les longues parties.
