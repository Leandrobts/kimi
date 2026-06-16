'use strict';
/**
 * Logger — saída colorida no #log com timestamp ISO.
 *
 * Uso:
 *   Logger.init('log')          // chama uma vez em runner.js
 *   Logger.pass(tid, msg, detail)
 *   Logger.anomaly(tid, msg, detail)
 *   Logger.export()             // retorna JSON dos entries
 */
(function (global) {

  var COLORS = {
    INFO   : '#9090a0',
    PASS   : '#22cc55',
    FAIL   : '#ff8800',
    ANOMALY: '#ff3030',
    TIMEOUT: '#ff00ee',
    CRASH  : '#ff00ee'
  };

  var _el      = null;
  var _entries = [];

  function _append(lvl, tid, msg, detail) {
    var entry = {
      ts    : Date.now(),
      lvl   : lvl,
      tid   : tid,
      msg   : msg,
      detail: detail || null
    };
    _entries.push(entry);

    if (!_el) return;

    var row = document.createElement('div');
    row.style.cssText =
      'font-family:monospace;font-size:12px;padding:1px 4px;' +
      'border-bottom:1px solid #1a1a1a;color:' + (COLORS[lvl] || '#ccc');

    var ts    = new Date(entry.ts).toISOString().slice(11, 23);
    var tidFmt = String(tid).padEnd(4);
    row.textContent =
      '[' + ts + '] [' + lvl.padEnd(7) + '] [' + tidFmt + '] ' +
      msg + (detail ? '  →  ' + detail : '');

    _el.appendChild(row);
    _el.scrollTop = _el.scrollHeight;
  }

  global.Logger = {
    init   : function (id) { _el = document.getElementById(id); },
    clear  : function ()   { _entries = []; if (_el) _el.innerHTML = ''; },

    info   : function (tid, msg, d) { _append('INFO',    tid, msg, d); },
    pass   : function (tid, msg, d) { _append('PASS',    tid, msg, d); },
    fail   : function (tid, msg, d) { _append('FAIL',    tid, msg, d); },
    anomaly: function (tid, msg, d) { _append('ANOMALY', tid, msg, d); },
    timeout: function (tid, msg, d) { _append('TIMEOUT', tid, msg, d); },
    crash  : function (tid, msg, d) { _append('CRASH',   tid, msg, d); },

    /** Retorna JSON com todos os entries para exportar */
    export: function () { return JSON.stringify(_entries, null, 2); }
  };

}(window));
