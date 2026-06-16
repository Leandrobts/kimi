'use strict';
/**
 * Teste 3 — Proxy: re-entrância via get/set/has traps (v1.1 INVESTIGAÇÃO)
 *
 * INVESTIGAÇÃO DO VALOR 19998.0002:
 * O log mostrou target[4] = 19998.0002 = 9999.0001 * 2.
 * Isso sugere que o set trap foi chamado 2x para o mesmo índice,
 * ou que a re-entrância causou dupla escrita.
 *
 * Novas variantes de investigação:
 *   A' — Logging detalhado de cada chamada do set trap
 *   A'' — Teste com diferentes MARKERs para rastrear ordem de escrita
 *   E  — Proxy.set durante Array.prototype.reverse (mais agressivo)
 *   F  — Proxy.get retornando getter malicioso durante sort
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['3'] = {
    id      : 3,
    name    : 'Proxy — re-entrância INVESTIGAÇÃO (valor 19998.0002)',
    category: 'JSC-Proxy',
    timeout : 6000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var MARKER    = 9999.0001;
        var MARKER2   = 8888.0002;

        /* -- Variante A': LOGGING DETALHADO do set trap --
         * Reproduz o cenário original mas loga CADA chamada do set trap
         * para entender a sequência que produz 19998.0002.
         */
        (function variantA_log() {
          try {
            var target  = [1, 2, 3, 4, 5];
            var setLog  = [];
            var reentry = false;

            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                var entry = {
                  prop: String(prop),
                  val: val,
                  time: Date.now(),
                  stack: 'set-trap'
                };
                setLog.push(entry);

                if (!reentry && setLog.length === 1) {
                  reentry = true;
                  t[4] = MARKER;
                }
                return Reflect.set(t, prop, val, recv);
              }
            });

            proxy.forEach(function (v, i) {
              proxy[i] = v * 2;
            });

            /* Analisar o log para entender a sequência */
            var logStr = setLog.map(function(e) {
              return e.prop + '=' + e.val;
            }).join('; ');

            /* O valor 19998.0002 = MARKER * 2 sugere que:
             * 1. forEach chega em i=4, v=5
             * 2. proxy[4] = 10 ? set trap chamado com val=10
             * 3. Mas se MARKER foi escrito antes e o C++ cacheou...
             *
             * Se target[4] === MARKER * 2, isso significa que o Reflect.set
             * recebeu MARKER como 'val' e multiplicou? Ou houve dupla escrita?
             */
            if (target[4] !== MARKER && target[4] !== 10) {
              anomalies.push('A: target[4]=' + target[4] + ' (esperado MARKER=' + MARKER +
                ' ou 10). LOG: ' + logStr);
            }
          } catch (e) {
            anomalies.push('A: ' + String(e));
          }
        }());

        /* -- Variante A'': DUPLO MARKER para rastrear ordem --
         * Usa dois marcadores diferentes para rastrear qual escrita "venceu".
         */
        (function variantA_race() {
          try {
            var target  = [1, 2, 3, 4, 5];
            var step    = 0;

            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                step++;
                if (step === 1) {
                  /* Primeira chamada do set trap: escreve MARKER */
                  t[4] = MARKER;
                } else if (step === 2) {
                  /* Segunda chamada: escreve MARKER2 */
                  t[4] = MARKER2;
                }
                return Reflect.set(t, prop, val, recv);
              }
            });

            proxy.forEach(function (v, i) {
              proxy[i] = v * 2;
            });

            /* Se target[4] === 10, o forEach sobrescreveu ambos os MARKERs.
             * Se target[4] === MARKER, o primeiro MARKER "venceu".
             * Se target[4] === MARKER2, o segundo "venceu".
             * Se target[4] === MARKER * 2 ou MARKER2 * 2, há dupla escrita. */
            var expected = [10, MARKER, MARKER2, MARKER * 2, MARKER2 * 2];
            if (expected.indexOf(target[4]) === -1) {
              anomalies.push('A2: target[4]=' + target[4] + ' (steps=' + step +
                ') — valor não esperado em nenhum cenário conhecido');
            }
          } catch (e) {
            anomalies.push('A2: ' + String(e));
          }
        }());

        /* -- Variante E: set trap durante Array.prototype.reverse --
         * reverse() itera de trás para frente, potencialmente mais agressivo
         * para expor races no C++.
         */
        (function variantE() {
          try {
            var target = [1, 2, 3, 4, 5, 6, 7, 8];
            var hit    = false;

            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                if (!hit && prop === '3') {
                  hit = true;
                  /* No meio do reverse, truncar o array */
                  t.length = 3;
                }
                return Reflect.set(t, prop, val, recv);
              }
            });

            proxy.reverse();

            /* Se o C++ não verificou length após a re-entrância,
             * pode ter escrito além do novo length=3 */
            if (target.length !== 3) {
              anomalies.push('E: length não truncado após reverse: ' + target.length);
            }
            for (var i = 3; i < 8; i++) {
              if (target[i] !== undefined) {
                anomalies.push('E: target[' + i + ']=' + target[i] + ' após truncamento');
              }
            }
          } catch (e) {
            if (!(e instanceof TypeError) && !(e instanceof RangeError)) {
              anomalies.push('E: ' + String(e));
            }
          }
        }());

        /* -- Variante F: get trap retornando getter durante sort --
         * Se o C++ cacheia o resultado de get() e o getter muda
         * entre chamadas, pode haver uso de valor stale.
         */
        (function variantF() {
          try {
            var target = [3, 1, 4, 1, 5];
            var calls  = 0;

            var proxy = new Proxy(target, {
              get: function (t, prop, recv) {
                if (prop !== 'length' && !isNaN(Number(prop))) {
                  calls++;
                  /* Retornar valor diferente a cada chamada */
                  return calls;
                }
                return Reflect.get(t, prop, recv);
              }
            });

            proxy.sort(function (x, y) { return x - y; });

            /* Se o sort usou valores cacheados, o resultado será inconsistente.
             * Verificar se o array está em ordem crescente. */
            var sorted = true;
            for (var i = 1; i < target.length; i++) {
              if (target[i] < target[i - 1]) sorted = false;
            }
            if (!sorted) {
              anomalies.push('F: array não ordenado após sort com getter não-determinístico');
            }
          } catch (e) {
            anomalies.push('F: ' + String(e));
          }
        }());

        if (anomalies.length > 0) {
          resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
        } else {
          resolve({ status: 'PASS', detail: 'A-F sem anomalias' });
        }
      });
    }
  };

}(window));