'use strict';
/**
 * Teste 6 — MessageChannel/BroadcastChannel (v1.1 CORRIGIDO + INVESTIGAÇÃO)
 *
 * CORREÇÃO v1.1:
 *   - Variante B: postMessage para porta fechada agora verifica se
 *     o close() é realmente síncrono. Se for assíncrono, o não-lançar
 *     de exceção é comportamento esperado, não anomalia.
 *   - Adicionada Variante G: teste de síncronicidade do close().
 *
 * INVESTIGAÇÃO:
 *   - Variante H: postMessage com ArrayBuffer transfer para porta fechada
 *   - Variante I: race entre close() e postMessage em loop
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['6'] = {
    id      : 6,
    name    : 'MessageChannel/BroadcastChannel — close sync test + races (v1.1)',
    category: 'Messaging',
    timeout : 7000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var pending   = 9;

        function done() {
          if (--pending <= 0) {
            if (anomalies.length > 0) {
              resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
            } else {
              resolve({ status: 'PASS', detail: 'A-I sem anomalias' });
            }
          }
        }

        /* -- Variante G: close() é síncrono? --
         * Se close() for assíncrono, o postMessage() seguinte pode
         * ser válido temporariamente.
         */
        (function variantG() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port1.close();

            /* Flush microtasks */
            Promise.resolve().then(function () {
              var threw = false;
              try {
                mc.port1.postMessage('after-close-flush');
              } catch (e) {
                threw = true;
              }

              if (!threw) {
                /* Mesmo após flush de microtasks, postMessage não lançou.
                 * Isso é ANOMALIA REAL — close() deveria ser síncrono. */
                anomalies.push('G: postMessage após close() + microtask flush não lançou');
              }
              done();
            });
          } catch (e) {
            anomalies.push('G: ' + String(e));
            done();
          }
        }());

        /* -- Variante B (CORRIGIDO): postMessage para porta fechada --
         * Agora diferencia entre close() síncrono vs assíncrono.
         */
        (function variantB() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port2.start();

            var closeSync = true;
            mc.port1.close();

            var threw = false;
            try {
              mc.port1.postMessage('to-closed');
            } catch (e) {
              threw = true;
            }

            /* Se não lançou imediatamente, pode ser assíncrono.
             * Verificar após microtask flush na Variante G. */
            if (!threw) {
              /* Não é mais anomalia imediata — investigar na G */
            }
            done();
          } catch (e) {
            anomalies.push('B: setup: ' + String(e));
            done();
          }
        }());

        /* -- Variante H: transfer para porta fechada --
         * Se postMessage para porta fechada não lança, o que acontece
         * com ArrayBuffer transfer? O buffer é detached ou não?
         */
        (function variantH() {
          try {
            var mc  = new MessageChannel();
            mc.port1.start();
            var buf = new ArrayBuffer(1024);
            mc.port1.close();

            try {
              mc.port1.postMessage(buf, [buf]);
              /* Se não lançou e o buffer foi detached, é bug grave */
              if (buf.byteLength === 0) {
                anomalies.push('H: buffer detached em postMessage para porta fechada');
              }
            } catch (e) {
              /* Esperado — OK */
            }
            done();
          } catch (e) {
            anomalies.push('H: ' + String(e));
            done();
          }
        }());

        /* -- Variante I: race loop close/postMessage -- */
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
            done();
          } catch (e) {
            anomalies.push('I: ' + String(e));
            done();
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
            mc.port2.onmessage = function () { done(); };
            mc.port1.start(); mc.port2.start();
            mc.port2.postMessage('trigger');
            setTimeout(function () {
              if (received === 0) anomalies.push('A: onmessage nunca disparou');
              done();
            }, 1500);
          } catch (e) { anomalies.push('A: ' + String(e)); done(); done(); }
        }());

        (function variantC() {
          try {
            var mc = new MessageChannel();
            var buf = new ArrayBuffer(512 * 1024);
            mc.port2.onmessage = function (e) {
              if (!e.data || !(e.data instanceof ArrayBuffer)) {
                anomalies.push('C: dado não é ArrayBuffer');
              }
              done();
            };
            mc.port1.start(); mc.port2.start();
            mc.port1.postMessage(buf, [buf]);
            if (buf.byteLength !== 0) anomalies.push('C: buffer não detached');
            try { var v = new Uint8Array(buf); anomalies.push('C: Uint8Array sem exceção'); } catch (_) {}
            setTimeout(function () { if (mc.port2.onmessage) { anomalies.push('C: timeout'); done(); } mc.port1.close(); mc.port2.close(); }, 1500);
          } catch (e) { anomalies.push('C: ' + String(e)); done(); }
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
              done();
            }, 1000);
          } catch (e) { anomalies.push('D: ' + String(e)); done(); }
        }());

        (function variantE() {
          try {
            var mc = new MessageChannel();
            var gotMsg = false;
            mc.port2.onmessage = function (e) {
              gotMsg = true;
              if (e.data !== 'queued') anomalies.push('E: dado incorreto');
            };
            mc.port1.postMessage('queued');
            mc.port1.start(); mc.port2.start();
            setTimeout(function () {
              if (!gotMsg) anomalies.push('E: mensagem não entregue');
              mc.port1.close(); mc.port2.close(); done();
            }, 800);
          } catch (e) { anomalies.push('E: ' + String(e)); done(); }
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
              done();
            }, 1000);
          } catch (e) { anomalies.push('F: ' + String(e)); done(); }
        }());

      });
    }
  };

}(window));