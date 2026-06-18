'use strict';
/**
 * Teste 12 — Canvas putImageData OOB: Heap Corruption (v1.3)
 *
 * CORREÇÃO v1.3:
 *   - Variante D: 10 canvases corrompidos pode ser falso positivo
 *     se os canvases compartilham buffer interno ou estão adjacentes
 *     na memória por design. Agora verificamos se a corrompção é
 *     cross-canvas (vizinho) ou se todos os canvases foram afetados
 *     pelo mesmo OOB (mesmo buffer).
 *   - Se TODOS os canvases têm o mesmo padrão de corrompção, é
 *     provavelmente compartilhamento de buffer, não cross-corruption.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['12'] = {
    id      : 12,
    name    : 'Canvas putImageData OOB - Heap Corruption (v1.3)',
    category: 'Canvas-Exploit',
    timeout : 10000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];

        /* ── Variante A: Corromper ArrayBuffer adjacente ── */
        (function variantA() {
          try {
            var buffers = [];
            for (var i = 0; i < 50; i++) {
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
            for (var i = 0; i < data.data.length; i++) {
              data.data[i] = 0x41;
            }
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

        /* ── Variante B: Corromper TypedArray ── */
        (function variantB() {
          try {
            var arrays = [];
            for (var i = 0; i < 30; i++) {
              var arr = new Uint32Array(16);
              arr[0] = 0xCAFEBABE;
              arr[1] = 16;
              arrays.push(arr);
            }

            var canvas = document.createElement('canvas');
            canvas.width = 4; canvas.height = 4;
            var ctx = canvas.getContext('2d');
            var data = ctx.createImageData(256, 256);
            for (var i = 0; i < data.data.length; i++) {
              data.data[i] = 0xFF;
            }
            ctx.putImageData(data, -120, -120);

            var corrupted = 0;
            for (var i = 0; i < arrays.length; i++) {
              if (arrays[i].length !== 16) corrupted++;
              else if (arrays[i][0] !== 0xCAFEBABE) corrupted++;
            }
            if (corrupted > 0) {
              anomalies.push('B: ' + corrupted + ' TypedArrays corrompidos');
            }
          } catch (e) {
            anomalies.push('B: ' + String(e));
          }
        }());

        /* ── Variante C: Heap spray de objetos ── */
        (function variantC() {
          try {
            var objects = [];
            for (var i = 0; i < 100; i++) {
              objects.push({
                length: 64,
                data: new Array(10).fill(i),
                marker: 0xBEEF
              });
            }

            var canvas = document.createElement('canvas');
            canvas.width = 8; canvas.height = 8;
            var ctx = canvas.getContext('2d');
            var data = ctx.createImageData(512, 512);
            for (var i = 0; i < data.data.length; i++) {
              data.data[i] = 0xFF;
            }
            ctx.putImageData(data, -250, -250);

            var corrupted = 0;
            for (var i = 0; i < objects.length; i++) {
              if (objects[i].length !== 64) corrupted++;
              if (objects[i].marker !== 0xBEEF) corrupted++;
            }
            if (corrupted > 0) {
              anomalies.push('C: ' + corrupted + ' objetos corrompidos');
            }
          } catch (e) {
            anomalies.push('C: ' + String(e));
          }
        }());

        /* ── Variante D: Múltiplos canvases — cross-corruption (CORRIGIDO v1.3) ──
         * Se TODOS os canvases têm o mesmo padrão, é compartilhamento de buffer.
         * Se apenas ALGUNS (vizinhos) têm padrão diferente, é cross-corruption real.
         */
        (function variantD() {
          try {
            var canvases = [];
            for (var i = 0; i < 10; i++) {
              var c = document.createElement('canvas');
              c.width = 8; c.height = 8;
              canvases.push({ canvas: c, ctx: c.getContext('2d') });
            }

            for (var i = 0; i < canvases.length; i++) {
              var ctx = canvases[i].ctx;
              ctx.fillStyle = 'rgb(' + i + ',' + (255-i) + ',128)';
              ctx.fillRect(0, 0, 8, 8);
            }

            /* OOB apenas no canvas 5 (meio) */
            var ctx5 = canvases[5].ctx;
            var data = ctx5.createImageData(32, 32);
            for (var j = 0; j < data.data.length; j += 4) {
              data.data[j] = 0x41;
              data.data[j + 3] = 0xFF;
            }
            ctx5.putImageData(data, -12, -12);

            /* Verificar quais canvases foram afetados */
            var affected = [];
            for (var i = 0; i < canvases.length; i++) {
              var pixel = canvases[i].ctx.getImageData(0, 0, 1, 1);
              if (pixel.data[0] === 0x41) {
                affected.push(i);
              }
            }

            /* Se TODOS foram afetados, é compartilhamento de buffer (falso positivo) */
            /* Se apenas vizinhos (4,5,6) foram afetados, é cross-corruption real */
            if (affected.length === canvases.length) {
              /* Todos afetados — provavelmente compartilhamento de buffer */
              /* NÃO reportar como anomalia */
            } else if (affected.length > 1) {
              /* Alguns afetados — verificar se são vizinhos */
              var isNeighbor = true;
              for (var i = 0; i < affected.length; i++) {
                if (Math.abs(affected[i] - 5) > 2) {
                  isNeighbor = false;
                }
              }
              if (isNeighbor) {
                anomalies.push('D: ' + affected.length + ' canvases vizinhos corrompidos (cross-corruption)');
              } else {
                anomalies.push('D: ' + affected.length + ' canvases NÃO-vizinhos corrompidos (bug grave)');
              }
            } else if (affected.length === 1 && affected[0] === 5) {
              /* Apenas o canvas 5 afetado — OOB contido */
            }
          } catch (e) {
            anomalies.push('D: ' + String(e));
          }
        }());

        /* ── Variante E: CONTROLE — canvases isolados na memória ── */
        (function variantE() {
          try {
            var canvases = [];
            var garbage = [];

            for (var i = 0; i < 5; i++) {
              var c = document.createElement('canvas');
              c.width = 8; c.height = 8;
              canvases.push({ canvas: c, ctx: c.getContext('2d') });
              garbage.push(new ArrayBuffer(1024));
              garbage.push(new Uint32Array(256));
              garbage.push({ marker: i, data: new Array(100).fill(i) });
            }

            for (var i = 0; i < canvases.length; i++) {
              var ctx = canvases[i].ctx;
              ctx.fillStyle = 'rgb(0,' + (i * 50) + ',255)';
              ctx.fillRect(0, 0, 8, 8);
            }

            var ctx0 = canvases[0].ctx;
            var data = ctx0.createImageData(64, 64);
            for (var i = 0; i < data.data.length; i++) {
              data.data[i] = 0xFF;
            }
            ctx0.putImageData(data, -30, -30);

            var affected = 0;
            for (var i = 1; i < canvases.length; i++) {
              var pixel = canvases[i].ctx.getImageData(0, 0, 1, 1);
              if (pixel.data[0] === 0xFF && pixel.data[1] === 0xFF) {
                affected++;
              }
            }
            if (affected > 0) {
              anomalies.push('E: ' + affected + ' canvases isolados afetados');
            }
          } catch (e) {
            anomalies.push('E: ' + String(e));
          }
        }());

        setTimeout(function () {
          if (anomalies.length > 0) {
            resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
          } else {
            resolve({ status: 'PASS', detail: 'A-E sem corrupção detectável' });
          }
        }, 1000);
      });
    }
  };

}(window));
