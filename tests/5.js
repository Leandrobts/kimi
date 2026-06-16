'use strict';
/**
 * Teste 5 — Canvas 2D: ImageData boundary OOB INVESTIGAÇÃO (v1.1)
 *
 * INVESTIGAÇÃO DOS 225 PIXELS VERMELHOS:
 * O log mostrou 225 pixels vermelhos em região não-overlap após
 * putImageData(large, -16, -16) em canvas 32×32.
 *
 * Novas variantes agressivas:
 *   F — putImageData com offset extremo (-0x7fffffff) para crash
 *   G — putImageData em loop com ImageData crescente (stress OOB)
 *   H — getImageData após putImageData OOB — verificar corrupção
 *   I — createImageData com dimensões negativas (toString/valueOf)
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['5'] = {
    id      : 5,
    name    : 'Canvas 2D — putImageData OOB INVESTIGAÇÃO (225 pixels)',
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

        /* -- Variante A: getImageData com origem negativa -- */
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

        /* -- Variante B: putImageData com ImageData maior que o canvas (ORIGINAL) -- */
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

        /* -- Variante F: putImageData com offset EXTREMO --
         * Testa se há integer overflow no cálculo de clipping.
         */
        (function variantF() {
          try {
            var r   = makeCanvas(4, 4, null);
            var ctx = r.ctx;

            var data = ctx.createImageData(8, 8);
            for (var i = 0; i < data.data.length; i++) data.data[i] = 0xFF;

            /* Offset negativo extremo — se houver overflow no cálculo interno,
             * pode escrever em endereços inesperados */
            ctx.putImageData(data, -2147483648, -2147483648);

            /* Se não crashou, verificar se o canvas foi modificado */
            var check = ctx.getImageData(0, 0, 4, 4);
            var modified = 0;
            for (var i = 0; i < check.data.length; i++) {
              if (check.data[i] !== 0) modified++;
            }
            if (modified > 0) {
              anomalies.push('F: canvas modificado com offset extremo (modified=' + modified + ')');
            }
          } catch (e) {
            /* Crash ou exceção pode ser o comportamento esperado */
            var name = e.name || '';
            if (name !== 'IndexSizeError' && name !== 'RangeError') {
              anomalies.push('F: exceção inesperada: ' + name + ' — ' + e.message);
            }
          }
        }());

        /* -- Variante G: putImageData em loop stress --
         * Múltiplas chamadas com ImageData crescente para detectar
         * corrupção acumulativa ou buffer overflow.
         */
        (function variantG() {
          try {
            var r   = makeCanvas(16, 16, null);
            var ctx = r.ctx;

            for (var size = 16; size <= 256; size *= 2) {
              var data = ctx.createImageData(size, size);
              for (var i = 0; i < data.data.length; i += 4) {
                data.data[i] = size & 0xFF;
                data.data[i + 3] = 0xFF;
              }
              ctx.putImageData(data, -size / 4, -size / 4);
            }

            /* Verificar integridade: canvas deve estar dentro dos limites */
            var check = ctx.getImageData(0, 0, 16, 16);
            /* Não há critério exato — apenas verificar que não crashou */
          } catch (e) {
            anomalies.push('G: exceção durante loop stress: ' + String(e));
          }
        }());

        /* -- Variante H: getImageData após putImageData OOB --
         * Verifica se a leitura OOB é consistente (indicando corrupção
         * real) ou aleatória (indicando lixo de memória).
         */
        (function variantH() {
          try {
            var r   = makeCanvas(8, 8, null);
            var ctx = r.ctx;

            /* Padrão reconhecível: R=0x42, G=0x43, B=0x44, A=0xFF */
            var large = ctx.createImageData(32, 32);
            for (var i = 0; i < large.data.length; i += 4) {
              large.data[i]     = 0x42;
              large.data[i + 1] = 0x43;
              large.data[i + 2] = 0x44;
              large.data[i + 3] = 0xFF;
            }

            ctx.putImageData(large, -12, -12);

            /* Verificar região que DEVE estar limpa (0,0 a 3,3) */
            var check = ctx.getImageData(0, 0, 4, 4);
            var patternMatches = 0;
            for (var i = 0; i < check.data.length; i += 4) {
              if (check.data[i] === 0x42 && check.data[i + 3] === 0xFF) {
                patternMatches++;
              }
            }

            /* Se o padrão aparece na região não-overlap, é OOB write confirmado */
            if (patternMatches > 0) {
              anomalies.push('H: padrão 0x42/0x43/0x44/0xFF encontrado em região não-overlap (' +
                patternMatches + ' pixels) — OOB WRITE CONFIRMADO');
            }
          } catch (e) {
            anomalies.push('H: exceção: ' + String(e));
          }
        }());

        /* -- Variante I: createImageData com valueOf/toString malicioso --
         * Testa se o C++ cacheia width/height antes de avaliar os argumentos.
         */
        (function variantI() {
          try {
            var r   = makeCanvas(16, 16, null);
            var ctx = r.ctx;

            var w = {
              valueOf: function () {
                /* Durante a avaliação do width, corromper o canvas */
                r.canvas.width = 1;
                return 8;
              }
            };

            var data = ctx.createImageData(w, 8);
            /* Se o C++ usou width=8 mas o canvas foi corrompido para width=1,
             * putImageData pode comportar-se mal */
            if (data.width !== 8 && data.width !== 1) {
              anomalies.push('I: width inesperado: ' + data.width);
            }
          } catch (e) {
            anomalies.push('I: exceção: ' + String(e));
          }
        }());

        setTimeout(function () {
          if (anomalies.length > 0) {
            resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
          } else {
            resolve({ status: 'PASS', detail: 'A-I sem anomalias' });
          }
        }, 1500);
      });
    }
  };

}(window));