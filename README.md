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
- **Analyse en deux passes** : un balayage rapide repère les coups suspects, puis
  une passe lente ne réexamine que ceux-là — l'essentiel du temps va là où il sert.
- **Variantes** : la suite prévue par le moteur est affichée et rejouable coup par
  coup, avec flèches sur le goban, pour voir *pourquoi* un coup est une gaffe.
- **Mode entraînement** : sur chaque gaffe, on rejoue la position ; le coup joué est
  montré (flèche rouge), le coup proposé est réévalué par le moteur et accepté s'il
  perd au plus 50 centipions par rapport au meilleur coup.
- **Historique local** : les parties analysées sont conservées en `localStorage`
  (30 au plus, sans aucune synchronisation) et rechargeables sans réanalyse.

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
paquet npm [`@mizarjp/yaneuraou.k-p`](https://www.npmjs.com/package/@mizarjp/yaneuraou.k-p)
7.6.3 (fork [`mizar/YaneuraOu.wasm`](https://github.com/mizar/YaneuraOu.wasm)). Les
fichiers sont vendorisés dans `public/engine/` et pilotés par le protocole USI depuis
`src/engine/UsiEngine.ts`.

Le réseau d'évaluation (NNUE K-P) est embarqué dans le wasm : rien à charger à
côté, et pas de risque de désaccord entre binaire et réseau. Une seule option est
forcée, `USI_Hash = 32` : le défaut du moteur est 1024 Mo, ce qui fait grossir le
tas WebAssembly à ~1,2 Go dès `isready` et rend l'onglet intenable sur mobile.
Détails et mesures dans [`public/engine/PROVENANCE.md`](public/engine/PROVENANCE.md).

### COOP / COEP sur GitHub Pages

Le moteur multi-thread exige `SharedArrayBuffer`, donc les en-têtes
`Cross-Origin-Embedder-Policy: require-corp` et `Cross-Origin-Opener-Policy: same-origin`
— que GitHub Pages ne permet pas de configurer. On les injecte côté client avec
[`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker) (la technique
utilisée par Lichess pour son Stockfish WASM). Le service worker s'installe au
premier chargement et recharge la page une fois ; c'est pour cela qu'un avertissement
peut apparaître très brièvement à la toute première visite.

### Safari, et la porte de secours

coi-serviceworker choisit `COEP: credentialless` pour tout ce qui n'est ni Chrome
ni Firefox — donc pour Safari, qui ne reconnaît pas cette valeur et se retrouve
sans isolation, donc sans `SharedArrayBuffer`.

`public/coi-config.js` force donc `require-corp` pour tout le monde
(`coepCredentialless: () => false`), ce qui est sans risque ici : tout est servi
depuis la même origine.

Cette correction a d'abord été écrite, puis annulée à tort — la page restait
blanche sur iOS et j'en ai conclu que le réglage était en cause. Le vrai coupable
était ailleurs : le script portant ce réglage était **inline**, et la CSP
n'autorise pas `'unsafe-inline'` pour les scripts, donc il n'a jamais été exécuté.
Sorti dans un fichier séparé, il fonctionne, et l'iPhone obtient le moteur.

Un service worker survit aux rechargements et intercepte toutes les requêtes, donc
un état cassé ne se répare pas en rechargeant. D'où
`https://…/Jaaa7up/?reset-sw`, qui le désinstalle sans en réenregistrer un. Le
nombre de rechargements automatiques est par ailleurs plafonné à deux
(`sessionStorage`), pour qu'un navigateur qui refuse l'isolation ne parte pas en
boucle.

Le moteur est compilé avec pthreads : sa mémoire WebAssembly est partagée, il ne
peut donc pas s'instancier sans `SharedArrayBuffer`. Il n'existe pas de repli
mono-thread dans ce paquet ; quand l'isolation manque, l'app le diagnostique et
désactive l'analyse plutôt que d'échouer en cours de route.

### Tests différentiels contre lishogi

Lishogi publie son moteur de règles en paquet autonome,
[`shogiops`](https://github.com/WandererXII/shogiops) (GPL-3.0). Il sert ici
d'**oracle** en dépendance de développement : il n'entre pas dans le bundle.

```bash
npm test          # parsers puis générateur de coups
```

`test/movegen-vs-shogiops.ts` joue des parties aléatoires et compare, à chaque
position, les coups légaux produits par `src/shogi/moveGen.ts` à ceux de
shogiops. Référence actuelle : **7 200 positions, zéro divergence**.

`test/parsers-vs-shogiops.ts` compare la lecture d'un KIF et d'un CSA.

Pourquoi ce filet plutôt qu'une migration vers shogiops : le générateur de coups
a été cassé deux fois pendant le développement, et ces tests l'auraient attrapé
immédiatement. Une migration, elle, toucherait les six fichiers qui dépendent de
`src/shogi/` — soit toute l'application — sans même couvrir le **KI2** : la regex
de shogiops exige la case de départ `(77)`, et son module `japanese` ne sait que
générer, pas lire.

Attention en écrivant ces tests : `allMoveDests()` ne donne que les cases
atteignables, il faut éprouver chaque état de promotion séparément, sinon des
cavaliers et lances apparaissent non promus en dernière rangée. Et
`allDropDests()` renvoie des clés colorées (« gote bishop ») que `makeUsi`
n'accepte pas telles quelles. Ces deux pièges ont d'abord fait croire à des
divergences inexistantes.

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

- **Synchronisation** : l'historique est purement local. L'app Tsume résout ça sans
  backend en synchronisant sur un Gist GitHub (token en `localStorage`) — le même
  mécanisme s'appliquerait ici.
- **Répétition espacée** sur les gaffes, sur le modèle du système Woodpecker /
  FSRS déjà présent dans Tsume.
- Analyse **multi-PV**, pour proposer plusieurs bons coups plutôt qu'un seul en mode
  entraînement (`MultiPV` est exposé par le moteur, l'app ne s'en sert pas).

Une piste retirée : « déporter l'analyse dans un Web Worker pour ne pas figer l'UI ».
Le moteur est compilé avec pthreads et sa recherche tourne déjà dans un worker — le
fil principal ne fait que passer des lignes USI. Rien à déporter.
