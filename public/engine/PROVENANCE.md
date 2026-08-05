# Provenance des fichiers du moteur

Ces fichiers sont **vendorisés** : ils sont versionnés dans ce dépôt et servis tels
quels. Ils ne sont plus tirés de npm au build, donc aucune mise à jour publiée en
amont ne peut modifier ce qui est déployé.

## Origine

| Fichier | Source | Version |
|---|---|---|
| `yaneuraou.js` | npm [`yaneuraou.wasm`](https://www.npmjs.com/package/yaneuraou.wasm) | 0.1.2 |
| `yaneuraou.wasm` | idem | 0.1.2 |
| `yaneuraou.data` | idem | 0.1.2 |
| `yaneuraou.worker.js` | idem | 0.1.2 |
| `../coi-serviceworker.js` | npm [`coi-serviceworker`](https://www.npmjs.com/package/coi-serviceworker) | 0.1.7 |

Dépôt amont du moteur : <https://github.com/arashigaoka/YaneuraOu.wasm>,
lui-même port de <https://github.com/yaneurao/YaneuraOu> (GPL-3.0, voir `COPYING.txt`).

## Empreintes

```
b8d7c8a614ac50fd7b2f0337605e16a1dc9fe36cb48ba87e93aece92e212b67d  yaneuraou.js
ba9bd600d048e9b3e43eec8a155883815a5620f4adf61f659faa1b7c0dd65f1b  yaneuraou.wasm
cf7645f64bf6baa5c74612799ce562752f7985923b1f0fc2e6092c998ed867f9  yaneuraou.data
35171fbc913a33e143f881f1fe840757277efc5d53014ff3b6bc568d52874f3a  yaneuraou.worker.js
d12bd536e27e39a773d7dc7adb1a1167d24002293e97ac81c995fb00cf8d4d5a  ../coi-serviceworker.js
```

Pour revérifier : `sha256sum public/engine/* public/coi-serviceworker.js`

Pour comparer à npm sans rien remplacer :

```bash
npm pack yaneuraou.wasm@0.1.2 && tar xzf yaneuraou.wasm-0.1.2.tgz
sha256sum package/yaneuraou.*
```

## Ce que fait `yaneuraou.data`

C'est le fichier NNUE brut, sans emballage emscripten : il est préchargé dans le
système de fichiers virtuel sous `/eval/nn.bin`. Son en-tête annonce
`Features=K+P[1710->256x2]`. Techniquement, le remplacer par un autre réseau de la
**même architecture** suffit à changer la fonction d'évaluation sans retoucher au
binaire.

### SuishoPetite (2021) a été testé, et n'est pas retenu

L'hypothèse « réseau plus récent = moteur plus fort » a été mesurée, pas supposée.
SuishoPetite (`suishopetite_20211123.k_p`, même architecture, empreinte
`39a295d3…`) a été chargé dans ce binaire et confronté au réseau actuel :

- **Match : 8–4 pour le réseau de 2019** (12 parties, 200 ms/coup, couleurs
  alternées, adjudication à ±3000 cp sur 6 demi-coups). Sente gagne 8 fois sur 12,
  soit l'avantage du trait attendu : pas de biais de couleur.
- Les deux réseaux se chargent correctement et évaluent sainement ; ils divergent
  sur le meilleur coup dans 14 positions sur 32.

12 parties ne suffisent pas à conclure que le réseau de 2019 est *meilleur*
(8–4 n'est pas significatif), mais la charge de la preuve portait sur SuishoPetite,
et elle n'est pas remplie. Le réseau actuel reste en place.

**Piste écartée faute de preuve :** `FV_SCALE` vaut 16 par défaut alors que les
réseaux de la famille Suisho veulent 24 (voir `eval/nnue/evaluate_nnue.cpp` en
amont), et ce binaire fige la valeur sans exposer l'option — un mauvais calibrage
était donc plausible. Mais le ratio des évaluations B/A mesuré sur 28 positions
donne une médiane de 0,69 (étalement 0,42–1,11), loin du 1,50 qu'impliquerait un
facteur 24/16. Le test ne tranche pas vraiment — il compare deux réseaux
différents, donc l'écart de calibrage et l'écart de jugement se confondent — mais
rien ne soutient l'explication.

Pour utiliser un réseau de la famille Suisho proprement, il faut recompiler le
moteur avec `FV_SCALE` configurable, ce que fait le script officiel
`script/wasm_build.js` (`-DENGINE_OPTIONS="option=name=FV_SCALE=…=default=24…"`).

## Capacités du binaire (audit)

Un module WebAssembly ne peut faire que ce que ses imports lui accordent. Les 33
imports de `yaneuraou.wasm` couvrent le système de fichiers virtuel, les threads,
le temps et la mémoire — **aucune primitive réseau**. La glue JS ne contient aucune
URL absolue hors un lien de documentation dans un message d'erreur, et n'utilise ni
`fetch`, ni WebSocket, ni `localStorage`, ni les cookies. Les seuls XHR chargent les
fichiers voisins (`.wasm`, `.data`) par chemin relatif.

La CSP déclarée dans `index.html` (`connect-src 'self'`) ferme la porte de toute façon.
