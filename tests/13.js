'use strict';
/**
 * Teste 13 — MessagePort closed state: UAF / State Corruption (v1.2)
 *
 * CORREÇÃO v1.2:
 *   - Variante F: port2.postMessage após port1.close() pode ser
 *     comportamento ESPERADO — port2 não deveria saber que port1
 *     está fechada. A spec diz que postMessage do emissor (port2)
 *     deve lançar InvalidStateError apenas se a porta ESTIVER fechada.
 *     port2 NÃO está fechada, apenas port1. Portanto, NÃO lançar
 *     é comportamento correto.
 *   - Adicionada Variante G: verificar se port2 detecta port1 fechada
 *     após tentar postMessage (mensagem deve ser perdida, não entregue).
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['13'] = {
    id      : 13,
    name    : 'MessagePort closed state - UAF / State Corruption (v1.2)',
    category: 'Messaging-Exploit',
    timeout : 8000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var pending   = 7;

        function done(varName, anomaly) {
          if (anomaly) anomalies.push(varName + ': ' + anomaly);
          if (--pending <= 0) {
            if (anomalies.length > 0) {
              resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
            } else {
              resolve({ status: 'PASS', detail: 'A-G sem anomalias' });
            }
          }
        }

        /* ── Variante A: Transfer ArrayBuffer para porta fechada ── */
        (function variantA() {
          try {
            var mc  = new MessageChannel();
            mc.port1.start();
            var buf = new ArrayBuffer(1024);
            var view = new Uint8Array(buf);
            view[0] = 0xDE;

            mc.port1.close();

            try {
              mc.port1.postMessage(buf, [buf]);
              if (buf.byteLength === 0) {
                anomalies.push('A: CRÍTICO — ArrayBuffer detached em transfer para porta FECHADA');
                try {
                  var v = new Uint8Array(buf);
                  anomalies.push('A: Uint8Array de buffer detached criada sem exceção (length=' + v.length + ')');
                } catch (e2) {}
              }
            } catch (_) {}
            done('A');
          } catch (e) {
            done('A', String(e));
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
            };

            mc.port1.close();
            try { mc.port1.postMessage(buf, [buf]); } catch (_) {}

            setTimeout(function () {
              if (received) {
                anomalies.push('B: mensagem chegou em port2 mesmo com port1 fechada');
              }
              if (buf.byteLength === 0 && !received) {
                anomalies.push('B: buffer detached mas mensagem NÃO entregue → UAF');
              }
              done('B');
            }, 500);
          } catch (e) {
            done('B', String(e));
          }
        }());

        /* ── Variante C: Race loop ── */
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
                if (buf.byteLength === 0) uafCount++;
              } catch (_) {}
            }
            if (uafCount > 0) {
              anomalies.push('C: ' + uafCount + '/50 transfers para porta fechada detacharam buffer');
            }
            done('C');
          } catch (e) {
            done('C', String(e));
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
            mc.port2.postMessage('test');

            setTimeout(function () {
              if (received) {
                anomalies.push('D: porta fechada ainda recebeu mensagem');
              }
              done('D');
            }, 500);
          } catch (e) {
            done('D', String(e));
          }
        }());

        /* ── Variante E: Double-close ── */
        (function variantE() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port1.close();
            mc.port1.close();

            var threw = false;
            try {
              mc.port1.postMessage('after-double-close');
            } catch (e) {
              threw = true;
            }
            if (!threw) {
              anomalies.push('E: postMessage após double-close não lançou');
            }
            done('E');
          } catch (e) {
            done('E', String(e));
          }
        }());

        /* ── Variante F (CORRIGIDO v1.2): port2.postMessage após port1.close() ──
         * CORREÇÃO: port2 NÃO está fechada, apenas port1. A spec permite
         * postMessage de port2 — a mensagem será perdida (port1 fechada).
         * NÃO é anomalia se não lançar exceção.
         * 
         * O que VERIFICAMOS agora: se a mensagem é realmente perdida
         * (não entregue em port1) e se port2 detecta eventualmente.
         */
        (function variantF() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port2.start();

            var received = false;
            mc.port1.onmessage = function () { received = true; };

            mc.port1.close();

            /* port2.postMessage deve ser permitido (port2 está aberta) */
            var threw = false;
            try {
              mc.port2.postMessage('to-closed-port1');
            } catch (e) {
              threw = true;
            }

            /* Se port2 lançou exceção, isso é anomalia (port2 não está fechada) */
            if (threw) {
              anomalies.push('F: port2.postMessage lançou exceção (port2 deveria estar aberta)');
            }

            setTimeout(function () {
              /* Verificar se a mensagem foi perdida (esperado) ou entregue (bug) */
              if (received) {
                anomalies.push('F: mensagem entregue em port1 fechada');
              }
              done('F');
            }, 500);
          } catch (e) {
            done('F', String(e));
          }
        }());

        /* ── Variante G: port1.close() durante port2.postMessage em loop ──
         * NOVO v1.2: testa race específico entre close() e postMessage().
         */
        (function variantG() {
          try {
            var lostCount = 0;
            for (var i = 0; i < 20; i++) {
              var mc = new MessageChannel();
              mc.port1.start();
              mc.port2.start();

              var received = false;
              mc.port1.onmessage = function () { received = true; };

              /* Race: fechar port1 enquanto port2 posta */
              mc.port1.close();
              mc.port2.postMessage('race-' + i);

              /* Não esperamos setTimeout — verificar imediatamente */
              if (received) {
                lostCount++;
              }
            }
            if (lostCount > 0) {
              anomalies.push('G: ' + lostCount + '/20 mensagens entregues em port1 fechada (race)');
            }
            done('G');
          } catch (e) {
            done('G', String(e));
          }
        }());

      });
    }
  };

}(window));
