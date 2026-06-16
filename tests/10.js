'use strict';
/**
 * Teste 10 — Canvas putImageData OOB: tentativa de exploração (v1.1)
 *
 * CORREÇÃO v1.1:
 *   - Variante C: a mensagem "teste de padrão de ponteiro concluído"
 *     era reportada como ANOMALY, mas é apenas informativa. Agora
 *     só reportamos como anomalia se houver corrupção real detectada.
 *   - Variante D: adicionada verificação de corrupção de TypedArray
 *     com padrão de ponteiro falso.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['10'] = {
    id      : 10,
    name    : 'Canvas putImageData OOB - tentativa de exploração (v1.1)',
    category: 'Canvas-Exploit',
    timeout : 10000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];

        /* ── Variante A: Heap spray de ArrayBuffers ── */
        (function variantA() {
          try {
            var buffers = [];
            for (var i = 0; i < 100; i++) {
              buffers.push(new ArrayBuffer(64));
            }

            for (var i = 0; i < buffers.length; i++) {
              var v = new Uint32Array(buffers[i]);
              v[0] = 0xDEADBEEF;
              v[1] = 64;
            }

            var canvas = document.createElement('canvas');
            canvas.width = 4; canvas.height = 4;
            var ctx = canvas.getContext('2d');

            var data = ctx.createImageData(256, 256);
            for (var i = 0; i < data.data.length; i++) data.data[i] = 0x41;

            ctx.putImageData(data, -120, -120);

            var corrupted = 0;
            for (var i = 0; i < buffers.length; i++) {
              if (buffers[i].byteLength !== 64) corrupted++;
            }
            if (corrupted > 0) {
              anomalies.push('A: ' + corrupted + ' ArrayBuffers corrompidos');
            }
          } catch (e) {
            anomalies.push('A: ' + String(e));
          }
        }());

        /* ── Variante B: Heap spray de objetos JS ── */
        (function variantB() {
          try {
            var objects = [];
            for (var i = 0; i < 200; i++) {
              objects.push({
                length: 64,
                data: new Array(10).fill(i),
                marker: 0xBEEF
              });
            }

            var canvas = document.createElement('canvas');
            canvas.width = 8; canvas.height = 8;
            var ctx = canvas.getContext('2d');

            var data = ctx.createImageData(128, 128);
            for (var i = 0; i < data.data.length; i++) data.data[i] = 0xFF;

            ctx.putImageData(data, -60, -60);

            var corrupted = 0;
            for (var i = 0; i < objects.length; i++) {
              if (objects[i].length !== 64) corrupted++;
              if (objects[i].marker !== 0xBEEF) corrupted++;
            }
            if (corrupted > 0) {
              anomalies.push('B: ' + corrupted + ' objetos corrompidos');
            }
          } catch (e) {
            anomalies.push('B: ' + String(e));
          }
        }());

        /* ── Variante C: putImageData com padrão de ponteiro ──
         * CORREÇÃO v1.1: só reportar anomalia se houver corrupção detectada.
         */
        (function variantC() {
          try {
            var canvas = document.createElement('canvas');
            canvas.width = 16; canvas.height = 16;
            var ctx = canvas.getContext('2d');

            /* Preencher com padrão que pode parecer tagged pointer */
            var data = ctx.createImageData(64, 64);
            for (var i = 0; i < data.data.length; i += 4) {
              data.data[i]     = 0xFE;
              data.data[i + 1] = 0xFF;
              data.data[i + 2] = 0x00;
              data.data[i + 3] = 0x00;
            }

            ctx.putImageData(data, -24, -24);

            /* Verificar se o canvas ficou em estado inconsistente */
            var check = ctx.getImageData(0, 0, 16, 16);
            var unexpected = 0;
            for (var i = 0; i < check.data.length; i += 4) {
              /* Se encontramos o padrão 0xFE/0xFF/0x00/0x00 em região
               * que deveria estar limpa, é OOB write */
              if (check.data[i] === 0xFE && check.data[i + 1] === 0xFF &&
                  check.data[i + 3] === 0x00) {
                unexpected++;
              }
            }
            if (unexpected > 0) {
              anomalies.push('C: padrão de ponteiro encontrado em região não-overlap (' + unexpected + ' pixels)');
            }
          } catch (e) {
            anomalies.push('C: ' + String(e));
          }
        }());

        /* ── Variante D: Corrupção de TypedArray adjacente ──
         * NOVO v1.1: verificar se TypedArray é corrompido por OOB.
         */
        (function variantD() {
          try {
            var arr = new Uint32Array(16);
            for (var i = 0; i < arr.length; i++) arr[i] = 0xDEADBEEF;

            var canvas = document.createElement('canvas');
            canvas.width = 4; canvas.height = 4;
            var ctx = canvas.getContext('2d');

            var data = ctx.createImageData(64, 64);
            for (var i = 0; i < data.data.length; i++) data.data[i] = 0xFF;

            ctx.putImageData(data, -30, -30);

            var corrupted = 0;
            for (var i = 0; i < arr.length; i++) {
              if (arr[i] !== 0xDEADBEEF) corrupted++;
            }
            if (corrupted > 0) {
              anomalies.push('D: ' + corrupted + ' elementos de Uint32Array corrompidos');
            }
          } catch (e) {
            anomalies.push('D: ' + String(e));
          }
        }());

        setTimeout(function () {
          if (anomalies.length > 0) {
            resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
          } else {
            resolve({ status: 'PASS', detail: 'A-D sem corrupção detectável' });
          }
        }, 2000);
      });
    }
  };

}(window));
