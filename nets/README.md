# Réseaux d'évaluation alternatifs

Ce dossier est **hors du site déployé** : Vite ne copie que `public/`, donc rien
ici n'est servi aux visiteurs. C'est une archive, pas un actif de build.

## `suishopetite_20211123.k_p.bin`

Réseau NNUE SuishoPetite (2021), même architecture que celui actuellement en
service — `Features=K+P[1710->256x2]` — donc interchangeable avec
`public/engine/yaneuraou.data` par simple copie.

| | |
|---|---|
| Taille | 893 917 octets |
| SHA-256 | `39a295d3f160410493b2ca33c13e7c8113358b528956f7a4312cd3fa2cd62038` |
| Origine | [`mizar/YaneuraOu`, tag `resource`](https://github.com/mizar/YaneuraOu/releases/tag/resource), fichier `suishopetite_20211123.k_p.nnue.cpp.gz` |

Le fichier amont est un tableau C++ (`gEmbeddedNNUEData`) destiné à être compilé
dans le binaire ; les octets ont été extraits pour obtenir le `.bin` brut.

## Pourquoi il n'est pas en service

Testé contre le réseau actuel (2019), même binaire des deux côtés, seul le réseau
changeant. Le classement **s'inverse selon le temps de réflexion** :

| | 200 ms/coup | 2 s/coup |
|---|---|---|
| Réseau 2019 (en service) | **8** | 4 |
| SuishoPetite 2021 | 4 | **8** |

Couleurs équilibrées, Sente gagne 8 fois sur 12 dans les deux manches — pas de
biais. Mais aucun résultat n'est significatif : test exact de Fisher sur le
renversement, **p = 0,22**.

Comme l'app fait un balayage rapide puis une étude lente, les deux régimes
coexistent et un seul fichier ne peut pas être optimal pour les deux. Le réseau
de 2019 reste en service, le balayage étant la passe la plus fréquente.

## Pour l'essayer

```bash
cp nets/suishopetite_20211123.k_p.bin public/engine/yaneuraou.data
npm run build
```

Pour revenir en arrière : `git checkout public/engine/yaneuraou.data`.

Attention, `FV_SCALE` vaut 16 en dur dans ce binaire alors que les réseaux de la
famille Suisho sont réputés vouloir 24, et l'option n'est pas exposée. La piste a
été explorée sans être confirmée — voir `public/engine/PROVENANCE.md`. Utiliser un
réseau Suisho proprement suppose de recompiler le moteur avec `FV_SCALE`
configurable.
