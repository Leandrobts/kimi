'use strict';
/**
 * Teste 14 — Array.reverse + Proxy: Type Confusion (v1.2)
 *
 * CORREÇÃO v1.2:
 *   - Variante B: target[0] deveria ser objeto após transição.
 *     Mas o reverse() REORDENA os elementos — o objeto inserido
 *     em t[0] pode ser movido para outra posição. Agora procuramos
 *     o objeto em QUALQUER posição do array, não apenas em [0].
 *   - Variante D: ArrayBuffer view reinterpretado como número.
 *     Verificamos se o valor é um double que parece ponteiro
 *     (muito grande, NaN, ou valor específico).
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['14'] = {
    id      : 14,
    name    : 'Array.reverse + Proxy - Type Confusion (v1.2)',
    category: 'JSC-Exploit',
    timeout : 5000,

    run: function () {
      var anomalies = [];

      /* ── Variante A: reverse() + truncar length + escrita de objeto ── */
      (function variantA() {
        try {
          var target = [1, 2, 3, 4, 5, 6, 7, 8];
          var hit    = false;

          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              if (!hit && prop === '3') {
                hit = true;
                t.length = 3;
              }
              return Reflect.set(t, prop, val, recv);
            }
          });

          proxy.reverse();

          if (target.length !== 3) {
            anomalies.push('A: length não truncado após reverse: ' + target.length);
          }
          for (var i = 3; i < 8; i++) {
            if (target[i] !== undefined) {
              anomalies.push('A: target[' + i + ']=' + target[i] + ' após truncamento');
            }
          }
        } catch (e) {
          if (!(e instanceof TypeError) && !(e instanceof RangeError)) {
            anomalies.push('A: ' + String(e));
          }
        }
      }());

      /* ── Variante B: reverse() + transição de tipo (CORRIGIDO v1.2) ──
       * O reverse() reordena elementos. O objeto inserido pode não
       * ficar em target[0]. Procuramos em TODAS as posições.
       */
      (function variantB() {
        try {
          var target = [1.1, 2.2, 3.3, 4.4, 5.5];
          var count  = 0;

          var proxy = new Proxy(target, {
            get: function (t, prop, recv) {
              if (prop === 'length') {
                count++;
                if (count === 1) {
                  t[0] = {};
                }
              }
              return Reflect.get(t, prop, recv);
            }
          });

          proxy.reverse();

          /* Procurar objeto em QUALQUER posição do array */
          var foundObject = false;
          var objectIdx   = -1;
          for (var i = 0; i < target.length; i++) {
            if (typeof target[i] === 'object' && target[i] !== null) {
              foundObject = true;
              objectIdx = i;
              break;
            }
          }

          if (!foundObject) {
            /* NÃO é anomalia se o objeto foi movido/perdido durante reverse.
             * É anomalia apenas se o C++ crashou ou corrompeu o array. */
            /* Verificar se o array está em estado consistente */
            var allNumbers = true;
            for (var i = 0; i < target.length; i++) {
              if (typeof target[i] !== 'number' && target[i] !== undefined) {
                allNumbers = false;
              }
            }
            if (!allNumbers) {
              anomalies.push('B: array contém tipos inesperados após reverse');
            }
          } else {
            /* Objeto encontrado — type confusion! */
            anomalies.push('B: objeto encontrado em target[' + objectIdx + '] após reverse');
          }
        } catch (e) {
          if (!(e instanceof TypeError)) {
            anomalies.push('B: ' + String(e));
          }
        }
      }());

      /* ── Variante C: reverse() com getter que retorna objeto ── */
      (function variantC() {
        try {
          var target = [1.1, 2.2, 3.3, 4.4, 5.5];
          var calls  = 0;

          var proxy = new Proxy(target, {
            get: function (t, prop, recv) {
              if (prop !== 'length' && !isNaN(Number(prop))) {
                calls++;
                if (calls === 3) {
                  return { fake: true };
                }
              }
              return Reflect.get(t, prop, recv);
            }
          });

          proxy.reverse();

          var hasObject = false;
          for (var i = 0; i < target.length; i++) {
            if (typeof target[i] === 'object' && target[i] !== null) {
              hasObject = true;
            }
          }
          if (hasObject) {
            anomalies.push('C: objeto encontrado no array após reverse com getter malicioso');
          }
        } catch (e) {
          anomalies.push('C: ' + String(e));
        }
      }());

      /* ── Variante D: reverse() + ArrayBuffer leak (CORRIGIDO v1.2) ──
       * Verificar se o valor é um double que parece ponteiro reinterpretado.
       */
      (function variantD() {
        try {
          var buf    = new ArrayBuffer(64);
          var view   = new Uint32Array(buf);
          view[0]    = 0xDEADBEEF;

          var target = [1.1, 2.2, 3.3, 4.4, 5.5];
          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              if (prop === '2') {
                return Reflect.set(t, prop, view, recv);
              }
              return Reflect.set(t, prop, val, recv);
            }
          });

          proxy.reverse();

          var final = target[2];
          if (typeof final === 'number') {
            /* Verificar se parece ponteiro reinterpretado:
             * - Valor muito grande (|val| > 1e10)
             * - NaN ou Infinity
             * - Valor próximo a 0xDEADBEEF em double representation */
            var isPointerLike = (final > 1e10 || final < -1e10 ||
                                 isNaN(final) || !isFinite(final) ||
                                 (final > 3.7e9 && final < 3.8e9)); /* 0xDEADBEEF ≈ 3.735e9 */
            if (isPointerLike) {
              anomalies.push('D: ArrayBuffer view reinterpretado como número suspeito: ' + final +
                ' (hex-like: ' + final.toString(16) + ')');
            }
            /* Se for um número normal (ex: 3.3), não é anomalia */
          } else if (typeof final !== 'object') {
            anomalies.push('D: tipo inesperado para target[2]: ' + typeof final);
          }
        } catch (e) {
          anomalies.push('D: ' + String(e));
        }
      }());

      if (anomalies.length > 0) {
        return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      }
      return { status: 'PASS', detail: 'A-D sem anomalias' };
    }
  };

}(window));
