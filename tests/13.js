\'use strict\';\n/**
 * Teste 13 — MessagePort closed state: UAF / State Corruption EXPLOITAÇÃO
 *
 * Bug confirmado nos Testes 6 e 8:
 *   - postMessage() após close() NUNCA lança exceção (100/100 repro)
 *   - Mesmo após microtask flush
 *
 * Hipóteses:
 *   H1: close() é no-op (não seta flag closed)
 *   H2: close() seta flag mas postMessage() não verifica
 *   H3: close() é assíncrono e nunca completa
 *
 * Se H1 ou H2: transfer de ArrayBuffer para porta "fechada" pode
 *   causar UAF (buffer detached sem destino válido)
 *
 * Se H3: race entre close() e postMessage() pode causar double-free
 *
 * Variantes:
 *   A — Transfer ArrayBuffer para porta fechada (UAF?)
 *   B — Transfer ArrayBuffer, depois acessar (use-after-detach?)
 *   C — Race: close() e postMessage() no mesmo tick
 *   D — Porta fechada ainda recebe mensagens?
 *   E — Double-close + postMessage (double-free?)
 *   F — Porta fechada em um lado, postar do outro
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests[\'13\'] = {
    id      : 13,
    name    : \'MessagePort closed state — UAF / State Corruption EXPLOITAÇÃO\',
    category: \'Messaging-Exploit\',
    timeout : 8000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var pending   = 6;

        function done(varName, anomaly) {
          if (anomaly) anomalies.push(varName + \': \' + anomaly);
          if (--pending <= 0) {
            if (anomalies.length > 0) {
              resolve({ status: \'ANOMALY\', detail: anomalies.join(\' | \') });
            } else {
              resolve({ status: \'PASS\', detail: \'A-F sem anomalias\' });
            }
          }
        }

        /* ── Variante A: Transfer ArrayBuffer para porta fechada ──
         * Se a porta está realmente fechada, o buffer NÃO deve ser detached.
         * Se for detached mas a mensagem não é entregue, temos UAF.
         */
        (function variantA() {
          try {
            var mc  = new MessageChannel();
            mc.port1.start();
            var buf = new ArrayBuffer(1024);
            var view = new Uint8Array(buf);
            view[0] = 0xDE;
            view[1] = 0xAD;

            mc.port1.close();

            try {
              mc.port1.postMessage(buf, [buf]);

              /* Se chegou aqui, postMessage não lançou.
               * Verificar se o buffer foi detached. */
              if (buf.byteLength === 0) {
                /* Buffer foi detached mas porta está fechada!
                 * A mensagem nunca será entregue → UAF do buffer */
                anomalies.push(\'A: CRÍTICO — ArrayBuffer detached em transfer para porta FECHADA\');

                /* Tentar acessar o buffer detached */
                try {
                  var v = new Uint8Array(buf);
                  anomalies.push(\'A: Uint8Array de buffer detached criada sem exceção (length=\' + v.length + \')\');
                } catch (e2) {
                  /* TypeError esperado */
                }
              } else {
                /* Buffer NÃO foi detached — comportamento seguro */
              }
            } catch (e) {
              /* Se lançou exceção, comportamento correto */
            }
            done(\'A\');
          } catch (e) {
            done(\'A\', String(e));
          }
        }());

        /* ── Variante B: Transfer, verificar se outra porta recebe ── */
        (function variantB() {
          try {
            var mc  = new MessageChannel();
            mc.port1.start();
            mc.port2.start();
            var buf = new ArrayBuffer(1024);

            var received = false;
            mc.port2.onmessage = function (e) {
              received = true;
              if (e.data && e.data instanceof ArrayBuffer) {
                /* Mensagem chegou mesmo com port1 fechada? */
              }
            };

            mc.port1.close();

            try {
              mc.port1.postMessage(buf, [buf]);
            } catch (_) {}

            setTimeout(function () {
              if (received) {
                anomalies.push(\'B: mensagem chegou em port2 mesmo com port1 fechada\');
              }
              if (buf.byteLength === 0 && !received) {
                anomalies.push(\'B: buffer detached mas mensagem NÃO entregue → UAF\');
              }
              done(\'B\');
            }, 500);
          } catch (e) {
            done(\'B\', String(e));
          }
        }());

        /* ── Variante C: Race loop — close() e postMessage() alternados ── */
        (function variantC() {
          try {
            var uafCount = 0;
            for (var i = 0; i < 50; i++) {
              var mc = new MessageChannel();
              mc.port1.start();
              var buf = new ArrayBuffer(64);

              mc.port1.close();
              try {
                mc.port1.postMessage(buf, [buf]);
                if (buf.byteLength === 0) {
                  uafCount++;
                }
              } catch (_) {}
            }
            if (uafCount > 0) {
              anomalies.push(\'C: \' + uafCount + \'/50 transfers para porta fechada detacharam buffer\');
            }
            done(\'C\');
          } catch (e) {
            done(\'C\', String(e));
          }
        }());

        /* ── Variante D: Porta fechada ainda recebe? ── */
        (function variantD() {
          try {
            var mc = new MessageChannel();
            var received = false;
            mc.port1.onmessage = function () { received = true; };
            mc.port1.start();
            mc.port2.start();

            mc.port1.close();
            mc.port2.postMessage(\'test\');

            setTimeout(function () {
              if (received) {
                anomalies.push(\'D: porta fechada ainda recebeu mensagem\');
              }
              done(\'D\');
            }, 500);
          } catch (e) {
            done(\'D\', String(e));
          }
        }());

        /* ── Variante E: Double-close + postMessage ── */
        (function variantE() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port1.close();
            mc.port1.close(); /* double close */

            var threw = false;
            try {
              mc.port1.postMessage(\'after-double-close\');
            } catch (e) {
              threw = true;
            }

            if (!threw) {
              anomalies.push(\'E: postMessage após double-close não lançou\');
            }
            done(\'E\');
          } catch (e) {
            done(\'E\', String(e));
          }
        }());

        /* ── Variante F: Porta fechada em um lado, postar do outro ── */
        (function variantF() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port2.start();

            /* Fechar port1 (lado do receptor) */
            mc.port1.close();

            /* Postar de port2 (lado do emissor) */
            var threw = false;
            try {
              mc.port2.postMessage(\'to-closed\');
            } catch (e) {
              threw = true;
            }

            if (!threw) {
              /* port2 não deveria saber que port1 está fechada */
              anomalies.push(\'F: port2.postMessage não lançou após port1.close()\');
            }
            done(\'F\');
          } catch (e) {
            done(\'F\', String(e));
          }
        }());

      });
    }
  };

}(window));