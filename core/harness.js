'use strict';
/**
 * Harness — executa um objeto-teste com timeout e captura erros globais.
 *
 * Interface esperada de cada teste:
 *   {
 *     id      : Number,
 *     name    : String,
 *     category: String,
 *     timeout : Number  (ms, default 5000),
 *     run     : function() -> {status, detail} | Promise<{status, detail}>
 *   }
 *
 * Harness.exec(test) -> Promise<{ status, detail, ms }>
 *   status: 'PASS' | 'FAIL' | 'ANOMALY' | 'TIMEOUT' | 'CRASH'
 */
(function (global) {

  global.Harness = {

    exec: function (test) {
      var tMax = (test.timeout || 5000);
      var t0   = Date.now();

      return new Promise(function (resolve) {
        var settled    = false;
        var timerId    = null;
        var errHandler = null;

        function settle(status, detail) {
          if (settled) return;
          settled = true;
          clearTimeout(timerId);
          window.removeEventListener('error', errHandler);
          resolve({
            status: status,
            detail: detail || '',
            ms    : Date.now() - t0
          });
        }

        /* Timeout global do teste */
        timerId = setTimeout(function () {
          settle('TIMEOUT', 'excedeu ' + tMax + 'ms');
        }, tMax);

        /* Captura erros não-tratados que vazam para window */
        errHandler = function (e) {
          settle('CRASH', (e.message || 'error') +
            ' (' + (e.filename || '?') + ':' + (e.lineno || '?') + ')');
        };
        window.addEventListener('error', errHandler);

        /* Execução */
        try {
          var ret = test.run();

          if (ret && typeof ret.then === 'function') {
            /* Async */
            ret
              .then(function (r) {
                settle((r && r.status) || 'PASS', r && r.detail);
              })
              .catch(function (e) {
                settle('FAIL', String(e));
              });
          } else {
            /* Sync */
            settle((ret && ret.status) || 'PASS', ret && ret.detail);
          }
        } catch (e) {
          settle('FAIL', String(e));
        }
      });
    }

  };

}(window));
