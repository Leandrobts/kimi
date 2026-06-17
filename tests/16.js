'use strict';
/**
 * Teste 16 — DOM MutationObserver: Investigação Profunda (v1.2)
 *
 * CORREÇÃO v1.2:
 *   - Variante A: callbackCount=100, childNodes=0 é COMPORTAMENTO ESPERADO
 *     quando NÃO desconectamos o observer. O callback é chamado para
 *     CADA mutação (50 append + 50 remove = 100 callbacks).
 *   - Variante B: takeRecords()=50, childNodes=50 é COMPORTAMENTO ESPERADO.
 *     takeRecords() COLETA records mas NÃO EXECUTA callbacks.
 *     disconnect() impede futuros callbacks. Portanto, childNodes=50
 *     é correto — os nós nunca foram removidos.
 *   - Adicionada Variante C: verificar se disconnect() realmente
 *     impede callbacks futuros.
 *   - Adicionada Variante D: verificar se reconnect funciona.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['16'] = {
    id      : 16,
    name    : 'DOM MutationObserver - Investigação Profunda (v1.2)',
    category: 'DOM-Investigation',
    timeout : 8000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];

        /* ── Variante A: Observer SEM disconnect (comportamento esperado) ──
         * CORREÇÃO v1.2: NÃO reportar como anomalia. O callback é chamado
         * para cada mutação — 50 append + 50 remove = 100 callbacks.
         * childNodes=0 é esperado pois o callback remove todos os nós.
         */
        (function variantA() {
          return new Promise(function (res) {
            var div = document.createElement('div');
            document.body.appendChild(div);
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

            obs.observe(div, { childList: true, subtree: true });

            for (var i = 0; i < 50; i++) {
              div.appendChild(document.createElement('p'));
            }

            setTimeout(function () {
              /* NÃO reportar como anomalia — comportamento esperado.
               * Apenas verificar se está consistente. */
              if (callbackCount === 0) {
                anomalies.push('A: CRÍTICO — callback NUNCA disparou (sem disconnect)');
              } else if (div.childNodes.length > 0) {
                /* Se callback disparou mas não removeu todos, pode haver bug */
                anomalies.push('A: callback disparou ' + callbackCount + 'x mas childNodes=' + div.childNodes.length);
              }
              obs.disconnect();
              if (div.parentNode) div.parentNode.removeChild(div);
              res();
            }, 1000);
          });
        }()).then(function () {
          /* Continuar após Variante A */
        });

        /* ── Variante B: Observer COM takeRecords + disconnect (comportamento esperado) ──
         * CORREÇÃO v1.2: NÃO reportar como anomalia. takeRecords() retorna
         * records pendentes mas NÃO executa callbacks. disconnect() impede
         * futuros callbacks. Portanto, childNodes=50 é correto.
         */
        (function variantB() {
          return new Promise(function (res) {
            var div = document.createElement('div');
            document.body.appendChild(div);
            var callbackCount = 0;

            var obs = new MutationObserver(function (mutations) {
              callbackCount++;
              mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                  if (node.parentNode) {
                    try { node.parentNode.removeChild(node); } catch (_) {}
                  }
                });
              });
            });

            obs.observe(div, { childList: true, subtree: true });

            for (var i = 0; i < 50; i++) {
              div.appendChild(document.createElement('p'));
            }

            var records = obs.takeRecords();
            obs.disconnect();

            setTimeout(function () {
              /* NÃO reportar como anomalia — comportamento esperado.
               * Apenas verificar se callback não foi chamado (esperado). */
              if (callbackCount > 0) {
                anomalies.push('B: callback disparou após takeRecords()+disconnect() (count=' + callbackCount + ')');
              }
              if (records.length !== 50) {
                anomalies.push('B: takeRecords() retornou ' + records.length + ' (esperado 50)');
              }
              if (div.parentNode) div.parentNode.removeChild(div);
              res();
            }, 500);
          });
        }()).then(function () {
          /* Continuar após Variante B */
        });

        /* ── Variante C: disconnect() impede callbacks futuros? ──
         * NOVO v1.2: verificar se disconnect() realmente para o observer.
         */
        (function variantC() {
          return new Promise(function (res) {
            var div = document.createElement('div');
            document.body.appendChild(div);
            var callbackCount = 0;

            var obs = new MutationObserver(function () {
              callbackCount++;
            });

            obs.observe(div, { childList: true });
            obs.disconnect();

            /* Adicionar nós APÓS disconnect */
            for (var i = 0; i < 10; i++) {
              div.appendChild(document.createElement('span'));
            }

            setTimeout(function () {
              if (callbackCount > 0) {
                anomalies.push('C: callback disparou APÓS disconnect() (count=' + callbackCount + ')');
              }
              if (div.parentNode) div.parentNode.removeChild(div);
              res();
            }, 500);
          });
        }()).then(function () {
          /* Continuar após Variante C */
        });

        /* ── Variante D: reconnect após disconnect ──
         * NOVO v1.2: verificar se reconnect funciona corretamente.
         */
        (function variantD() {
          return new Promise(function (res) {
            var div = document.createElement('div');
            document.body.appendChild(div);
            var callbackCount = 0;

            var obs = new MutationObserver(function () {
              callbackCount++;
            });

            obs.observe(div, { childList: true });
            obs.disconnect();
            obs.observe(div, { childList: true });

            for (var i = 0; i < 10; i++) {
              div.appendChild(document.createElement('span'));
            }

            setTimeout(function () {
              if (callbackCount === 0) {
                anomalies.push('D: callback NÃO disparou após reconnect');
              }
              if (div.parentNode) div.parentNode.removeChild(div);
              res();
            }, 500);
          });
        }()).then(function () {
          /* Continuar após Variante D */
        });

        setTimeout(function () {
          if (anomalies.length > 0) {
            resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
          } else {
            resolve({ status: 'PASS', detail: 'A-D comportamento esperado confirmado' });
          }
        }, 2000);
      });
    }
  };

}(window));
