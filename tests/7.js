'use strict';
/**
 * Teste 7 — WeakRef / FinalizationRegistry: GC pressure e lifetime de objetos
 *
 * O diagnóstico confirma: weakRef: true, weakMap: true.
 * FinalizationRegistry pode não estar presente no WebKit 605.1.15 — verificado em runtime.
 *
 * WeakRef.deref() deve retornar undefined após o objeto ser coletado pelo GC.
 * No PS4 sem JIT, o GC usa um modelo mark-sweep conservador sem gerações explícitas.
 * Pressão de memória é a forma confiável de induzir coleta.
 *
 * Variantes:
 *   A — WeakRef para objeto grande: criar, soltar referência forte, GC pressure, verificar deref()
 *   B — WeakRef para nó DOM: criar, adicionar ao DOM, remover, GC pressure, verificar deref()
 *   C — WeakMap: chave DOM removida do DOM sob GC — entry deve ser removida do mapa
 *   D — FinalizationRegistry (se disponível): registrar, coletar, verificar callback
 *   E — WeakRef em closure retornada de função: garantir que o objeto não escapa
 *   F — deref() em loop com re-alocação: comportamento estável sem crash
 */
(function (global) {
  global.FuzzerTests = global.FuzzerTests || {};

  global.FuzzerTests['7'] = {
    id      : 7,
    name    : 'WeakRef/FinalizationRegistry — GC pressure, DOM nodes, WeakMap key lifecycle',
    category: 'GC',
    timeout : 8000,

    run: function () {
      return new Promise(function (resolve) {
        var anomalies = [];

        /* ── Utilitário: pressionar o GC alocando e descartando objetos grandes ── */
        function pressureGC(rounds) {
          for (var i = 0; i < rounds; i++) {
            /* Alocar ~1MB por round e deixar cair imediatamente */
            void new Array(250000).fill(i);
          }
        }

        /* ── Variante A: WeakRef para objeto JS grande ── */
        (function variantA() {
          try {
            var ref;
            (function () {
              /* Objeto grande criado em escopo isolado — nenhuma referência forte escapa */
              var obj = { data: new Array(50000).fill(0xDEAD), id: 'variantA-target' };
              ref = new WeakRef(obj);
              /* obj sai de escopo aqui */
            }());

            /* Antes da GC pressure, deref() ainda pode retornar o objeto */
            var beforeGC = ref.deref();
            if (beforeGC === undefined) {
              /* Coletado já — incomum mas possível */
              anomalies.push('A: objeto coletado antes de qualquer GC pressure (inesperado)');
            }

            pressureGC(40);

            /* Após pressure, deref() PODE retornar undefined — comportamento correto.
             * Não registramos como anomalia se retornar o objeto (GC não obrigado a coletar).
             * Registramos apenas comportamentos inválidos. */
            var afterGC = ref.deref();
            if (afterGC !== undefined && afterGC.id !== 'variantA-target') {
              /* Retornou algo, mas não é o objeto original — corrupção */
              anomalies.push('A: deref() retornou objeto com id errado: ' + afterGC.id);
            }
          } catch (e) {
            anomalies.push('A: ' + String(e));
          }
        }());

        /* ── Variante B: WeakRef para nó DOM removido ── */
        (function variantB() {
          try {
            var ref;
            var container = document.createElement('div');
            document.body.appendChild(container);

            (function () {
              var el = document.createElement('span');
              el.textContent = 'weakref-target';
              container.appendChild(el);
              ref = new WeakRef(el);
              /* Remover do DOM — o nó não tem mais referência forte no documento */
              container.removeChild(el);
              /* el sai de escopo aqui */
            }());

            document.body.removeChild(container);

            pressureGC(30);

            var after = ref.deref();
            /* Se não foi coletado, verificar pelo menos que o nó ainda é válido */
            if (after !== undefined) {
              /* Nó deve estar desanexado */
              if (after.isConnected) {
                anomalies.push('B: nó DOM deveria estar desanexado mas isConnected=true');
              }
              /* Tentar operar sobre o nó — não deve crashar */
              try {
                void after.textContent;
                void after.parentNode;
              } catch (e2) {
                anomalies.push('B: operação em nó DOM via WeakRef lançou: ' + String(e2));
              }
            }
          } catch (e) {
            anomalies.push('B: ' + String(e));
          }
        }());

        /* ── Variante C: WeakMap com chave DOM removida ── */
        (function variantC() {
          try {
            var map  = new WeakMap();
            var keys = [];

            /* Criar 50 nós DOM, cada um com dado associado no WeakMap */
            for (var i = 0; i < 50; i++) {
              var el = document.createElement('div');
              map.set(el, { index: i, payload: new Array(1000).fill(i) });
              keys.push(el);
            }

            /* Verificar que todos existem antes de soltar */
            for (var i = 0; i < keys.length; i++) {
              if (!map.has(keys[i])) {
                anomalies.push('C: WeakMap perdeu chave[' + i + '] prematuramente');
                break;
              }
            }

            /* Soltar todas as referências fortes */
            keys = null;
            pressureGC(30);

            /* Não podemos iterar WeakMap (por design), então verificamos que
             * o mapa não é uma referência indefinida e não crashou */
            try {
              /* Tentar set/get com chave nova deve ainda funcionar */
              var newKey = {};
              map.set(newKey, 'alive');
              if (map.get(newKey) !== 'alive') {
                anomalies.push('C: WeakMap.get() retornou valor errado após GC pressure');
              }
              map.delete(newKey);
            } catch (e2) {
              anomalies.push('C: WeakMap corrompido após GC pressure: ' + String(e2));
            }
          } catch (e) {
            anomalies.push('C: ' + String(e));
          }
        }());

        /* ── Variante D: FinalizationRegistry (se disponível) ── */
        (function variantD() {
          if (typeof FinalizationRegistry === 'undefined') {
            /* Não disponível neste firmware — pular silenciosamente */
            return;
          }
          try {
            var callbackLog = [];
            var reg = new FinalizationRegistry(function (token) {
              callbackLog.push(token);
            });

            (function () {
              var obj = { data: new Array(100000).fill(0xFF), tag: 'fin-target' };
              reg.register(obj, 'fin-token-1');
              /* obj sai de escopo */
            }());

            pressureGC(50);

            /* O callback de finalização é chamado assincronamente — checar apenas
             * que o mecanismo não crashou. O callback pode ou não ter disparado
             * dentro deste timeout. */
            setTimeout(function () {
              /* Se o callback foi chamado, verificar que o token é correto */
              callbackLog.forEach(function (token) {
                if (token !== 'fin-token-1') {
                  anomalies.push('D: FinalizationRegistry token incorreto: ' + token);
                }
              });
            }, 100);
          } catch (e) {
            anomalies.push('D: ' + String(e));
          }
        }());

        /* ── Variante E: WeakRef em closure — garantir que referência não escapa ── */
        (function variantE() {
          try {
            function makeWeakHolder(value) {
              var inner = { secret: value, bulk: new Array(20000).fill(value) };
              var ref   = new WeakRef(inner);
              /* inner sai de escopo da função */
              return ref;
            }

            var refs = [];
            for (var i = 0; i < 20; i++) {
              refs.push(makeWeakHolder(i * 1000));
            }

            pressureGC(40);

            /* Verificar que deref() não retorna valores cruzados (corrupção de heap) */
            for (var i = 0; i < refs.length; i++) {
              var obj = refs[i].deref();
              if (obj !== undefined) {
                /* Se ainda vivo, o secret deve bater */
                var expected = i * 1000;
                if (obj.secret !== expected) {
                  anomalies.push('E: ref[' + i + '] secret corrompido: esperado ' + expected + ' encontrado ' + obj.secret);
                }
              }
            }
          } catch (e) {
            anomalies.push('E: ' + String(e));
          }
        }());

        /* ── Variante F: deref() em loop com re-alocação simultânea ── */
        (function variantF() {
          try {
            var refs  = [];
            var BATCH = 100;

            /* Criar batch de WeakRefs e soltar imediatamente */
            (function () {
              for (var i = 0; i < BATCH; i++) {
                refs.push(new WeakRef({ idx: i, data: new Array(500).fill(i) }));
              }
              /* Objetos saem de escopo aqui */
            }());

            /* Loop de deref() enquanto aloca memória nova ao mesmo tempo */
            var errors = 0;
            for (var round = 0; round < 10; round++) {
              /* Alocar novo objeto por round — pressão contínua */
              void new Array(50000).fill(round);

              for (var i = 0; i < refs.length; i++) {
                try {
                  var v = refs[i].deref();
                  if (v !== undefined && typeof v.idx !== 'number') {
                    errors++;
                  }
                } catch (e2) {
                  errors++;
                }
              }
            }

            if (errors > 0) {
              anomalies.push('F: ' + errors + ' erros em deref() durante re-alocação');
            }
          } catch (e) {
            anomalies.push('F: ' + String(e));
          }
        }());

        /* ── Resolver após GC pressure + callbacks async ── */
        setTimeout(function () {
          if (anomalies.length > 0) {
            resolve({ status: 'ANOMALY', detail: anomalies.join(' | ') });
          } else {
            resolve({ status: 'PASS', detail: 'A-F sem anomalias' });
          }
        }, 1500);
      });
    }
  };

}(window));
