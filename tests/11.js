'use strict';
/**
 * Teste 11 — Proxy forEach Type Confusion (v1.3)
 *
 * CORREÇÃO v1.3:
 *   - Removida Variante A2 (forEach SEM Proxy) — comportamento esperado
 *     de JS, não é anomalia.
 *   - Variante A: objeto no array NÃO é anomalia por si só. Agora
 *     verificamos se operações aritméticas no elemento causam
 *     type confusion (ponteiro reinterpretado como double).
 *   - Variante A3: verificar se forEach COM Proxy re-entrada
 *     produz valor diferente de forEach SEM Proxy.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['11'] = {
    id      : 11,
    name    : 'Proxy forEach - Type Confusion (v1.3)',
    category: 'JSC-Exploit',
    timeout : 5000,

    run: function () {
      var anomalies = [];
      var MARKER    = 9999.0001;

      /* ── Variante A: Proxy forEach com objeto — verificar type confusion ──
       * NÃO reportar apenas "objeto no array" — isso é permitido em JS.
       * Reportar apenas se operações aritméticas produzem lijo (type confusion).
       */
      (function variantA() {
        try {
          var target  = [1, 2, 3, 4, 5];
          var leaked  = { fake: 'object', idx: 42 };

          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              if (prop === '4') {
                return Reflect.set(t, prop, leaked, recv);
              }
              return Reflect.set(t, prop, val, recv);
            }
          });

          proxy.forEach(function (v, i) {
            proxy[i] = v * 2;
          });

          var final = target[4];

          /* Se é objeto, verificar se operações aritméticas causam type confusion */
          if (typeof final === 'object' && final !== null) {
            try {
              var result = final + 1;
              /* Se chegou aqui sem TypeError, verificar se é número estranho */
              if (typeof result === 'number' && result !== NaN && result !== 1) {
                anomalies.push('A: type confusion — objeto + 1 = ' + result);
              }
            } catch (e2) {
              /* TypeError esperado — objeto não tem valueOf/toString */
            }

            try {
              var result2 = final * 2;
              if (typeof result2 === 'number' && result2 !== NaN && result2 !== 0) {
                anomalies.push('A: type confusion — objeto * 2 = ' + result2);
              }
            } catch (e3) {}
          } else if (typeof final === 'number' && final > 1e10) {
            /* Número grande — possível ponteiro reinterpretado */
            anomalies.push('A: POSSÍVEL LEAK: target[4]=' + final + 
              ' (hex: ' + final.toString(16) + ')');
          }
        } catch (e) {
          anomalies.push('A: ' + String(e));
        }
      }());

      /* ── Variante A3: Proxy vs SEM Proxy — comparar comportamento ──
       * Se Proxy produz resultado diferente de SEM Proxy, é bug.
       */
      (function variantA3() {
        try {
          var target1 = [1, 2, 3, 4, 5];
          var target2 = [1, 2, 3, 4, 5];
          var obj = { test: true };

          /* SEM Proxy */
          target1.forEach(function (v, i) {
            if (i === 2) target1[4] = obj;
            target1[i] = v * 2;
          });

          /* COM Proxy */
          var proxy = new Proxy(target2, {
            set: function (t, prop, val, recv) {
              if (prop === '4') return Reflect.set(t, prop, obj, recv);
              return Reflect.set(t, prop, val, recv);
            }
          });
          proxy.forEach(function (v, i) {
            proxy[i] = v * 2;
          });

          /* Comparar resultados */
          if (typeof target1[4] !== typeof target2[4]) {
            anomalies.push('A3: Proxy produz tipo diferente de SEM Proxy: ' +
              typeof target1[4] + ' vs ' + typeof target2[4]);
          }
        } catch (e) {
          anomalies.push('A3: ' + String(e));
        }
      }());

      /* ── Variante B: número grande (fake pointer) ── */
      (function variantB() {
        try {
          var target = [1, 2, 3, 4, 5];
          var fakePointer = 0x414141414141;

          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              if (prop === '4') {
                return Reflect.set(t, prop, fakePointer, recv);
              }
              return Reflect.set(t, prop, val, recv);
            }
          });

          proxy.forEach(function (v, i) {
            proxy[i] = v * 2;
          });

          var final = target[4];
          if (final === fakePointer * 2) {
            anomalies.push('B: fakePointer duplicado: ' + final);
          }
        } catch (e) {
          anomalies.push('B: ' + String(e));
        }
      }());

      /* ── Variante C: ArrayBuffer leak ── */
      (function variantC() {
        try {
          var buf     = new ArrayBuffer(64);
          var target  = [1, 2, 3, 4, 5];
          var view    = new Uint32Array(buf);
          view[0]     = 0xDEADBEEF;

          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              if (prop === '4') {
                return Reflect.set(t, prop, view, recv);
              }
              return Reflect.set(t, prop, val, recv);
            }
          });

          proxy.forEach(function (v, i) {
            proxy[i] = v * 2;
          });

          var final = target[4];
          if (typeof final === 'number' && final !== view) {
            anomalies.push('C: ArrayBuffer view reinterpretado: ' + final);
          }
        } catch (e) {
          anomalies.push('C: ' + String(e));
        }
      }());

      /* ── Variante D: delete durante forEach ── */
      (function variantD() {
        try {
          var target = [1, 2, 3, 4, 5];
          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              if (prop === '2') {
                delete t[3];
              }
              return Reflect.set(t, prop, val, recv);
            }
          });

          proxy.forEach(function (v, i) {
            proxy[i] = v * 2;
          });

          if (target[3] !== undefined && target[3] !== 8) {
            anomalies.push('D: target[3] inesperado: ' + target[3]);
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
