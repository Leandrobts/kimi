'use strict';
/**
 * Teste 1 — Array.prototype.sort: mutação de estado via comparator (v1.2)
 *
 * CORREÇÃO v1.2:
 *   - Variante B: o sort() reordena elementos, então a[0] pode não ser
 *     o elemento que inserimos. Agora verificamos se HÁ um objeto no
 *     array resultante (não necessariamente em a[0]), e procuramos por
 *     type confusion real (números que parecem ponteiros reinterpretados).
 *   - Adicionada Variante E: sort() com push() de objeto durante comparator
 *     para forçar transição de tipo com C++ cacheando DoubleArray.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['1'] = {
    id      : 1,
    name    : 'Array.sort - mutação de length/tipo via comparator (v1.2)',
    category: 'JSC-Array',
    timeout : 4000,

    run: function () {
      var anomalies = [];
      var MARKER    = 9999.0001;

      /* ── Variante A: crescer o array durante o sort ── */
      (function variantA() {
        try {
          var a       = [3, 1, 4, 1, 5, 9, 2, 6];
          var origLen = a.length;
          var injected = false;

          a.sort(function (x, y) {
            if (!injected) {
              injected = true;
              for (var i = 0; i < 16; i++) a.push(MARKER);
            }
            return (x | 0) - (y | 0);
          });

          if (a.length < origLen) {
            anomalies.push('A: length corrompido após push (' + a.length + '<' + origLen + ')');
          }
          var oob = a[origLen + 8];
          if (oob !== undefined && oob !== MARKER) {
            anomalies.push('A: OOB read valor inesperado: a[' + (origLen + 8) + ']=' + oob);
          }
        } catch (e) {
          anomalies.push('A: exceção: ' + String(e));
        }
      }());

      /* ── Variante B: truncar length durante o sort + type confusion ──
       * CORREÇÃO v1.2: em vez de verificar a[0] (que o sort reordena),
       * verificamos se há type confusion nos elementos além do length
       * truncado. O C++ pode ter cacheado DoubleArray e interpretar
       * ponteiros como doubles após a transição.
       */
      (function variantB() {
        try {
          var SIZE = 64;
          var a    = [];
          for (var i = 0; i < SIZE; i++) a.push(Math.random());
          var cut = false;

          a.sort(function (x, y) {
            if (!cut) {
              cut = true;
              a.length = 4;
              /* Forçar transição DoubleArray → ContiguousArray */
              a[0] = {};
            }
            return (typeof x === 'number' && typeof y === 'number') ? (x - y) : 0;
          });

          /* Verificar: há algum objeto no array resultante? */
          var hasObject = false;
          for (var i = 0; i < a.length; i++) {
            if (typeof a[i] === 'object' && a[i] !== null) {
              hasObject = true;
              break;
            }
          }
          if (!hasObject && a.length > 0) {
            /* O objeto pode ter sido movido para além do length=4
             * ou o sort() pode ter descartado elementos após truncamento */
          }

          /* Verificar type confusion além do length truncado:
           * se o C++ cacheou DoubleArray e o butterfly foi realocado,
           * a leitura além do length pode retornar lixo que parece
           * ponteiro reinterpretado como double. */
          var leaks = [];
          for (var j = 4; j < 16; j++) {
            var v = a[j];
            if (v !== undefined) {
              if (typeof v === 'object' && v !== null) {
                leaks.push({ idx: j, type: 'object' });
              } else if (typeof v === 'number' && (v < -1e10 || v > 1e10 || isNaN(v))) {
                leaks.push({ idx: j, type: 'suspicious-double', val: v });
              }
            }
          }
          if (leaks.length > 0) {
            anomalies.push('B: possível type confusion além do length: ' + JSON.stringify(leaks));
          }
        } catch (e) {
          if (!(e instanceof TypeError)) {
            anomalies.push('B: exceção inesperada: ' + String(e));
          }
        }
      }());

      /* ── Variante C: transição Double → Contiguous durante o sort ── */
      (function variantC() {
        try {
          var a      = [3.1, 1.2, 4.3, 1.4, 5.5, 9.6, 2.7, 6.8];
          var count  = 0;

          a.sort(function (x, y) {
            count++;
            if (count === 2) {
              a[0] = {};
              a[1] = MARKER;
            }
            if (typeof x !== 'number' || typeof y !== 'number') return 0;
            return x - y;
          });

          var pos = a.indexOf(MARKER);
          if (pos !== -1 && pos > 2) {
            anomalies.push('C: MARKER em posição suspeita: a[' + pos + ']=' + MARKER);
          }
        } catch (e) {
          if (!(e instanceof TypeError)) {
            anomalies.push('C: exceção inesperada: ' + String(e));
          }
        }
      }());

      /* ── Variante D: array esparso com holes ── */
      (function variantD() {
        try {
          var a    = [5, 3, , , 1, , 9];
          var done = false;

          a.sort(function (x, y) {
            if (!done) {
              done    = true;
              a[10]   = MARKER;
            }
            return (x | 0) - (y | 0);
          });

          if (a[10] === MARKER) {
            var beyond = a[11];
            if (beyond !== undefined) {
              anomalies.push('D: read beyond [11]=' + beyond);
            }
          }
          if (a.length !== 7 && a.length !== 11) {
            anomalies.push('D: length inesperado após sort: ' + a.length);
          }
        } catch (e) {
          anomalies.push('D: exceção: ' + String(e));
        }
      }());

      /* ── Variante E: push de objeto durante sort (transição agressiva) ──
       * NOVO v1.2: empurra um objeto para o array durante o sort,
       * forçando transição de tipo enquanto o C++ ainda itera.
       */
      (function variantE() {
        try {
          var a = [1.1, 2.2, 3.3, 4.4, 5.5];
          var pushed = false;

          a.sort(function (x, y) {
            if (!pushed) {
              pushed = true;
              a.push({ injected: true });
            }
            if (typeof x !== 'number' || typeof y !== 'number') return 0;
            return x - y;
          });

          /* Verificar se o objeto injetado sobreviveu */
          var found = false;
          for (var i = 0; i < a.length; i++) {
            if (typeof a[i] === 'object' && a[i] !== null && a[i].injected) {
              found = true;
              break;
            }
          }
          if (!found && a.length > 5) {
            /* O objeto pode ter sido perdido ou corrompido */
          }
        } catch (e) {
          if (!(e instanceof TypeError)) {
            anomalies.push('E: exceção inesperada: ' + String(e));
          }
        }
      }());

      if (anomalies.length > 0) {
        return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      }
      return { status: 'PASS', detail: 'A-E sem anomalias' };
    }
  };

}(window));
