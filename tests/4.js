'use strict';
/**
 * Teste 4 — DOM lifecycle stress (v1.2)
 *
 * CORREÇÃO v1.2:
 *   - Variante B: O log mostrou removedCount=0, o que significa que
 *     o callback do MutationObserver NUNCA foi chamado. Isso pode ser
 *     porque disconnect() cancela callbacks pendentes (comportamento
 *     correto da spec) ou porque o PS4 WebKit batcha mutações de
 *     forma diferente.
 *   - Agora testamos ambos os cenários: com e sem disconnect(),
 *     e verificamos se o callback é chamado quando NÃO desconectamos.
 *   - Se o callback não for chamado mesmo sem disconnect(), isso é
 *     um bug real do PS4 WebKit.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['4'] = {
    id      : 4,
    name    : 'DOM lifecycle - criação/remoção rápida, MutationObserver, iframe (v1.2)',
    category: 'DOM',
    timeout : 9000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var root      = document.createElement('div');
        document.body.appendChild(root);

        /* ── Variante A: ciclo create/append/remove com listener re-entrante ── */
        (function variantA() {
          for (var i = 0; i < 200; i++) {
            var parent = document.createElement('div');
            var child  = document.createElement('span');
            parent.appendChild(child);
            root.appendChild(parent);

            child.addEventListener('click', function onClick(e) {
              var node = e.currentTarget;
              node.removeEventListener('click', onClick);
              if (node.parentNode) {
                try { node.parentNode.removeChild(node); } catch (_) {}
              }
            });

            root.removeChild(parent);
          }
          if (root.childNodes.length !== 0) {
            anomalies.push('A: root tem ' + root.childNodes.length + ' filhos após cleanup');
          }
        }());

        /* ── Variante B: MutationObserver SEM disconnect (teste real) ──
         * CORREÇÃO v1.2: NÃO chamamos disconnect() para verificar se
         * o callback é realmente disparado. Se não for, é bug do WebKit.
         */
        (function variantB() {
          return new Promise(function (res) {
            var observed  = document.createElement('div');
            root.appendChild(observed);
            var callbackCount = 0;
            var removedCount  = 0;

            var obs = new MutationObserver(function (mutations) {
              callbackCount++;
              mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                  if (node.parentNode) {
                    try {
                      node.parentNode.removeChild(node);
                      removedCount++;
                    } catch (_) {}
                  }
                });
              });
            });

            obs.observe(observed, { childList: true, subtree: true });

            for (var i = 0; i < 50; i++) {
              var el = document.createElement('p');
              observed.appendChild(el);
            }

            /* NÃO desconectar — deixar o callback rodar naturalmente */
            setTimeout(function () {
              if (callbackCount === 0) {
                /* Callback nunca disparou mesmo sem disconnect() — BUG REAL */
                anomalies.push('B: CRÍTICO — MutationObserver callback NUNCA disparou (50 appendChild, sem disconnect)');
              } else if (removedCount === 0) {
                /* Callback disparou mas não removeu nada */
                anomalies.push('B: callback disparou ' + callbackCount + 'x mas removedCount=0');
              } else if (observed.childNodes.length > 0) {
                /* Callback removeu alguns mas não todos */
                anomalies.push('B: callback removeu ' + removedCount + ' mas childNodes=' + observed.childNodes.length);
              }

              /* Agora sim desconectar e limpar */
              obs.disconnect();
              if (observed.parentNode) {
                try { observed.parentNode.removeChild(observed); } catch (_) {}
              }
              res();
            }, 1000);
          });
        }()).then(function () {
          /* Continuar após Variante B */
        });

        /* ── Variante B2: MutationObserver COM disconnect (comportamento esperado) ──
         * Se disconnect() cancela callbacks pendentes, o removedCount deve ser 0.
         */
        (function variantB2() {
          return new Promise(function (res) {
            var observed  = document.createElement('div');
            root.appendChild(observed);
            var callbackCount = 0;
            var removedCount  = 0;

            var obs = new MutationObserver(function (mutations) {
              callbackCount++;
              mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                  if (node.parentNode) {
                    try {
                      node.parentNode.removeChild(node);
                      removedCount++;
                    } catch (_) {}
                  }
                });
              });
            });

            obs.observe(observed, { childList: true, subtree: true });

            for (var i = 0; i < 50; i++) {
              var el = document.createElement('p');
              observed.appendChild(el);
            }

            /* Desconectar IMEDIATAMENTE — deve cancelar callbacks */
            obs.disconnect();

            setTimeout(function () {
              /* Se callbackCount > 0, disconnect() NÃO cancelou callbacks */
              if (callbackCount > 0) {
                anomalies.push('B2: callback disparou após disconnect() (count=' + callbackCount + ')');
              }
              if (observed.parentNode) {
                try { observed.parentNode.removeChild(observed); } catch (_) {}
              }
              res();
            }, 500);
          });
        }()).then(function () {
          /* Continuar após Variante B2 */
        });

        /* ── Variante C: iframe lifecycle antes do load ── */
        (function variantC() {
          for (var i = 0; i < 15; i++) {
            var iframe    = document.createElement('iframe');
            iframe.srcdoc = '<html><body>test ' + i + '</body></html>';
            root.appendChild(iframe);

            if (i % 3 === 0) {
              root.removeChild(iframe);
            } else if (i % 3 === 1) {
              (function (fr) {
                setTimeout(function () {
                  if (fr.parentNode) { try { fr.parentNode.removeChild(fr); } catch (_) {} }
                }, 0);
              }(iframe));
            } else {
              (function (fr) {
                fr.onload = function () {
                  if (fr.parentNode) { try { fr.parentNode.removeChild(fr); } catch (_) {} }
                };
              }(iframe));
            }
          }
        }());

        /* ── Variante D: style mutation + forçar layout ── */
        (function variantD() {
          var el = document.createElement('div');
          root.appendChild(el);
          for (var i = 0; i < 300; i++) {
            el.style.width   = (i % 100) + 'px';
            el.style.display = (i % 2 === 0) ? 'block' : 'inline-block';
            if (i % 50 === 0) {
              void el.getBoundingClientRect();
            }
          }
          root.removeChild(el);
        }());

        /* ── Variante E: EventTarget em nó desanexado ── */
        (function variantE() {
          try {
            var detached = document.createElement('button');
            var callCount = 0;
            var handler   = function () { callCount++; };
            detached.addEventListener('click', handler);
            detached.dispatchEvent(new Event('click'));
            detached.dispatchEvent(new Event('click'));
            detached.removeEventListener('click', handler);
            detached.dispatchEvent(new Event('click'));

            if (callCount !== 2) {
              anomalies.push('E: callCount=' + callCount + ' (esperado 2)');
            }
          } catch (e) {
            anomalies.push('E: ' + String(e));
          }
        }());

        /* ── Cleanup e resolução ── */
        setTimeout(function () {
          try {
            while (root.firstChild) root.removeChild(root.firstChild);
            if (root.parentNode) root.parentNode.removeChild(root);
          } catch (_) {}

          if (anomalies.length > 0) {
            resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
          } else {
            resolve({ status: 'PASS', detail: 'A-E sem anomalias' });
          }
        }, 2000);
      });
    }
  };

}(window));
