'use strict';
/**
 * Teste 2 — Array.prototype.splice: type confusion via valueOf / Symbol.toPrimitive
 *
 * Base: bugs 2B-2D confirmados em FW 13.50.
 * O JSC cacheia o length do array ANTES de avaliar os argumentos numéricos de splice.
 * valueOf / Symbol.toPrimitive podem disparar a transição DoubleArray→ContiguousArray
 * durante a avaliação desses argumentos, enquanto o C++ ainda usa o length/type cacheado.
 *
 * Variantes:
 *   A — splice(start, magicObj) onde valueOf faz arr[0] = {} (transição)
 *   B — splice(magicStart, 1) onde valueOf faz push({}) (expande + transição)
 *   C — splice com Symbol.toPrimitive disparando unshift({})
 *   D — concat com Symbol.isConcatSpreadable + valueOf no .length
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['2'] = {
    id      : 2,
    name    : 'Array.splice — type confusion via valueOf (DoubleArray→ContiguousArray)',
    category: 'JSC-Array',
    timeout : 4000,

    run: function () {
      var anomalies = [];
      var MARKER    = 9999.0001;

      /* ── Variante A: deleteCount via valueOf força transição ── */
      (function variantA() {
        try {
          var arr       = [1.1, 2.2, 3.3, 4.4, 5.5]; // DoubleArray
          var triggered = false;
          var delCount  = {
            valueOf: function () {
              if (!triggered) {
                triggered = true;
                arr[0] = {}; // DoubleArray → ContiguousArray durante avaliação
              }
              return 2;
            }
          };

          var removed = arr.splice(1, delCount);

          /* Sanidade: splice(1, 2) de 5 elementos => 3 restantes */
          if (arr.length !== 3) {
            anomalies.push('A: length pós-splice inesperado: ' + arr.length);
          }
          /* Verificar se o objeto inserido (arr[0]) sobreviveu corretamente */
          if (typeof arr[0] !== 'object' && arr[0] !== undefined) {
            anomalies.push('A: arr[0] deveria ser {}, encontrado: ' + typeof arr[0]);
          }
        } catch (e) {
          if (!(e instanceof TypeError)) {
            anomalies.push('A: exceção inesperada: ' + String(e));
          }
        }
      }());

      /* ── Variante B: startIndex via valueOf expande o array ── */
      (function variantB() {
        try {
          var arr   = [1.1, 2.2, 3.3, 4.4]; // DoubleArray, length=4
          var fired = false;
          var startIdx = {
            valueOf: function () {
              if (!fired) {
                fired = true;
                arr.push({}); // transição + length vira 5
                arr.push(MARKER);
              }
              return 0;
            }
          };

          arr.splice(startIdx, 1);

          /* JSC cacheou length=4 antes do valueOf?
           * Se sim, splice processou [0..3] enquanto [4] e [5] ficam órfãos */
          if (arr.length > 5) {
            anomalies.push('B: length corrompido após splice: ' + arr.length);
          }

          /* Tentar ler além do length reportado */
          var oob = arr[arr.length];
          if (oob === MARKER || oob !== undefined) {
            anomalies.push('B: OOB read em arr[' + arr.length + ']=' + oob);
          }
        } catch (e) {
          if (!(e instanceof TypeError) && !(e instanceof RangeError)) {
            anomalies.push('B: exceção inesperada: ' + String(e));
          }
        }
      }());

      /* ── Variante C: Symbol.toPrimitive + unshift durante splice ── */
      (function variantC() {
        if (typeof Symbol === 'undefined' || !Symbol.toPrimitive) return;
        try {
          var arr = [1.1, 2.2, 3.3]; // DoubleArray, length=3
          var obj = Object.create(null);
          obj[Symbol.toPrimitive] = function (hint) {
            if (hint === 'number') {
              arr.unshift({}); // ContiguousArray, length vira 4
            }
            return 1;
          };

          arr.splice(obj, obj);

          if (arr.length < 0 || !isFinite(arr.length)) {
            anomalies.push('C: length inválido pós-splice: ' + arr.length);
          }
        } catch (e) {
          if (!(e instanceof TypeError) && !(e instanceof RangeError)) {
            anomalies.push('C: exceção inesperada: ' + String(e));
          }
        }
      }());

      /* ── Variante D: concat + Symbol.isConcatSpreadable + valueOf no length ── */
      (function variantD() {
        if (typeof Symbol === 'undefined' || !Symbol.isConcatSpreadable) return;
        try {
          var arr = [1.1, 2.2, 3.3]; // DoubleArray

          var fakeSpreadable = {
            length: {
              valueOf: function () {
                /* Durante a avaliação do .length para concat, corrompe arr */
                arr[0] = {}; // força transição
                return 3;
              },
              toString: function () { return '3'; }
            }
          };
          fakeSpreadable[Symbol.isConcatSpreadable] = true;
          fakeSpreadable[0] = 'a';
          fakeSpreadable[1] = 'b';
          fakeSpreadable[2] = 'c';

          var result = arr.concat(fakeSpreadable);

          /* length esperado: 3 + 3 = 6 */
          if (result.length !== 6) {
            anomalies.push('D: concat retornou ' + result.length + ' elementos (esperado 6)');
          }
        } catch (e) {
          if (!(e instanceof TypeError)) {
            anomalies.push('D: exceção inesperada: ' + String(e));
          }
        }
      }());

      /* ── Resultado ── */
      if (anomalies.length > 0) {
        return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      }
      return { status: 'PASS', detail: 'A-D sem anomalias' };
    }
  };

}(window));