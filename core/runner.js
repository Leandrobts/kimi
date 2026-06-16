'use strict';
/**
 * Runner — orquestra a execução dos testes.
 *
 * Funcionalidades:
 *  - Detecta crash real (browser reinicializou durante um teste) via localStorage
 *  - Worker de heartbeat para detectar freeze do thread principal
 *  - Stop on anomaly/crash configurável
 *  - Export do log em JSON
 */
(function (global) {

  /* ─── Constantes ─────────────────────────────────────────────── */
  var LS_KEY  = 'ps4fuzz_active_test'; // crash recovery key
  var PING_MS = 400;                   // intervalo do heartbeat

  /* ─── Estado ─────────────────────────────────────────────────── */
  var _aborted       = false;
  var _stopOnAnomaly = false;
  var _heartbeat     = null;
  var _pingTimer     = null;

  /* ─── Crash recovery ─────────────────────────────────────────── */
  function checkCrashRecovery() {
    try {
      var saved = localStorage.getItem(LS_KEY);
      if (saved) {
        var info = JSON.parse(saved);
        Logger.crash('SYS',
          'CRASH DETECTADO NO TESTE ANTERIOR',
          'testId=' + info.id + ' name="' + info.name + '" startedAt=' + info.ts
        );
        localStorage.removeItem(LS_KEY);
      }
    } catch (e) { /* localStorage indisponível — ignorar */ }
  }

  function markTestStart(test) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        id  : test.id,
        name: test.name,
        ts  : new Date().toISOString()
      }));
    } catch (e) {}
  }

  function markTestEnd() {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
  }

  /* ─── Heartbeat Worker ────────────────────────────────────────── */
  function startHeartbeat() {
    try {
      _heartbeat = new Worker('workers/heartbeat.js');
      _heartbeat.onmessage = function (e) {
        if (e.data && e.data.type === 'freeze') {
          Logger.anomaly('SYS',
            'FREEZE detectado pelo heartbeat worker',
            'delta=' + e.data.delta + 'ms'
          );
        }
      };
      _pingTimer = setInterval(function () {
        _heartbeat.postMessage('ping');
      }, PING_MS);
      Logger.info('SYS', 'Heartbeat worker ativo');
    } catch (e) {
      Logger.info('SYS', 'Heartbeat worker indisponível: ' + String(e));
    }
  }

  /* ─── Construção da UI ────────────────────────────────────────── */
  function buildTestList() {
    var tests = global.FuzzerTests || {};
    var ids   = Object.keys(tests).sort(function (a, b) { return Number(a) - Number(b); });

    var listEl = document.getElementById('test-list');
    if (!listEl) return;

    listEl.innerHTML = '<h3>Testes carregados: ' + ids.length + '</h3>';

    ids.forEach(function (id) {
      var t   = tests[id];
      var row = document.createElement('div');

      var chk      = document.createElement('input');
      chk.type     = 'checkbox';
      chk.id       = 'chk-t-' + id;
      chk.checked  = true;
      chk.dataset.tid = id;

      var lbl           = document.createElement('label');
      lbl.htmlFor       = chk.id;
      lbl.style.marginLeft = '6px';
      lbl.textContent   =
        '[' + id + '] ' + t.name +
        '  [' + t.category + ']' +
        '  timeout:' + (t.timeout || 5000) + 'ms';

      row.appendChild(chk);
      row.appendChild(lbl);
      listEl.appendChild(row);
    });

    /* Checkbox "Todos" */
    document.getElementById('chk-all').onchange = function () {
      var chks = document.querySelectorAll('[id^="chk-t-"]');
      for (var i = 0; i < chks.length; i++) chks[i].checked = this.checked;
    };
  }

  function getSelectedIds() {
    var chks = document.querySelectorAll('[id^="chk-t-"]:checked');
    var ids  = [];
    for (var i = 0; i < chks.length; i++) ids.push(chks[i].dataset.tid);
    return ids.sort(function (a, b) { return Number(a) - Number(b); });
  }

  function setStatus(msg) {
    var el = document.getElementById('status-bar');
    if (el) el.textContent = msg;
  }

  /* ─── Loop de execução ───────────────────────────────────────── */
  function runTests(ids) {
    _aborted = false;
    var tests   = global.FuzzerTests || {};
    var total   = ids.length;
    var counts  = { PASS: 0, FAIL: 0, ANOMALY: 0, CRASH: 0, TIMEOUT: 0 };

    Logger.info('SYS', '── Início da sessão ── ' + total + ' teste(s) selecionado(s)');
    setStatus('Executando...');

    /* Sequência assíncrona via Promise recursiva (sem async/await) */
    var idx = 0;

    function next() {
      if (_aborted || idx >= ids.length) {
        var summary =
          'PASS:' + counts.PASS +
          ' FAIL:' + counts.FAIL +
          ' ANOMALY:' + counts.ANOMALY +
          ' CRASH:' + counts.CRASH +
          ' TIMEOUT:' + counts.TIMEOUT;
        Logger.info('SYS', '── Fim da sessão ── ' + summary);
        setStatus('Concluído — ' + summary);
        return Promise.resolve();
      }

      var id   = ids[idx++];
      var test = tests[id];
      if (!test) return next();

      Logger.info(id, 'START: ' + test.name);
      markTestStart(test);

      return Harness.exec(test).then(function (r) {
        markTestEnd();

        if (counts[r.status] !== undefined) counts[r.status]++;

        var detail = r.ms + 'ms' + (r.detail ? '  |  ' + r.detail : '');
        switch (r.status) {
          case 'PASS'   : Logger.pass(id, 'OK', detail);                         break;
          case 'FAIL'   : Logger.fail(id, 'FALHA: ' + r.detail, r.ms + 'ms');   break;
          case 'ANOMALY': Logger.anomaly(id, 'ANOMALIA: ' + r.detail, r.ms + 'ms'); break;
          case 'CRASH'  : Logger.crash(id, 'CRASH: ' + r.detail, r.ms + 'ms');  break;
          case 'TIMEOUT': Logger.timeout(id, 'TIMEOUT', r.detail);               break;
          default       : Logger.info(id, r.status, detail);
        }

        if (_stopOnAnomaly &&
            (r.status === 'ANOMALY' || r.status === 'CRASH')) {
          Logger.info('SYS', 'Stop-on-anomaly ativado — parando.');
          _aborted = true;
        }

        /* Pausa entre testes para GC / DOM cleanup */
        return new Promise(function (res) { setTimeout(res, 80); }).then(next);
      });
    }

    return next().catch(function (e) {
      Logger.crash('SYS', 'Erro fatal no runner: ' + String(e));
      setStatus('Erro fatal no runner');
    });
  }

  /* ─── Inicialização ──────────────────────────────────────────── */
  function init() {
    Logger.init('log');
    checkCrashRecovery();
    startHeartbeat();
    buildTestList();

    document.getElementById('btn-run-all').onclick = function () {
      var tests = global.FuzzerTests || {};
      var ids   = Object.keys(tests).sort(function (a, b) { return Number(a) - Number(b); });
      runTests(ids);
    };

    document.getElementById('btn-run-selected').onclick = function () {
      runTests(getSelectedIds());
    };

    document.getElementById('btn-stop').onclick = function () {
      _aborted = true;
      setStatus('Abortando...');
    };

    document.getElementById('btn-clear').onclick = function () {
      Logger.clear();
      setStatus('Log limpo.');
    };

    document.getElementById('btn-export').onclick = function () {
      var data = Logger.export();
      try {
        /* Tenta download via Blob */
        var blob = new Blob([data], { type: 'application/json' });
        var a    = document.createElement('a');
        a.href   = URL.createObjectURL(blob);
        a.download = 'fuzz-' + Date.now() + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (e) {
        /* Fallback: exibe em textarea */
        var ta          = document.createElement('textarea');
        ta.style.cssText = 'width:100%;height:120px;font-size:10px;background:#000;color:#0f0';
        ta.value        = data;
        document.getElementById('log').parentNode.insertBefore(ta, document.getElementById('log'));
      }
    };

    document.getElementById('chk-stop-on-anomaly').onchange = function () {
      _stopOnAnomaly = this.checked;
    };

    setStatus('Pronto. ' + Object.keys(global.FuzzerTests || {}).length + ' teste(s) carregado(s).');
    Logger.info('SYS', 'Fuzzer inicializado — FW alvo: PS4 13.50 / WebKit 605.1.15');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}(window));
