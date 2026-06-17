'use strict';
/**
 * Teste 5 — Canvas 2D: putImageData OOB INVESTIGAÇÃO (v1.2 SANITY)
 *
 * SANITY CHECKS:
 *   - Variante B: Verificar se o OOB write é reprodutível com
 *     offset positivo (fora dos limites do outro lado).
 *   - Variante H: Verificar se o padrão 0x42 é realmente escrito
 *     pelo putImageData ou se é lixo de memória preexistente.
 *   - Variante J: Teste de controle — putImageData com offset válido
 *     deve NÃO escrever fora dos limites.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['5'] = {
    id      : 5,
    name    : 'Canvas 2D - putImageData OOB INVESTIGAÇÃO (v1.2 SANITY)',
    category: 'Canvas',
    timeout : 8000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];

        function makeCanvas(w, h, color) {
          var c   = document.createElement('canvas');
          c.width = w; c.height = h;
          var ctx = c.getContext('2d');
          if (color) { ctx.fillStyle = color; ctx.fillRect(0, 0, w, h); }
          return { canvas: c, ctx: ctx };
        }

        /* ── Variante A: getImageData com origem negativa ── */
        (function variantA() {
          try {
            var r   = makeCanvas(64, 64, '#ff0000');
            var ctx = r.ctx;
            var imgData;
            try {
              imgData = ctx.getImageData(-8, -8, 80, 80);
            } catch (e2) { return; }

            var nonZero = 0;
            for (var col = 0; col < 8; col++) {
              var base = col * 4;
              for (var ch = 0; ch < 4; ch++) {
                if (imgData.data[base + ch] !== 0) nonZero++;
              }
            }
            if (nonZero > 0) {
              anomalies.push('A: ' + nonZero + ' bytes não-zero em região fora do canvas');
            }
          } catch (e) {
            anomalies.push('A: exceção: ' + String(e));
          }
        }());

        /* ── Variante B: putImageData OOB original (REPRODUZIDO) ── */
        (function variantB() {
          try {
            var r   = makeCanvas(32, 32, null);
            var ctx = r.ctx;

            var large = ctx.createImageData(64, 64);
            for (var i = 0; i < large.data.length; i += 4) {
              large.data[i] = 255; large.data[i + 3] = 255;
            }

            ctx.putImageData(large, -16, -16);

            var check = ctx.getImageData(0, 0, 32, 32);
            var bad   = 0;
            for (var row = 0; row < 15; row++) {
              for (var col = 0; col < 15; col++) {
                var idx = (row * 32 + col) * 4;
                if (check.data[idx] === 255 && check.data[idx + 3] === 255) bad++;
              }
            }
            if (bad > 0) {
              anomalies.push('B: ' + bad + ' pixels vermelho em região não-overlap (REPRODUZIDO)');
            }
          } catch (e) {
            anomalies.push('B: exceção: ' + String(e));
          }
        }());

        /* ── Variante C: createImageData com dimensão zero ── */
        (function variantC() {
          try {
            var r   = makeCanvas(16, 16, null);
            var ctx = r.ctx;
            var cases = [[0, 16], [16, 0], [0, 0], [-1, 16], [16, -1]];
            cases.forEach(function (pair) {
              try {
                var id = ctx.createImageData(pair[0], pair[1]);
                if (id && id.data && id.data.length === 0 && (pair[0] === 0 || pair[1] === 0)) {
                  /* Aceitável */
                } else if (id && id.width === Math.abs(pair[0]) && id.height === Math.abs(pair[1])) {
                  /* OK */
                } else if (id) {
                  anomalies.push('C: createImageData(' + pair + ') => ' + id.width + 'x' + id.height);
                }
              } catch (e2) {
                var name = e2.name || (e2.constructor && e2.constructor.name) || 'Error';
                if (name !== 'IndexSizeError' && name !== 'RangeError' && !(e2 instanceof DOMException)) {
                  anomalies.push('C: createImageData(' + pair + ') lançou ' + name);
                }
              }
            });
          } catch (e) {
            anomalies.push('C: setup: ' + String(e));
          }
        }());

        /* ── Variante D: createImageBitmap lifecycle stress ── */
        (function variantD() {
          if (typeof createImageBitmap !== 'function') return;
          var r   = makeCanvas(128, 128, '#00ff00');

          var promises = [];
          for (var i = 0; i < 30; i++) {
            (function (idx) {
              var opts = (idx % 4 === 0) ? { resizeWidth: 1, resizeHeight: 1 }
                : (idx % 4 === 1) ? { resizeWidth: 256, resizeHeight: 256 }
                : (idx % 4 === 2) ? { imageOrientation: 'flipY' }
                : {};

              var p = createImageBitmap(r.canvas, 0, 0, 128, 128, opts)
                .then(function (bmp) {
                  var tmp = makeCanvas(bmp.width, bmp.height, null);
                  tmp.ctx.drawImage(bmp, 0, 0);
                  bmp.close();
                  try { tmp.ctx.drawImage(bmp, 0, 0); } catch (_) {}
                })
                .catch(function () {});
              promises.push(p);
            }(i));
          }
          Promise.all(promises).catch(function () {});
        }());

        /* ── Variante E: drawImage de canvas para si mesmo ── */
        (function variantE() {
          try {
            var r   = makeCanvas(64, 64, '#0000ff');
            var ctx = r.ctx;
            ctx.drawImage(r.canvas, 0, 0);
            ctx.drawImage(r.canvas, 32, 32, 32, 32, 0, 0, 32, 32);

            var pixel = ctx.getImageData(16, 16, 1, 1);
            if (pixel.data[0] === 0 && pixel.data[1] === 0 && pixel.data[2] === 0 && pixel.data[3] === 255) {
              anomalies.push('E: canvas ficou preto após self-copy');
            }
          } catch (e) {
            anomalies.push('E: ' + String(e));
          }
        }());

        /* ── Variante H: padrão controlado em não-overlap (SANITY) ──
         * Verificar se o padrão é realmente escrito pelo putImageData
         * e não é lixo de memória preexistente.
         */
        (function variantH() {
          try {
            var r   = makeCanvas(8, 8, null);
            var ctx = r.ctx;

            /* Padrão reconhecível */
            var large = ctx.createImageData(32, 32);
            for (var i = 0; i < large.data.length; i += 4) {
              large.data[i]     = 0x42;
              large.data[i + 1] = 0x43;
              large.data[i + 2] = 0x44;
              large.data[i + 3] = 0xFF;
            }

            ctx.putImageData(large, -12, -12);

            var check = ctx.getImageData(0, 0, 8, 8);
            var unexpected = 0;
            for (var i = 0; i < check.data.length; i += 4) {
              if (check.data[i] === 0x42 && check.data[i + 1] === 0x43 &&
                  check.data[i + 3] === 0xFF) {
                unexpected++;
              }
            }
            if (unexpected > 0) {
              anomalies.push('H: padrão 0x42/0x43/0x44/0xFF em região não-overlap (' + unexpected + ' pixels)');
            }
          } catch (e) {
            anomalies.push('H: exceção: ' + String(e));
          }
        }());

        /* ── Variante I: putImageData com offset positivo fora dos limites ──
         * SANITY: Se offset positivo (além do canvas) também escreve OOB,
         * confirma que o clipping está quebrado em AMBOS os lados.
         */
        (function variantI() {
          try {
            var r   = makeCanvas(8, 8, null);
            var ctx = r.ctx;

            var data = ctx.createImageData(16, 16);
            for (var i = 0; i < data.data.length; i += 4) {
              data.data[i]     = 0xAA;
              data.data[i + 1] = 0xBB;
              data.data[i + 2] = 0xCC;
              data.data[i + 3] = 0xFF;
            }

            /* Offset positivo — ImageData começa FORA do canvas (8,8) */
            ctx.putImageData(data, 8, 8);

            var check = ctx.getImageData(0, 0, 8, 8);
            var unexpected = 0;
            for (var i = 0; i < check.data.length; i += 4) {
              if (check.data[i] === 0xAA && check.data[i + 1] === 0xBB) {
                unexpected++;
              }
            }
            if (unexpected > 0) {
              anomalies.push('I: OOB write com offset POSITIVO (' + unexpected + ' pixels)');
            }
          } catch (e) {
            anomalies.push('I: exceção: ' + String(e));
          }
        }());

        /* ── Variante J: CONTROLE — putImageData com offset válido ──
         * SANITY: Offset válido (dentro do canvas) deve NÃO escrever fora.
         */
        (function variantJ() {
          try {
            var r   = makeCanvas(16, 16, null);
            var ctx = r.ctx;

            var data = ctx.createImageData(8, 8);
            for (var i = 0; i < data.data.length; i += 4) {
              data.data[i]     = 0x99;
              data.data[i + 1] = 0x88;
              data.data[i + 2] = 0x77;
              data.data[i + 3] = 0xFF;
            }

            /* Offset válido: (4,4) — ImageData 8x8 cabe dentro de 16x16 */
            ctx.putImageData(data, 4, 4);

            /* Verificar região que NÃO deveria ser afetada: (0,0) a (3,3) */
            var check = ctx.getImageData(0, 0, 4, 4);
            var unexpected = 0;
            for (var i = 0; i < check.data.length; i += 4) {
              if (check.data[i] === 0x99) unexpected++;
            }
            if (unexpected > 0) {
              anomalies.push('J: OOB write mesmo com offset VÁLIDO (' + unexpected + ' pixels)');
            }
          } catch (e) {
            anomalies.push('J: exceção: ' + String(e));
          }
        }());

        setTimeout(function () {
          if (anomalies.length > 0) {
            resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
          } else {
            resolve({ status: 'PASS', detail: 'A-J sem anomalias' });
          }
        }, 1500);
      });
    }
  };

}(window));
