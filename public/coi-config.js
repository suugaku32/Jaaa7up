/*
 * Configuration de coi-serviceworker, chargée avant lui.
 *
 * Fichier séparé et non script inline : la CSP de index.html n'autorise pas
 * 'unsafe-inline' pour les scripts.
 *
 * ── Garde anti-boucle ────────────────────────────────────────────────────────
 * coi-serviceworker recharge la page lui-même : quand le service worker est actif
 * sans contrôler la page, et quand une mise à jour est détectée. Si le navigateur
 * n'accorde jamais l'isolation — Safari/WebKit reçoit `COEP: credentialless`,
 * valeur qu'il ne reconnaît pas — la condition reste vraie à chaque chargement et
 * la page se recharge indéfiniment : écran blanc permanent, que vider les données
 * du site ne répare pas puisque la boucle redémarre aussitôt.
 *
 * On plafonne donc les rechargements par onglet. Passé la limite, la page
 * s'affiche telle quelle ; l'app détecte l'absence de SharedArrayBuffer et
 * l'explique au lieu de disparaître.
 *
 * ── Porte de secours ─────────────────────────────────────────────────────────
 * Ouvrir la page avec `?reset-sw` désinstalle le service worker sans en
 * réenregistrer un.
 */
(function () {
  var RELOAD_KEY = 'coi-reload-count';
  var MAX_RELOADS = 2;
  var reset = /[?&]reset-sw\b/.test(window.location.search);

  function count() {
    try {
      return parseInt(sessionStorage.getItem(RELOAD_KEY) || '0', 10) || 0;
    } catch (e) {
      // sessionStorage peut lever en navigation privée : sans compteur fiable,
      // on interdit tout rechargement plutôt que risquer la boucle.
      return MAX_RELOADS;
    }
  }

  // Isolation obtenue : la séquence a abouti, on repart de zéro.
  if (window.crossOriginIsolated === true) {
    try {
      sessionStorage.removeItem(RELOAD_KEY);
    } catch (e) {
      /* sans importance */
    }
  }

  window.coi = {
    shouldRegister: function () {
      return !reset && count() < MAX_RELOADS;
    },
    shouldDeregister: function () {
      return reset;
    },
    doReload: function () {
      var n = count();
      if (n >= MAX_RELOADS) {
        console.warn(
          "coi-serviceworker : rechargement ignoré (" + n + " déjà effectués). " +
            "Ce navigateur n'accorde pas l'isolation cross-origin.",
        );
        return;
      }
      try {
        sessionStorage.setItem(RELOAD_KEY, String(n + 1));
      } catch (e) {
        return; // pas de compteur, pas de rechargement
      }
      window.location.reload();
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
