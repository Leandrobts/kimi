'use strict';
/**
 * Teste 16 — DOM MutationObserver: Investigação Profunda
 *
 * Bug no Teste 4B:
 *   childNodes=50 após flush de microtasks (removedCount=0)
 *   → O callback do MutationObserver NUNCA foi chamado
 *
 * Hipóteses:
 *   H1: disconnect() cancela callbacks pendentes (comportamento correto)
 *   H2: O observer nunca disparou (batching de mutações)
 *   H3: Bug no WebKit — callbacks perdidos
 *
 * Este teste diferencia entre H1, H2, H3.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['16'] = {
    id      : 16,
    name    : 'DOM MutationObserver — Investigação Profunda (childNodes=50)',
    category: 'DOM-Investigation',
    timeout : 8000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];

        /* ── Variante A: Observer SEM disconnect — verificar se callback roda ── */
        (function variantA() {
          try {
            var div = document.createElement('div');
            document.body.appendChild(div);

            var callbackCount = 0;
            var obs = new MutationObserver(function (mutations) {
              callbackCount += mutations.length;
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

            /* NÃO chamar disconnect() — deixar callback rodar */
            setTimeout(function () {
              if (callbackCount === 0) {
                anomalies.push('A: MutationObserver callback NUNCA disparou (50 appendChild)');
              } else {
                anomalies.push('A: callbackCount=' + callbackCount + ', childNodes=' + div.childNodes.length);
              }
              obs.disconnect();
              if (div.parentNode) div.parentNode.removeChild(div);
            }, 500);
          } catch (e) {
            anomalies.push('A: ' + String(e));
          }
        }());

        /* ── Variante B: Observer com takeRecords() antes de disconnect ── */
        (function variantB() {
          try {
            var div = document.createElement('div');
            document.body.appendChild(div);

            var obs = new MutationObserver(function (mutations) {
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

            /* takeRecords() antes de disconnect */
            var records = obs.takeRecords();
            obs.disconnect();

            if (records.length === 0) {
              anomalies.push('B: takeRecords() retornou vazio (50 mutações perdidas?)');
            } else {
              anomalies.push('B: takeRecords()=' + records.length + ', childNodes=' + div.childNodes.length);
            }

            if (div.parentNode) div.parentNode.removeChild(div);
          } catch (e) {
            anomalies.push('B: ' + String(e));
          }
        }());

        /* ── Variante C: Observer síncrono (sem batching) ── */
        (function variantC() {
          try {
            var div = document.createElement('div');
            document.body.appendChild(div);

            var obs = new MutationObserver(function (mutations) {
              /* Callback síncrono — não deve haver batching */
            });

            obs.observe(div, { childList: true, subtree: true });

            /* appendChild síncrono — deve disparar imediatamente? */
            var p = document.createElement('p');
            div.appendChild(p);

            /* Em microtask, o callback já deveria ter rodado */
            Promise.resolve().then(function () {
              if (div.childNodes.length !== 0) {
                /* Se o callback não removeu, pode ser batching ou bug */
              }
              obs.disconnect();
              if (div.parentNode) div.parentNode.removeChild(div);
            });
          } catch (e) {
            anomalies.push('C: ' + String(e));
          }
        }());

        /* ── Variante D: Múltiplos observers no mesmo alvo ── */
        (function variantD() {
          try {
            var div = document.createElement('div');
            document.body.appendChild(div);

            var count1 = 0, count2 = 0;
            var obs1 = new MutationObserver(function () { count1++; });
            var obs2 = new MutationObserver(function () { count2++; });

            obs1.observe(div, { childList: true });
            obs2.observe(div, { childList: true });

            for (var i = 0; i < 10; i++) {
              div.appendChild(document.createElement('span'));
            }

            setTimeout(function () {
              if (count1 === 0 && count2 === 0) {
                anomalies.push('D: NENHUM observer disparou (10 appendChild)');
              } else if (count1 === 0 || count2 === 0) {
                anomalies.push('D: Apenas um observer disparou (count1=' + count1 + ', count2=' + count2 + ')');
              }
              obs1.disconnect();
              obs2.disconnect();
              if (div.parentNode) div.parentNode.removeChild(div);
            }, 500);
          } catch (e) {
            anomalies.push('D: ' + String(e));
          }
        }());

        setTimeout(function () {
          if (anomalies.length > 0) {
            resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
          } else {
            resolve({ status: 'PASS', detail: 'A-D sem anomalias' });
          }
        }, 1500);
      });
    }
  };

}(window));
