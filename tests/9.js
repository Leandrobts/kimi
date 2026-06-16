'use strict';
/**
 * Teste 9 — MessagePort closed state: INVESTIGAÇÃO PROFUNDA
 *
 * Baseado nos padrões dos Testes 6 e 8:
 *   - postMessage() após close() consistentemente não lança exceção
 *   - Isso pode indicar que close() é assíncrono OU que o estado
 *     closed não é verificado corretamente.
 *
 * Este teste investiga qual cenário é o correto e tenta encontrar
 * uma janela de exploitabilidade.
 *
 * Variantes:
 *   A — Determinar se close() é síncrono via immediate check
 *   B — Determinar se close() é assíncrono via setTimeout(0)
 *   C — Race: close() e postMessage() no mesmo event loop tick
 *   D — Transfer de ArrayBuffer para porta "fechada" — buffer é detached?
 *   E — Porta fechada ainda recebe mensagens? (port2 ? port1 fechada)
 *   F — Double-close: close() chamado 2x, comportamento do estado
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['9'] = {
    id      : 9,
    name    : 'MessagePort closed state — INVESTIGAÇÃO PROFUNDA',
    category: 'Messaging',
    timeout : 6000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var pending   = 6;

        function done(varName, anomaly) {
          if (anomaly) anomalies.push(varName + ': ' + anomaly);
          if (--pending <= 0) {
            if (anomalies.length > 0) {
              resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
            } else {
              resolve({ status: 'PASS', detail: 'A-F sem anomalias' });
            }
          }
        }

        /* -- Variante A: close() é síncrono? -- */
        (function variantA() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();

            var stateBefore = 'unknown';
            try { mc.port1.postMessage('before'); stateBefore = 'ok'; } catch (_) { stateBefore = 'closed'; }

            mc.port1.close();

            var stateAfterImmediate = 'unknown';
            try { mc.port1.postMessage('after-immediate'); stateAfterImmediate = 'ok'; } catch (_) { stateAfterImmediate = 'closed'; }

            if (stateBefore !== 'ok') {
              done('A', 'porta já estava fechada antes de close()');
              return;
            }

            if (stateAfterImmediate === 'ok') {
              /* close() não foi síncrono — investigar na B */
              done('A', null); /* não é anomalia ainda */
            } else {
              /* close() foi síncrono — comportamento esperado */
              done('A', null);
            }
          } catch (e) { done('A', String(e)); }
        }());

        /* -- Variante B: close() é assíncrono? -- */
        (function variantB() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port1.close();

            setTimeout(function () {
              var threw = false;
              try {
                mc.port1.postMessage('after-timeout');
              } catch (e) {
                threw = true;
              }

              if (!threw) {
                /* Mesmo após timeout, postMessage não lançou.
                 * Isso é ANOMALIA REAL — o estado closed não está funcionando */
                done('B', 'postMessage após close() + setTimeout(0) não lançou');
              } else {
                done('B', null);
              }
            }, 0);
          } catch (e) { done('B', String(e)); }
        }());

        /* -- Variante C: race no mesmo tick -- */
        (function variantC() {
          try {
            var races = 0;
            for (var i = 0; i < 50; i++) {
              var mc = new MessageChannel();
              mc.port1.start();
              mc.port1.close();
              try {
                mc.port1.postMessage('race');
                races++;
              } catch (_) {}
            }
            if (races === 50) {
              done('C', '50/50 races: postMessage após close() NUNCA lançou');
            } else if (races > 0) {
              done('C', races + '/50 races: postMessage após close() não lançou (intermitente)');
            } else {
              done('C', null);
            }
          } catch (e) { done('C', String(e)); }
        }());

        /* -- Variante D: ArrayBuffer transfer para porta fechada -- */
        (function variantD() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            var buf = new ArrayBuffer(1024);
            mc.port1.close();

            try {
              mc.port1.postMessage(buf, [buf]);
              if (buf.byteLength === 0) {
                done('D', 'buffer detached em transfer para porta fechada');
              } else {
                done('D', 'transfer para porta fechada não lançou e não detachou');
              }
            } catch (e) {
              /* Se lançou, verificar se o buffer NÃO foi detached */
              if (buf.byteLength === 0) {
                done('D', 'buffer detached ANTES da exceção em transfer para porta fechada');
              } else {
                done('D', null);
              }
            }
          } catch (e) { done('D', String(e)); }
        }());

        /* -- Variante E: porta fechada ainda recebe? -- */
        (function variantE() {
          try {
            var mc = new MessageChannel();
            var received = false;
            mc.port1.onmessage = function () { received = true; };
            mc.port1.start();
            mc.port2.start();

            mc.port1.close();
            mc.port2.postMessage('to-closed');

            setTimeout(function () {
              if (received) {
                done('E', 'porta fechada ainda recebeu mensagem');
              } else {
                done('E', null);
              }
            }, 500);
          } catch (e) { done('E', String(e)); }
        }());

        /* -- Variante F: double-close -- */
        (function variantF() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port1.close();
            mc.port1.close(); /* double close */

            var threw = false;
            try {
              mc.port1.postMessage('after-double-close');
            } catch (e) {
              threw = true;
            }

            if (!threw) {
              done('F', 'postMessage após double-close não lançou');
            } else {
              done('F', null);
            }
          } catch (e) { done('F', String(e)); }
        }());

      });
    }
  };

}(window));