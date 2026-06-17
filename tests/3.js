'use strict';
/**
 * Teste 3 — Proxy: re-entrância via get/set/has traps (v1.2 SANITY)
 *
 * SANITY CHECKS:
 *   - Variante A: Verificar se o valor 19998.0002 é realmente causado
 *     pelo C++ usando o retorno do set trap, ou se é comportamento
 *     esperado do forEach (ele passa o valor atual do array, não o
 *     valor original, para o callback).
 *   - Variante A2: Teste de controle SEM Proxy para comparar.
 *   - Variante E: reverse() + length — verificar se é específico
 *     do reverse() ou afeta outros métodos nativos.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['3'] = {
    id      : 3,
    name    : 'Proxy - re-entrância INVESTIGAÇÃO (v1.2 SANITY)',
    category: 'JSC-Proxy',
    timeout : 6000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];
        var MARKER    = 9999.0001;

        /* ── Variante A: Proxy forEach com logging (original) ── */
        (function variantA() {
          try {
            var target  = [1, 2, 3, 4, 5];
            var setLog  = [];
            var reentry = false;

            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                var entry = { prop: String(prop), val: val, time: Date.now() };
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

            var logStr = setLog.map(function(e) {
              return e.prop + '=' + e.val;
            }).join('; ');

            if (target[4] !== MARKER && target[4] !== 10) {
              anomalies.push('A: target[4]=' + target[4] + ' (esperado MARKER=' + MARKER +
                ' ou 10). LOG: ' + logStr);
            }
          } catch (e) {
            anomalies.push('A: ' + String(e));
          }
        }());

        /* ── Variante A2: CONTROLE SEM PROXY ──
         * SANITY: O forEach passa o valor ATUAL do array para o callback.
         * Se modificarmos target[4] antes de forEach chegar lá, o callback
         * receberá MARKER, não 5. Então target[4] = MARKER * 2 = 19998.0002.
         * Isso é COMPORTAMENTO ESPERADO do forEach — não é bug do Proxy!
         */
        (function variantA2() {
          try {
            var target = [1, 2, 3, 4, 5];

            target.forEach(function (v, i) {
              if (i === 0) {
                target[4] = MARKER; /* Modificar antes de chegar em i=4 */
              }
              target[i] = v * 2;
            });

            /* Se target[4] === MARKER * 2, o forEach COMPORTAMENTO ESPERADO
             * passa o valor atual (MARKER) para o callback, que faz MARKER*2.
             * Se target[4] !== MARKER * 2, o forEach do C++ cacheia o valor
             * original (5) e passa 5 para o callback, resultando em 10. */
            if (target[4] === MARKER * 2) {
              /* Comportamento esperado — NÃO é anomalia */
              /* O forEach passa valor atual, não original */
            } else if (target[4] === 10) {
              /* C++ cacheia valor original — possível bug */
              anomalies.push('A2: forEach SEM Proxy cacheia valor original (target[4]=' + target[4] + ')');
            } else {
              anomalies.push('A2: valor inesperado SEM Proxy: target[4]=' + target[4]);
            }
          } catch (e) {
            anomalies.push('A2: ' + String(e));
          }
        }());

        /* ── Variante A3: CONTROLE COM PROXY SEM RE-ENTRADA ──
         * SANITY: Se o Proxy não re-entra, o forEach deve comportar-se
         * normalmente.
         */
        (function variantA3() {
          try {
            var target = [1, 2, 3, 4, 5];
            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                return Reflect.set(t, prop, val, recv);
              }
            });

            proxy.forEach(function (v, i) {
              proxy[i] = v * 2;
            });

            if (target[4] !== 10) {
              anomalies.push('A3: Proxy sem re-entrada deu target[4]=' + target[4] + ' (esperado 10)');
            }
          } catch (e) {
            anomalies.push('A3: ' + String(e));
          }
        }());

        /* ── Variante B: get 'length' não-determinístico durante map ── */
        (function variantB() {
          try {
            var target  = [1, 2, 3, 4];
            var callNum = 0;

            var proxy = new Proxy(target, {
              get: function (t, prop, recv) {
                if (prop === 'length') {
                  callNum++;
                  return target.length + (callNum % 2);
                }
                return Reflect.get(t, prop, recv);
              }
            });

            var result;
            try {
              result = proxy.map(function (v) { return v * 3; });
            } catch (e2) { return; }

            if (result && result.length > 6) {
              anomalies.push('B: map retornou ' + result.length + ' elementos');
            }
          } catch (e) {
            anomalies.push('B: ' + String(e));
          }
        }());

        /* ── Variante C: has trap durante filter ── */
        (function variantC() {
          try {
            var target = [10, 20, 30, 40, 50];
            var hasLog = [];

            var proxy = new Proxy(target, {
              has: function (t, key) {
                hasLog.push(key);
                if (hasLog.length === 2 && key === '1') {
                  delete t[1];
                }
                return Reflect.has(t, key);
              }
            });

            var result = proxy.filter(function (v) { return v > 15; });
            if (result.indexOf(20) !== -1) {
              anomalies.push('C: elemento deletado via has trap ainda presente: ' + JSON.stringify(result));
            }
          } catch (e) {
            anomalies.push('C: ' + String(e));
          }
        }());

        /* ── Variante D: deleteProperty trap durante fill ── */
        (function variantD() {
          try {
            var target  = new Array(8).fill(0).map(function (_, i) { return i * 1.1; });
            var delLog  = [];

            var proxy = new Proxy(target, {
              defineProperty: function (t, prop, desc) {
                delLog.push(prop);
                if (delLog.length === 3) {
                  delete t[parseInt(prop, 10) + 1];
                }
                return Reflect.defineProperty(t, prop, desc);
              }
            });

            proxy.fill(MARKER, 0, 8);
            var bad = [];
            for (var i = 0; i < 8; i++) {
              if (target[i] !== MARKER) bad.push({ idx: i, val: target[i] });
            }
            if (bad.length > 0) {
              anomalies.push('D: fill incompleto: ' + JSON.stringify(bad));
            }
          } catch (e) {
            anomalies.push('D: ' + String(e));
          }
        }());

        /* ── Variante E: reverse() + length mutation (SANITY) ──
         * Verificar se é específico do reverse() ou afeta outros métodos.
         */
        (function variantE() {
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

        /* ── Variante F: sort() + length mutation (comparar com reverse) ── */
        (function variantF() {
          try {
            var target = [3, 1, 4, 1, 5, 9, 2, 6];
            var hit    = false;

            var proxy = new Proxy(target, {
              set: function (t, prop, val, recv) {
                if (!hit && prop === '2') {
                  hit = true;
                  t.length = 4;
                }
                return Reflect.set(t, prop, val, recv);
              }
            });

            proxy.sort(function (x, y) { return x - y; });

            if (target.length > 4) {
              anomalies.push('F: sort() também ignora length mutation: ' + target.length);
            }
          } catch (e) {
            if (!(e instanceof TypeError)) {
              anomalies.push('F: ' + String(e));
            }
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
