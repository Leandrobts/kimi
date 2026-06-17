'use strict';
/**
 * Teste 6 — MessageChannel/BroadcastChannel (v1.2 SANITY)
 *
 * SANITY CHECKS:
 *   - Variante G: Verificar se close() é realmente síncrono comparando
 *     com comportamento em portas NÃO fechadas.
 *   - Variante H: Confirmar que buffer detached é realmente UAF
 *     (mensagem não entregue + buffer inacessível).
 *   - Variante J: Teste de controle — postMessage em porta ABERTA
 *     deve funcionar normalmente.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['6'] = {
    id      : 6,
    name    : 'MessageChannel/BroadcastChannel - close sync test + races (v1.2 SANITY)',
    category: 'Messaging',
    timeout : 7000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var pending   = 10;

        function done(varName, anomaly) {
          if (anomaly) anomalies.push(varName + ': ' + anomaly);
          if (--pending <= 0) {
            if (anomalies.length > 0) {
              resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
            } else {
              resolve({ status: 'PASS', detail: 'A-J sem anomalias' });
            }
          }
        }

        /* ── Variante J: CONTROLE — postMessage em porta ABERTA ──
         * SANITY: Verificar que postMessage funciona normalmente
         * quando a porta está aberta.
         */
        (function variantJ() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port2.start();

            var received = false;
            mc.port2.onmessage = function (e) {
              received = true;
              if (e.data !== 'test-open') {
                anomalies.push('J: dado recebido incorreto: ' + JSON.stringify(e.data));
              }
            };

            mc.port1.postMessage('test-open');

            setTimeout(function () {
              if (!received) {
                anomalies.push('J: mensagem não recebida em porta ABERTA');
              }
              mc.port1.close();
              mc.port2.close();
              done('J');
            }, 500);
          } catch (e) {
            done('J', String(e));
          }
        }());

        /* ── Variante G: close() é síncrono? (SANITY) ──
         * Comparação: porta fechada vs porta aberta.
         */
        (function variantG() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port1.close();

            Promise.resolve().then(function () {
              var threw = false;
              try {
                mc.port1.postMessage('after-close-flush');
              } catch (e) {
                threw = true;
              }

              if (!threw) {
                anomalies.push('G: postMessage após close() + microtask flush não lançou');
              }
              done('G');
            });
          } catch (e) {
            done('G', String(e));
          }
        }());

        /* ── Variante B: postMessage para porta fechada ── */
        (function variantB() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port2.start();
            mc.port1.close();

            var threw = false;
            try {
              mc.port1.postMessage('to-closed');
            } catch (e) {
              threw = true;
            }

            if (!threw) {
              /* Não reportar como anomalia imediata — investigar na G */
            }
            done('B');
          } catch (e) {
            done('B', 'setup: ' + String(e));
          }
        }());

        /* ── Variante H: transfer para porta fechada (SANITY) ──
         * Confirmar UAF: buffer detached + mensagem não entregue.
         */
        (function variantH() {
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
                anomalies.push('H: buffer detached em postMessage para porta fechada');
                try {
                  var v = new Uint8Array(buf);
                  anomalies.push('H: Uint8Array de buffer detached criada sem exceção (length=' + v.length + ')');
                } catch (e2) {}
              }
            } catch (e) {
              /* Esperado — OK */
            }
            done('H');
          } catch (e) {
            done('H', String(e));
          }
        }());

        /* ── Variante I: race loop close/postMessage ── */
        (function variantI() {
          try {
            var races = 0;
            for (var i = 0; i < 100; i++) {
              var mc = new MessageChannel();
              mc.port1.start();
              mc.port1.close();
              try {
                mc.port1.postMessage('race-' + i);
                races++;
              } catch (_) {}
            }
            if (races > 0) {
              anomalies.push('I: ' + races + '/100 postMessage após close() não lançaram');
            }
            done('I');
          } catch (e) {
            done('I', String(e));
          }
        }());

        /* Variantes A, C-F originais (mantidas) */
        (function variantA() {
          try {
            var mc = new MessageChannel();
            var received = 0;
            mc.port1.onmessage = function () {
              received++;
              mc.port1.close();
              try { mc.port2.postMessage('after-port1-close'); } catch (_) {}
            };
            mc.port2.onmessage = function () { done('A'); };
            mc.port1.start(); mc.port2.start();
            mc.port2.postMessage('trigger');
            setTimeout(function () {
              if (received === 0) anomalies.push('A: onmessage nunca disparou');
              done('A');
            }, 1500);
          } catch (e) { anomalies.push('A: ' + String(e)); done('A'); done('A'); }
        }());

        (function variantC() {
          try {
            var mc = new MessageChannel();
            var buf = new ArrayBuffer(512 * 1024);
            mc.port2.onmessage = function (e) {
              if (!e.data || !(e.data instanceof ArrayBuffer)) {
                anomalies.push('C: dado não é ArrayBuffer');
              }
              done('C');
            };
            mc.port1.start(); mc.port2.start();
            mc.port1.postMessage(buf, [buf]);
            if (buf.byteLength !== 0) anomalies.push('C: buffer não detached');
            try { var v = new Uint8Array(buf); anomalies.push('C: Uint8Array sem exceção'); } catch (_) {}
            setTimeout(function () {
              if (mc.port2.onmessage) { anomalies.push('C: timeout'); done('C'); }
              mc.port1.close(); mc.port2.close();
            }, 1500);
          } catch (e) { anomalies.push('C: ' + String(e)); done('C'); }
        }());

        (function variantD() {
          var CH = 'ps4fuzz-d-' + Date.now();
          try {
            var bc1 = new BroadcastChannel(CH);
            var bc2 = new BroadcastChannel(CH);
            var msgCount = 0;
            bc2.onmessage = function (e) {
              msgCount++;
              if (msgCount === 1) {
                bc2.close();
                bc1.postMessage('should-not-arrive');
                bc1.postMessage('should-not-arrive-2');
              } else {
                anomalies.push('D: mensagem após close (' + msgCount + ')');
              }
            };
            bc1.postMessage('trigger');
            setTimeout(function () {
              if (msgCount === 0) anomalies.push('D: onmessage nunca disparou');
              try { bc1.close(); } catch (_) {}
              try { bc2.close(); } catch (_) {}
              done('D');
            }, 1000);
          } catch (e) { anomalies.push('D: ' + String(e)); done('D'); }
        }());

        (function variantE() {
          try {
            var mc = new MessageChannel();
            var gotMsg = false;
            mc.port2.onmessage = function (e) {
              gotMsg = true;
              if (e.data !== 'queued') anomalies.push('E: dado incorreto: ' + JSON.stringify(e.data));
            };
            mc.port1.postMessage('queued');
            mc.port1.start(); mc.port2.start();
            setTimeout(function () {
              if (!gotMsg) anomalies.push('E: mensagem não entregue');
              mc.port1.close(); mc.port2.close(); done('E');
            }, 800);
          } catch (e) { anomalies.push('E: ' + String(e)); done('E'); }
        }());

        (function variantF() {
          try {
            var ab = new MessageChannel();
            var bc = new MessageChannel();
            var received = [];
            ab.port2.onmessage = function (e) {
              bc.port1.postMessage({ relay: e.data });
              ab.port2.close();
            };
            bc.port2.onmessage = function (e) { received.push(e.data); };
            ab.port1.start(); ab.port2.start();
            bc.port1.start(); bc.port2.start();
            ab.port1.postMessage('msg1');
            ab.port1.postMessage('msg2');
            ab.port1.postMessage('msg3');
            setTimeout(function () {
              if (received.length === 0) anomalies.push('F: nenhuma msg chegou');
              else if (received.length > 1) anomalies.push('F: ' + received.length + ' msgs (esperado 1)');
              try { ab.port1.close(); } catch (_) {}
              try { bc.port1.close(); bc.port2.close(); } catch (_) {}
              done('F');
            }, 1000);
          } catch (e) { anomalies.push('F: ' + String(e)); done('F'); }
        }());

      });
    }
  };

}(window));


