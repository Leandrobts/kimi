'use strict';
/**
 * Teste 1 — Array.prototype.sort: mutação de estado via comparator
 *
 * Base: bug confirmado em FW 13.50 onde o C++ cacheia o length antes do sort
 * e o comparator pode crescer/encolher o array sem que o loop nativo saiba.
 *
 * Variantes:
 *   A — push de extras durante o sort (length cresce)
 *   B — truncar length durante o sort (butterfly pode ter elementos "mortos")
 *   C — transição de tipo (Double → Contiguous) durante o sort
 *   D — array esparso com holes, escrita além do length original
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['1'] = {
    id      : 1,
    name    : 'Array.sort — mutação de length/tipo via comparator',
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

          /* O C++ pode ter usado o length original (8) e deixado
           * os 16 extras no butterfly sem fazer parte do resultado.
           * Se a[8] ou a[9] ainda valhem MARKER, o acesso está ok;
           * se o length ficou abaixo de 8, temos corrupção. */
          if (a.length < origLen) {
            anomalies.push('A: length corrompido após push (' + a.length + '<' + origLen + ')');
          }
          /* Leitura além do length original percebido — comparar com MARKER */
          var oob = a[origLen + 8];
          if (oob !== undefined && oob !== MARKER) {
            anomalies.push('A: OOB read valor inesperado: a[' + (origLen + 8) + ']=' + oob);
          }
        } catch (e) {
          anomalies.push('A: exceção: ' + String(e));
        }
      }());

      /* ── Variante B: truncar o array durante o sort ── */
      (function variantB() {
        try {
          var SIZE = 64;
          var a    = [];
          for (var i = 0; i < SIZE; i++) a.push(Math.random());
          var cut = false;

          a.sort(function (x, y) {
            if (!cut) { cut = true; a.length = 4; }
            return x - y;
          });

          /* Após truncar para 4, tentar ler posições 4..15 */
          var leaks = [];
          for (var j = 4; j < 16; j++) {
            var v = a[j];
            if (v !== undefined) leaks.push({ idx: j, val: v });
          }
          if (leaks.length > 0) {
            anomalies.push('B: leitura além do length truncado: ' + JSON.stringify(leaks));
          }
        } catch (e) {
          anomalies.push('B: exceção: ' + String(e));
        }
      }());

      /* ── Variante C: transição Double → Contiguous durante o sort ── */
      (function variantC() {
        try {
          var a      = [3.1, 1.2, 4.3, 1.4, 5.5, 9.6, 2.7, 6.8]; // DoubleArray
          var count  = 0;

          a.sort(function (x, y) {
            count++;
            if (count === 2) {
              a[0] = {};     // força transição → ContiguousArray
              a[1] = MARKER; // marcador de posição conhecida
            }
            /* comparador permissivo para não lançar TypeError */
            if (typeof x !== 'number' || typeof y !== 'number') return 0;
            return x - y;
          });

          /* Verificar: o MARKER chegou a posição errada? */
          var pos = a.indexOf(MARKER);
          if (pos !== -1 && pos > 2) {
            /* Suspeito: MARKER deveria estar no topo com sort numérico */
            anomalies.push('C: MARKER em posição suspeita: a[' + pos + ']=' + MARKER);
          }
        } catch (e) {
          /* TypeError ao comparar {} é esperado — não é anomalia */
          if (!(e instanceof TypeError)) {
            anomalies.push('C: exceção inesperada: ' + String(e));
          }
        }
      }());

      /* ── Variante D: array esparso com holes ── */
      (function variantD() {
        try {
          /* eslint-disable no-sparse-arrays */
          var a    = [5, 3, , , 1, , 9]; // length=7 com holes
          var done = false;

          a.sort(function (x, y) {
            if (!done) {
              done    = true;
              a[10]   = MARKER; // escreve além do comprimento original
            }
            return (x | 0) - (y | 0);
          });

          if (a[10] === MARKER) {
            /* Array expandiu — verificar se há leitura além do novo boundary */
            var beyond = a[11];
            if (beyond !== undefined) {
              anomalies.push('D: read beyond [11]=' + beyond);
            }
          }
        } catch (e) {
          anomalies.push('D: exceção: ' + String(e));
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