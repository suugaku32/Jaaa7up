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
- **Échelle brute** à l'affichage (`+245`, pas `+2.45`) : c'est ce que le moteur
  émet en USI et ce que lisent ShogiGUI ou Shogidokoro. Voir la réserve sur la
  calibration plus bas.
- **Analyse en une passe, réglable de 100 ms à 5 s par position.** Une seconde
  passe, qui reprend les coups suspects à une cadence longue, reste disponible
  mais n'est plus activée par défaut : mesurée sur une partie de 80 coups, elle
  rouvrait 44 positions — plus de la moitié — pour un coût dominant. Allonger le
  balayage ne réduit pas ce nombre (43 coups signalés à 200 ms, 46 à 2 s) : dans
  une partie d'amateurs, la moitié des coups perdent réellement assez de
  pourcentage de victoire pour être marqués. Le seul levier sur ce décompte est
  le seuil de classification, pas la profondeur ; la profondeur, elle, améliore
  chaque verdict pris isolément.
- **Passe tsume indépendante** : les positions où un mat forcé a été aperçu sont
  reprises à la cadence la plus longue disponible, pour en obtenir la séquence
  complète. Elle partageait auparavant son interrupteur avec la seconde passe,
  si bien que régler le balayage aussi haut que celle-ci les éteignait toutes
  les deux et privait les tsume de leur solution, sans que rien ne le signale.
- **Variantes** : la suite prévue par le moteur est affichée et rejouable coup par
  coup, avec flèches sur le goban, pour voir *pourquoi* un coup est une gaffe. Les
  coups sont cliquables et deux flèches `‹ ›` permettent d'avancer d'un coup à la
  fois — seules cibles dont la position ne bouge pas quand la variante défile.
- **Mode entraînement** : sur chaque gaffe, on rejoue la position ; le coup joué est
  montré (flèche rouge), le coup proposé est évalué par le moteur et accepté s'il
  perd au plus 50 centipions par rapport à la valeur que l'analyse a établie pour
  la position. Le verdict distingue le coup du moteur d'un coup simplement toléré,
  et nomme le premier quand ils diffèrent.
- **Détection des tsume** : les positions où un mat forcé était disponible sont
  repérées, distinguées selon qu'il a été porté ou laissé passer, et rejouables —
  on joue le mat, le moteur défend, jusqu'au mat ou jusqu'à ce qu'il s'échappe.
- **Exploration des défenses** : un tsume n'est prouvé que si *toutes* les
  réponses mènent au mat, mais l'exercice n'en joue qu'une, celle que le moteur
  préfère. Le doute porte sur les autres — « et si le roi fuyait par là ? ». En
  exploration, les deux camps deviennent jouables et le moteur se borne à dire,
  après chaque défense, si le mat tient et en combien de coups.
- **Historique local** : les parties analysées sont conservées en `localStorage`
  (30 au plus, sans aucune synchronisation) et rechargeables sans réanalyse.
- **Réanalyse à la demande** : la cadence est réglable depuis le panneau ⚙ et
  `↻ Réanalyser` rejoue l'analyse sur la partie affichée. Sans cela, une partie
  rouverte depuis l'historique restait figée sur la cadence de son analyse
  d'origine — donc sur les gaffes et les tsume que cette cadence avait su voir.

## Développement

```bash
npm install
npm run dev
npm run build      # produit dist/, prêt pour Pages
```

Le workflow `.github/workflows/deploy.yml` compile `dist/` à chaque push sur `main`
et le pousse en force sur la branche `gh-pages`, d'où Pages le sert. Vite est
configuré avec `base: './'`, donc le site fonctionne aussi bien à la racine d'un
domaine que sous `/<repo>/`.

Le panneau `⚙` affiche en dernière ligne l'estampille de compilation, injectée par
Vite. C'est la seule façon de distinguer « le correctif ne marche pas » de « le
navigateur sert encore l'ancienne page » — une distinction qui coûte cher à ne pas
pouvoir faire quand la chaîne de publication prend du retard.

Quand une construction Pages reste bloquée en `queued`, republier la même
arborescence sous un nouveau commit (`git commit --allow-empty`) écarte celle qui
est en souffrance et en déclenche une neuve.

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

### Thèmes

Dix jeux de couleurs, choisis dans le panneau `⚙` et conservés en `localStorage`.
Trois maison : **Néon** (le halo d'origine, repris de l'app Tsume), **Sobre**
(même ossature sombre, halo supprimé) et **Bois** (plateau clair, kanji noirs,
promues en rouge — la table traditionnelle). Sept classiques : **Catppuccin
Mocha** et **Latte**, **Nord**, **Dracula**, **Gruvbox**, **Solarized** et
**Tokyo Night**.

Un thème n'est qu'un jeu de variables CSS dans `src/theme.css` ; aucune règle de
mise en page n'est dupliquée. Ce qui a dû être corrigé pour que ça marche
vraiment : les lueurs internes des cases surlignées et l'opacité de l'aire du
graphe étaient codées en dur. À 18 %, un bleu vif se voit sur fond sombre et se
délave en gris sur de la crème ; c'est désormais une variable de thème.

Les couleurs de statut sont **redéfinies** par thème et non héritées : le jaune
et le vert du thème néon tombent sous le seuil de contraste sur fond clair.
Contrastes mesurés dans le rendu, pas calculés à la main :

| | fond | corps | texte discret | pièces | « gaffe » |
|---|---|---|---|---|---|
| Néon | `#1a1a2e` | 14,2 | 4,8 | 17,1 | 4,5 |
| Sobre | `#14161a` | 14,5 | 6,3 | 16,2 | 4,7 |
| Bois | `#efe6d5` | 13,4 | 4,9 | 13,8 | 5,3 |
| Tokyo Night | `#1a1b26` | 10,6 | 7,0 | 10,6 | 6,5 |

Plusieurs classiques ont demandé un décalage de luminance sur leurs couleurs de
statut : ces palettes visent la coloration syntaxique, où 3:1 est courant, alors
qu'ici elles portent du texte d'interface qui demande 4,5:1. Concernés : Latte
(erreur, imprécision, bon coup), Nord (gaffe, erreur), Gruvbox et Solarized
(gaffe, erreur). Tokyo Night est la seule reprise telle quelle.

`public/theme-init.js` pose le thème avant le premier rendu — sans lui, un
utilisateur ayant choisi « Bois » verrait clignoter le néon le temps que React
monte. Fichier séparé et non script inline, la CSP interdisant `'unsafe-inline'`.

### Échelle d'évaluation, et une réserve sur sa calibration

L'affichage est en **centipions bruts**, comme le reste de l'écosystème shogi.
Les interfaces d'échecs divisent par 100 (`+2.45`) ; c'était un emprunt, corrigé.

En revanche le **classement** des coups ne se fait pas sur les centipions mais
sur la chute de *win %*, via la sigmoïde de lichess :

```
winPercent(cp) = 50 + 50 · (2 / (1 + e^(−0,00368208 · cp)) − 1),  cp borné à ±1000
```

**Cette constante est ajustée sur des parties d'échecs**, et rien n'a été fait
pour vérifier qu'elle transpose au shogi. Ce qu'elle implique aujourd'hui :

| évaluation | win % | | chute de win % | seuil en cp (depuis 0) |
|---|---|---|---|---|
| +100 | 59 % | | 2 % → imprécision | 22 |
| +300 | 75 % | | 5 % → imprécision | 55 |
| +500 | 86 % | | 10 % → erreur | 111 |
| +1000 et au-delà | 97,5 % | | 20 % → gaffe | 231 |

Deux points discutables. La borne à ±1000 vient des échecs : au-delà, toutes les
positions sont traitées comme identiques, alors que le shogi vit couramment à
±2000–3000 dans les finales tranchantes. Et la pente de la sigmoïde décide seule
de ce qui devient une « gaffe » — 231 cp perdus depuis l'égalité, ici.

Calibrer proprement demanderait un corpus de parties **avec leur résultat**, pour
ajuster la courbe sur la fréquence de victoire réelle. Tant que ce corpus
n'existe pas, la courbe reste celle des échecs, et c'est une hypothèse, pas une
mesure.

### Règles du tsume

Un tsume n'est pas seulement un mat forcé. Trois règles s'y ajoutent, et les
trois manquaient :

- **Échec à chaque coup de l'attaquant.** Sans elle, un coup tranquille qui
  conserve le mat était accepté alors qu'il ne résout rien. Le test précède la
  consultation du moteur.
- **L'abandon n'est pas un mat.** `bestmove resign` dit seulement que le moteur
  juge la position perdue ; le défenseur a encore des coups. Le compter comme
  une réussite validait des solutions qui n'en étaient pas.
- **Mat ≠ pat.** « Aucun coup légal » ne suffit pas : le pat perd aussi au
  shogi, mais ce n'est pas ce qu'un tsume demande de trouver.

Conséquence sur la détection : une position dont la variante du moteur contient
un coup tranquille est un mat forcé, pas un tsume — elle serait insoluble selon
sa propre règle, donc elle est écartée de l'onglet.

À quoi a servi la lecture de [`suugaku32/tsume`](https://github.com/suugaku32/tsume) :
son `_mateSearch` ne génère lui aussi **que des coups d'échec**, ce qui confirme
la règle. En revanche il ne traite pas le 打ち歩詰め non plus — sa génération de
drops s'arrête au nifu et aux dernières rangées, exactement comme la nôtre le
faisait.

### 打ち歩詰め

Mater en **droppant** un pion est interdit ; le même mat porté par un pion qui
avance est légal. `generateLegalMoves` connaissait le nifu et les dernières
rangées, pas cette règle-là — elle proposait donc le coup, et le mode tsume
l'aurait accepté comme solution.

La vérification demande de savoir si l'adversaire serait mat, donc de générer ses
coups. Un drapeau interne coupe la récursion au second niveau, où la question ne
se pose plus : on ne cherche alors qu'à savoir si une réponse existe.

`test/uchifuzume.ts` couvre les trois cas, sur des positions construites à la
main : le cas est trop rare pour sortir d'un tirage aléatoire — **7 200 positions
comparées à shogiops ne l'ont jamais rencontré**, ce qui explique qu'il ait
survécu si longtemps.

### Détection des mats

`go mate`, la commande USI dédiée aux tsume, **n'existe pas dans ce build** : elle
y tombe dans une recherche normale *sans limite de temps* (vérifié — parti jusqu'à
la profondeur 24 sans jamais s'arrêter). La détection s'appuie donc sur le
`score mate` que la recherche ordinaire renvoie déjà.

Conséquence sur ce qu'on peut en dire : un score de mat est une ligne **prouvée**
par la recherche, donc pas de faux positif ; en revanche un balayage de 200 ms
rate les mats profonds, donc pas d'exhaustivité. C'est pourquoi une troisième
passe reprend les positions concernées à la cadence longue, pour obtenir une
séquence de mat complète et non tronquée.

Deux cas particuliers qu'il a fallu traiter :

- **Le mat effectivement porté.** Sur la position finale le moteur répond
  `bestmove resign` sans score de mat. Le critère naturel (« l'adversaire est-il
  encore maté après le coup ? ») échouait donc précisément dans le cas le plus
  favorable au joueur, et comptait un mat réussi comme manqué. On teste
  explicitement l'absence de coup légal.
- **La vérification pendant la résolution.** Elle commence courte (400 ms) pour
  ne pas faire attendre entre deux coups, mais un silence à cette cadence ne peut
  pas valoir verdict d'échec : après un coup juste dans un mat en 9, il reste un
  mat en 8 qu'une recherche brève ne verra pas forcément. Toute annonce
  d'échec est donc reconfirmée à la cadence de l'analyse.

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

## Crédits et licences

| | | licence |
|---|---|---|
| [YaneuraOu](https://github.com/yaneurao/YaneuraOu) | le moteur, par yaneurao | **GPL-3.0** |
| [mizar/YaneuraOu.wasm](https://github.com/mizar/YaneuraOu.wasm) | compilation WebAssembly, paquet `@mizarjp/yaneuraou.k-p` 7.6.3 | GPL-3.0 |
| [React](https://react.dev) · [Vite](https://vite.dev) | interface et compilation | MIT |
| [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) | en-têtes COOP/COEP, par Guido Zuidhof | MIT |
| [shogiops](https://github.com/WandererXII/shogiops) | oracle des tests, **hors site livré** | GPL-3.0-or-later |

Les thèmes reprennent les palettes de [Catppuccin](https://catppuccin.com),
[Nord](https://nordtheme.com), [Dracula](https://draculatheme.com),
[Gruvbox](https://github.com/morhetz/gruvbox),
[Solarized](https://ethanschoonover.com/solarized) et
[Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme). Le classement
des coups en points de *win %* suit la méthode de [lichess](https://lichess.org).
Palette d'origine et durée des animations reprises de
[l'app Tsume](https://github.com/suugaku32/tsume).

### Licence de ce dépôt

**GPL-3.0-or-later**, texte complet dans [`LICENSE`](LICENSE).

    Copyright (C) 2026 suugaku32

    Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le
    modifier selon les termes de la GNU General Public License telle que
    publiée par la Free Software Foundation, soit la version 3, soit (à votre
    choix) toute version ultérieure.

    Il est distribué dans l'espoir qu'il sera utile, mais SANS AUCUNE
    GARANTIE ; sans même la garantie implicite de QUALITÉ MARCHANDE ou
    d'ADÉQUATION À UN USAGE PARTICULIER. Voir la GNU General Public License
    pour plus de détails.

Le choix suit celui du moteur, qui est déjà distribué sous GPL-3.0 : la
compatibilité est acquise, et la question de savoir où passe la frontière entre
les deux ne se pose plus. La variante « or later » est celle que recommande la
FSF ; elle laisse aux destinataires le bénéfice des versions futures.

### Sur la GPL du moteur

Le binaire distribué est sous GPL-3.0, ce qui oblige à indiquer clairement où
trouver les sources correspondantes. C'est fait à trois endroits : le texte de
la licence dans [`public/engine/LICENSE-yaneuraou.md`](public/engine/LICENSE-yaneuraou.md),
la provenance exacte et les empreintes des fichiers dans
[`public/engine/PROVENANCE.md`](public/engine/PROVENANCE.md), et les liens vers
les dépôts amont ci-dessus et dans le pied de page du site.

Le moteur tourne dans un worker séparé et ne communique que par des lignes de
texte du protocole USI — la même relation qu'entre deux programmes reliés par un
tuyau. Savoir si cela en fait deux œuvres distinctes ou une œuvre combinée fait
l'objet de lectures divergentes ; placer ce dépôt sous la même licence rend la
question sans objet.

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
