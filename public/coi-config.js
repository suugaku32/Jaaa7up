/*
 * Configuration de coi-serviceworker, à charger avant lui.
 *
 * Par défaut il choisit `COEP: credentialless` pour tout ce qui n'est ni Chrome
 * ni Firefox — donc pour Safari, qui ne reconnaît pas cette valeur. L'en-tête est
 * alors ignoré, la page n'est pas cross-origin isolated, et SharedArrayBuffer
 * reste indisponible : le moteur ne peut pas démarrer.
 *
 * Tout étant servi depuis la même origine, `require-corp` convient à tous les
 * navigateurs — c'est déjà ce que reçoivent Chrome et Firefox.
 *
 * Fichier séparé et non script inline : la CSP de index.html n'autorise pas
 * 'unsafe-inline' pour les scripts.
 */
window.coi = {
  coepCredentialless: () => false,
};
