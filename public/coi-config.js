/*
 * Configuration de coi-serviceworker, chargée avant lui.
 *
 * Fichier séparé et non script inline : la CSP de index.html n'autorise pas
 * 'unsafe-inline' pour les scripts.
 *
 * On ne force PAS le mode COEP. Une tentative de forcer `require-corp` (pour
 * contourner le fait que la bibliothèque choisit `credentialless` sur Safari,
 * qui ne reconnaît pas cette valeur) a empêché la page de s'ouvrir sur iOS.
 * Faute de pouvoir tester WebKit, on s'en tient au comportement par défaut de la
 * bibliothèque, connu pour se charger partout — quitte à ce que Safari n'obtienne
 * pas SharedArrayBuffer et que l'app le signale proprement.
 *
 * Porte de secours : ouvrir la page avec `?reset-sw` désinstalle le service
 * worker et n'en réenregistre pas. Indispensable parce qu'un service worker
 * survit aux rechargements et intercepte toutes les requêtes : sans ça, un état
 * cassé ne se répare qu'en vidant les données du site.
 */
(function () {
  var reset = /[?&]reset-sw\b/.test(window.location.search);
  window.coi = {
    shouldRegister: function () {
      return !reset;
    },
    shouldDeregister: function () {
      return reset;
    },
  };
  if (reset && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (r) {
        r.unregister();
      });
    });
  }
})();
