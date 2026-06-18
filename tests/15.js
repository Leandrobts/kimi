'use strict';
/**
 * Teste 15 — Chain Exploitation: Proxy + Canvas + MessageChannel (v1.3)
 *
 * CORREÇÃO v1.3:
 *   - Variante D: TypeError "undefined is not an object" era causado
 *     por tentar chamar v[0].toString() quando v era undefined.
 *     Adicionada verificação de existência antes de acessar propriedades.
 *   - Variante B: "UAF tentativa" é apenas informativo. Não reportar
 *     como anomalia a menos que haja corrupção real.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['15'] = {
    id      : 15,
    name    : 'Chain Exploitation - Proxy + Canvas + MessageChannel (v1.3)',
    category: 'Chain-Exploit',
    timeout : 10000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];

        /* ── Variante A: Proxy corrompe ArrayBuffer, Canvas OOB escreve ── */
        (function variantA() {
          try {
            var buffers = [];
            for (var i = 0; i < 20; i++) {
              var buf = new ArrayBuffer(64);
              var v = new Uint32Array(buf);
              v[0] = 0xCAFEBABE;
              v[1] = 64;
              buffers.push(buf);
            }

            var target = [1, 2, 3, 4, 5];
            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                if (prop === '4') {
                  v[1] = 0xFFFFFFFF;
                }
                return Reflect.set(t, prop, val, recv);
              }
            });
            proxy.forEach(function (v, i) { proxy[i] = v * 2; });

            var canvas = document.createElement('canvas');
            canvas.width = 4; canvas.height = 4;
            var ctx = canvas.getContext('2d');
            var data = ctx.createImageData(256, 256);
            for (var i = 0; i < data.data.length; i++) data.data[i] = 0xFF;
            ctx.putImageData(data, -120, -120);

            var corrupted = 0;
            for (var i = 0; i < buffers.length; i++) {
              if (buffers[i].byteLength !== 64) corrupted++;
              var v = new Uint32Array(buffers[i]);
              if (v[0] !== 0xCAFEBABE) corrupted++;
            }
            if (corrupted > 0) {
              anomalies.push('A: ' + corrupted + ' ArrayBuffers corrompidos');
            }
          } catch (e) {
            anomalies.push('A: ' + String(e));
          }
        }());

        /* ── Variante B: MessageChannel transfer fechada + Canvas ──
         * Não reportar como anomalia a menos que haja corrupção real.
         */
        (function variantB() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            var buf = new ArrayBuffer(1024);
            var view = new Uint8Array(buf);
            view[0] = 0xDE;

            mc.port1.close();
            try {
              mc.port1.postMessage(buf, [buf]);
            } catch (_) {}

            if (buf.byteLength === 0) {
              var canvas = document.createElement('canvas');
              canvas.width = 4; canvas.height = 4;
              var ctx = canvas.getContext('2d');
              var data = ctx.createImageData(512, 512);
              for (var i = 0; i < data.data.length; i += 4) {
                data.data[i] = 0x41;
                data.data[i + 3] = 0xFF;
              }
              ctx.putImageData(data, -250, -250);

              /* Não reportar "UAF tentativa" como anomalia */
              /* Apenas verificar se houve crash (não detectável aqui) */
            }
          } catch (e) {
            anomalies.push('B: ' + String(e));
          }
        }());

        /* ── Variante C: Proxy + MessageChannel race ── */
        (function variantC() {
          try {
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port2.start();

            var target = [1, 2, 3, 4, 5];
            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                if (prop === '2') {
                  mc.port1.close();
                }
                return Reflect.set(t, prop, val, recv);
              }
            });

            proxy.forEach(function (v, i) {
              proxy[i] = v * 2;
            });

            try {
              mc.port1.postMessage('after-proxy-close');
              anomalies.push('C: postMessage após close() durante Proxy forEach não lançou');
            } catch (_) {}
          } catch (e) {
            anomalies.push('C: ' + String(e));
          }
        }());

        /* ── Variante D: Full chain test (CORRIGIDO v1.3) ──
         * Verificar corrupção real, não chamar métodos em undefined.
         */
        (function variantD() {
          try {
            var buf = new ArrayBuffer(256);
            var v = new Uint32Array(buf);
            v[0] = 0xBEEF;

            /* 1. Proxy corrompe */
            var target = [1, 2, 3, 4, 5];
            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                if (prop === '4') {
                  v[1] = 0xFFFFFFFF;
                }
                return Reflect.set(t, prop, val, recv);
              }
            });
            proxy.forEach(function (v, i) { proxy[i] = v * 2; });

            /* 2. Canvas OOB */
            var canvas = document.createElement('canvas');
            canvas.width = 4; canvas.height = 4;
            var ctx = canvas.getContext('2d');
            var data = ctx.createImageData(256, 256);
            for (var i = 0; i < data.data.length; i++) data.data[i] = 0xFF;
            ctx.putImageData(data, -120, -120);

            /* 3. MessageChannel */
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port1.close();
            try { mc.port1.postMessage(buf, [buf]); } catch (_) {}

            /* Verificar corrupção real com verificação de existência */
            var corrupted = false;
            if (buf.byteLength !== 256 && buf.byteLength !== 0) {
              corrupted = true;
              anomalies.push('D: ArrayBuffer length inesperado: ' + buf.byteLength);
            }

            /* CORREÇÃO: verificar se buf ainda é válido antes de criar view */
            if (buf.byteLength > 0) {
              try {
                var check = new Uint32Array(buf);
                if (check[0] !== 0xBEEF && check[0] !== 0xFFFFFFFF) {
                  corrupted = true;
                  anomalies.push('D: ArrayBuffer conteúdo corrompido: 0x' + check[0].toString(16));
                }
              } catch (e2) {
                anomalies.push('D: exceção ao acessar ArrayBuffer: ' + String(e2));
              }
            } else {
              /* Buffer detached — verificar se é comportamento esperado */
              /* Não reportar como anomalia se foi detached pelo postMessage */
            }
          } catch (e) {
            anomalies.push('D: ' + String(e));
          }
        }());

        /* ── Variante E: Proxy corrompe ArrayBuffer length ── */
        (function variantE() {
          try {
            var buf = new ArrayBuffer(64);
            var v = new Uint32Array(buf);
            v[0] = 0xCAFEBABE;
            v[1] = 64;

            var target = [1, 2, 3, 4, 5];
            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                if (prop === '4') {
                  v[1] = 0xFFFFFFFF;
                }
                return Reflect.set(t, prop, val, recv);
              }
            });
            proxy.forEach(function (v, i) { proxy[i] = v * 2; });

            try {
              var check = new Uint32Array(buf);
              if (check[0] !== 0xCAFEBABE) {
                anomalies.push('E: ArrayBuffer corrompido: 0x' + check[0].toString(16));
              }
              if (buf.byteLength !== 64) {
                anomalies.push('E: ArrayBuffer length corrompido: ' + buf.byteLength);
              }
            } catch (e2) {
              anomalies.push('E: exceção ao acessar ArrayBuffer: ' + String(e2));
            }
          } catch (e) {
            anomalies.push('E: ' + String(e));
          }
        }());

        setTimeout(function () {
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
