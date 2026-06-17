'use strict';
/**
 * Teste 11 — Proxy forEach Type Confusion (v1.2 SANITY)
 *
 * SANITY CHECKS:
 *   - Variante A: O objeto sobreviveu no array numérico. Verificar
 *     se é type confusion real (C++ não detectou transição) ou se
 *     o forEach simplesmente permite objetos em arrays (comportamento
 *     esperado do JS — arrays podem conter qualquer tipo).
 *   - Variante A2: CONTROLE — inserir objeto diretamente no array
 *     SEM Proxy para comparar.
 *   - Variante A3: Verificar se operações aritméticas no elemento
 *     causam type confusion (ponteiro reinterpretado como double).
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['11'] = {
    id      : 11,
    name    : 'Proxy forEach - Type Confusion EXPLOITAÇÃO (v1.2 SANITY)',
    category: 'JSC-Exploit',
    timeout : 5000,

    run: function () {
      var anomalies = [];
      var MARKER    = 9999.0001;

      /* ── Variante A: set trap retorna objeto ── */
      (function variantA() {
        try {
          var target  = [1, 2, 3, 4, 5];
          var leaked  = null;

          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              if (prop === '4') {
                leaked = { fake: 'object', idx: 42 };
                return Reflect.set(t, prop, leaked, recv);
              }
              return Reflect.set(t, prop, val, recv);
            }
          });

          proxy.forEach(function (v, i) {
            proxy[i] = v * 2;
          });

          var final = target[4];
          if (typeof final === 'number' && final > 1e10) {
            anomalies.push('A: POSSÍVEL LEAK DE PONTEIRO: target[4]=' + final +
              ' (hex-like: ' + final.toString(16) + ')');
          } else if (typeof final === 'object') {
            /* Objeto no array — isso é permitido em JS! Verificar se é
             * realmente type confusion (operações aritméticas falham). */
            anomalies.push('A: objeto sobreviveu no array: ' + JSON.stringify(final));
          }
        } catch (e) {
          anomalies.push('A: ' + String(e));
        }
      }());

      /* ── Variante A2: CONTROLE SEM PROXY ──
       * SANITY: Inserir objeto diretamente no array durante forEach.
       * Se funcionar, é comportamento esperado do JS (arrays heterogêneos).
       */
      (function variantA2() {
        try {
          var target = [1, 2, 3, 4, 5];

          target.forEach(function (v, i) {
            if (i === 2) {
              target[4] = { control: true };
            }
            target[i] = v * 2;
          });

          /* Se target[4] for objeto, é comportamento esperado do JS */
          if (typeof target[4] !== 'object') {
            /* Se for número, o forEach SEM Proxy sobrescreveu o objeto */
            anomalies.push('A2: forEach SEM Proxy sobrescreveu objeto: target[4]=' + target[4]);
          }
        } catch (e) {
          anomalies.push('A2: ' + String(e));
        }
      }());

      /* ── Variante A3: Operações aritméticas no elemento objeto ──
       * SANITY: Se for type confusion real, operações aritméticas
       * devem falhar ou retornar lixo. Se for comportamento esperado,
       * deve lançar TypeError ou fazer toString/toNumber.
       */
      (function variantA3() {
        try {
          var target  = [1, 2, 3, 4, 5];
          var obj     = { fake: 'object', valueOf: function() { return 42; } };

          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              if (prop === '4') {
                return Reflect.set(t, prop, obj, recv);
              }
              return Reflect.set(t, prop, val, recv);
            }
          });

          proxy.forEach(function (v, i) {
            proxy[i] = v * 2;
          });

          /* Tentar operações aritméticas */
          try {
            var result = target[4] + 1;
            if (typeof result === 'number' && result !== 43 && result !== NaN) {
              anomalies.push('A3: aritmética em objeto deu número inesperado: ' + result);
            }
          } catch (e2) {
            /* TypeError é esperado se for objeto sem valueOf */
          }

          try {
            var result2 = target[4] * 2;
            if (typeof result2 === 'number' && result2 !== 84) {
              anomalies.push('A3: multiplicação deu número inesperado: ' + result2);
            }
          } catch (e3) {}
        } catch (e) {
          anomalies.push('A3: ' + String(e));
        }
      }());

      /* ── Variante B: número que parece ponteiro ── */
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

      /* ── Variante C: leak de endereço de ArrayBuffer ── */
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
            anomalies.push('C: ArrayBuffer view reinterpretado como número: ' + final);
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
            anomalies.push('D: target[3] inesperado após delete: ' + target[3]);
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

