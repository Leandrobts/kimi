'use strict';
/**
 * Teste 1 — Array.prototype.sort: mutação de estado via comparator
 *
 * CORREÇÕES v1.1:
 *   - Variante B: adicionado GC pressure + verificação de type confusion
 *     em vez de simplesmente detectar lixo de memória não zerado.
 *   - Variante B agora verifica se valores lidos além do length truncado
 *     são números (esperado) vs objetos/ponteiros (type confusion real).
 *   - Variante D: adicionada verificação de corrupção de length após
 *     escrita em array esparso.
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['1'] = {
    id      : 1,
    name    : 'Array.sort — mutação de length/tipo via comparator (v1.1)',
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

      /* ── Variante B: truncar length durante o sort ──
       * CORREÇÃO v1.1: em vez de detectar lixo de memória (falso positivo),
       * verificamos type confusion: se o butterfly foi realocado e o C++
       * continua usando o antigo, podemos ver objetos onde deveriam haver
       * números (DoubleArray → ContiguousArray confusion).
       *
       * Estratégia: truncar, depois forçar transição de tipo no array.
       * Se o C++ cacheou o tipo DoubleArray, o acesso a elementos
       * "mortos" pode interpretar ponteiros JS como doubles (leak) ou
       * vice-versa (crash/type confusion).
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
            /* Comparador numérico — se o C++ ainda pensa que é DoubleArray,
             * pode crashar ou retornar lixo ao comparar {} */
            return (typeof x === 'number' && typeof y === 'number') ? (x - y) : 0;
          });

          /* Verificar: o array resultante tem o tipo correto? */
          if (typeof a[0] !== 'object') {
            anomalies.push('B: a[0] deveria ser objeto após transição, é: ' + typeof a[0]);
          }

          /* Tentar ler além do length truncado — procurar por type confusion
           * (números que parecem ponteiros, ou objetos inesperados) */
          var leaks = [];
          for (var j = 4; j < 16; j++) {
            var v = a[j];
            if (v !== undefined) {
              /* Se encontramos algo além do length, verificar se é type confusion */
              if (typeof v === 'object' && v !== null) {
                leaks.push({ idx: j, type: 'object' });
              } else if (typeof v === 'number' && (v < -1e10 || v > 1e10 || isNaN(v))) {
                /* Double que parece pointer reinterpretado */
                leaks.push({ idx: j, type: 'suspicious-double', val: v });
              }
            }
          }
          if (leaks.length > 0) {
            anomalies.push('B: possível type confusion além do length: ' + JSON.stringify(leaks));
          }
        } catch (e) {
          /* TypeError ao comparar {} é esperado em alguns casos */
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

      /* ── Variante D: array esparso com holes + corrupção de length ── */
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
          /* Verificar se o length foi corrompido */
          if (a.length !== 7 && a.length !== 11) {
            anomalies.push('D: length inesperado após sort: ' + a.length);
          }
        } catch (e) {
          anomalies.push('D: exceção: ' + String(e));
        }
      }());

      if (anomalies.length > 0) {
        return { status: 'ANOMALY', detail: anomalies.join(' | ') };
      }
      return { status: 'PASS', detail: 'A-D sem anomalias' };
    }
  };

}(window));