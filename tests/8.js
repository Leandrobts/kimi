'use strict';
/**
 * Teste 8 — SharedWorker lifecycle (v1.1 CORRIGIDO)
 *
 * CORREÇÃO v1.1:
 *   - Variante B: handler onmessage agora filtra mensagens 'connected'
 *     e espera 'pong'. O 'connected' é enviado automaticamente pelo
 *     worker no onconnect, ANTES de qualquer comando.
 *   - Variante D: agora usa o mesmo padrão de verificação síncrona
 *     da Variante G do Teste 6.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['8'] = {
    id      : 8,
    name    : 'SharedWorker — connect/close races (v1.1 CORRIGIDO)',
    category: 'Worker',
    timeout : 10000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var WORKER_URL = 'workers/shared-worker.js';

        if (typeof SharedWorker === 'undefined') {
          return resolve({ status: 'PASS', detail: 'SharedWorker não disponível' });
        }

        function makeWorker(name) {
          return new SharedWorker(WORKER_URL, { name: name || ('fuzz-' + Date.now()) });
        }

        var pending = 6;
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

        /* -- Variante A: close() imediato antes de start() -- */
        (function variantA() {
          try {
            var w = makeWorker('fuzz-A');
            var port = w.port;
            port.close();
            try { port.postMessage('after-close'); } catch (_) {}
            done('A');
          } catch (e) { done('A', String(e)); }
        }());

        /* -- Variante B (CORRIGIDO): postMessage antes de start() --
         * O worker envia 'connected' automaticamente no onconnect.
         * Precisamos filtrar isso e esperar o 'pong' do comando 'ping'.
         */
        (function variantB() {
          try {
            var w = makeWorker('fuzz-B');
            var port = w.port;

            var gotPong = false;
            var gotConnected = false;

            port.onmessage = function (e) {
              if (e.data && e.data.type === 'connected') {
                gotConnected = true;
                /* Ignorar — é a mensagem automática de conexão */
                return;
              }
              if (e.data && e.data.type === 'pong') {
                gotPong = true;
              }
            };

            /* postMessage ANTES de start() */
            port.postMessage({ cmd: 'ping' });
            port.start();

            setTimeout(function () {
              if (!gotPong) {
                if (!gotConnected) {
                  anomalies.push('B: nem connected nem pong recebidos');
                } else {
                  anomalies.push('B: pong nunca chegou (connected recebido)');
                }
              }
              port.close();
              done('B');
            }, 2000);
          } catch (e) { done('B', String(e)); }
        }());

        /* -- Variante C: múltiplas conexões -- */
        (function variantC() {
          try {
            var wName = 'fuzz-C-' + Date.now();
            var ports = [];
            for (var i = 0; i < 5; i++) {
              var w = makeWorker(wName);
              ports.push(w.port);
              w.port.start();
            }

            var lastPort = ports[ports.length - 1];
            var gotCount = false;

            lastPort.onmessage = function (e) {
              if (e.data && e.data.type === 'port-count') {
                gotCount = true;
                var count = e.data.count;
                if (count < 1 || count > 7) {
                  anomalies.push('C: port-count=' + count);
                }
              } else if (e.data && e.data.type === 'connected') {
                lastPort.postMessage({ cmd: 'port-count' });
              }
            };

            setTimeout(function () {
              if (!gotCount) anomalies.push('C: port-count não respondido');
              ports.forEach(function (p) { try { p.close(); } catch (_) {} });
              done('C');
            }, 2500);
          } catch (e) { done('C', String(e)); }
        }());

        /* -- Variante D: postMessage após port.close() -- */
        (function variantD() {
          try {
            var w = makeWorker('fuzz-D');
            var port = w.port;
            port.start();

            port.onmessage = function (e) {
              if (e.data && e.data.type === 'connected') {
                port.onmessage = null;
                port.close();

                /* Flush microtasks antes de verificar */
                Promise.resolve().then(function () {
                  var threw = false;
                  try {
                    port.postMessage({ cmd: 'ping' });
                  } catch (e2) {
                    threw = true;
                    var name = e2.name || '';
                    if (name !== 'InvalidStateError') {
                      anomalies.push('D: exceção inesperada: ' + name);
                    }
                  }
                  if (!threw) {
                    anomalies.push('D: postMessage após close() não lançou');
                  }
                  done('D');
                });
              }
            };

            setTimeout(function () {
              if (w.port.onmessage !== null) {
                anomalies.push('D: connected nunca recebido');
                done('D');
              }
            }, 2000);
          } catch (e) { done('D', String(e)); }
        }());

        /* -- Variante E: worker self.close() -- */
        (function variantE() {
          try {
            var w = makeWorker('fuzz-E');
            var port = w.port;
            port.start();

            var seq = [];
            port.onmessage = function (e) {
              seq.push(e.data && e.data.type);
              if (seq.length === 1 && e.data.type === 'connected') {
                port.postMessage({ cmd: 'close-self' });
                setTimeout(function () {
                  try { port.postMessage({ cmd: 'ping' }); } catch (_) {}
                }, 100);
              }
            };

            setTimeout(function () {
              if (seq.length === 0) anomalies.push('E: nenhuma mensagem');
              try { port.close(); } catch (_) {}
              done('E');
            }, 2500);
          } catch (e) { done('E', String(e)); }
        }());

        /* -- Variante F: reconectar após self.close() -- */
        (function variantF() {
          try {
            var wName = 'fuzz-F-' + Date.now();
            var w1 = makeWorker(wName);
            w1.port.start();

            w1.port.onmessage = function (e) {
              if (e.data && e.data.type === 'connected') {
                w1.port.onmessage = null;
                w1.port.postMessage({ cmd: 'close-self' });

                setTimeout(function () {
                  try {
                    var w2 = makeWorker(wName);
                    var port2 = w2.port;
                    var gotConn = false;

                    port2.onmessage = function (e2) {
                      if (e2.data && e2.data.type === 'connected') {
                        gotConn = true;
                        port2.postMessage({ cmd: 'port-count' });
                      } else if (e2.data && e2.data.type === 'port-count') {
                        if (e2.data.count !== 1) {
                          anomalies.push('F: port-count=' + e2.data.count + ' (esperado 1)');
                        }
                      }
                    };
                    port2.start();

                    setTimeout(function () {
                      if (!gotConn) anomalies.push('F: reconexão sem connected');
                      try { port2.close(); } catch (_) {}
                      try { w1.port.close(); } catch (_) {}
                      done('F');
                    }, 2000);
                  } catch (e3) { done('F', 'reconexão: ' + String(e3)); }
                }, 300);
              }
            };

            setTimeout(function () {
              if (w1.port.onmessage !== null) {
                anomalies.push('F: fase 1 sem connected');
                try { w1.port.close(); } catch (_) {}
                done('F');
              }
            }, 4000);
          } catch (e) { done('F', String(e)); }
        }());

      });
    }
  };

}(window));