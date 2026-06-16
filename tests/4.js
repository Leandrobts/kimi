'use strict';
/**
 * Teste 4 — DOM lifecycle stress (v1.1 CORRIGIDO)
 *
 * CORREÇÃO v1.1:
 *   - Variante B: MutationObserver agora usa setTimeout(0) para flush
 *     de microtasks antes de verificar childNodes. O disconnect() +
 *     takeRecords() NÃO executa callbacks pendentes — apenas coleta
 *     records. Os callbacks são microtasks que precisam de um tick
 *     do event loop para executar.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['4'] = {
    id      : 4,
    name    : 'DOM lifecycle — criação/remoção rápida, MutationObserver, iframe (v1.1)',
    category: 'DOM',
    timeout : 8000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var root      = document.createElement('div');
        document.body.appendChild(root);

        /* -- Variante A: ciclo create/append/remove com listener re-entrante -- */
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

        /* -- Variante B: MutationObserver remove nós no callback (CORRIGIDO) --
         * CORREÇÃO: aguardar flush de microtasks via setTimeout(0) antes
         * de verificar childNodes. disconnect() + takeRecords() não executa
         * callbacks — apenas coleta records pendentes.
         */
        (function variantB() {
          return new Promise(function (res) {
            var observed  = document.createElement('div');
            root.appendChild(observed);
            var removedCount = 0;

            var obs = new MutationObserver(function (mutations) {
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

            obs.disconnect();
            var records = obs.takeRecords();

            /* AGUARDAR microtasks flush antes de verificar */
            setTimeout(function () {
              if (observed.childNodes.length > 0) {
                /* Mesmo após flush, se sobrou algo, o observer pode ter falhado */
                anomalies.push('B: observed.childNodes=' + observed.childNodes.length +
                  ' após flush de microtasks (removedCount=' + removedCount + ')');
              }
              if (observed.parentNode) {
                try { observed.parentNode.removeChild(observed); } catch (_) {}
              }
              res();
            }, 50);
          });
        }()).then(function () {
          /* Continuar após Variante B */
        });

        /* -- Variante C: iframe lifecycle antes do load -- */
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

        /* -- Variante D: style mutation + forçar layout -- */
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

        /* -- Variante E: EventTarget em nó desanexado -- */
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

        /* -- Cleanup e resolução -- */
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
        }, 1000);
      });
    }
  };

}(window));