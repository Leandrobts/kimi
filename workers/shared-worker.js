'use strict';
/**
 * SharedWorker para o Teste 8.
 * Mantém lista de portas abertas e responde a comandos simples.
 * Permite testar races de connect/close/postMessage no PS4.
 */
var _ports    = [];
var _msgCount = 0;

self.onconnect = function (evt) {
  var port = evt.ports[0];
  _ports.push(port);

  port.onmessage = function (e) {
    _msgCount++;
    var cmd = e.data && e.data.cmd;

    switch (cmd) {
      case 'ping':
        try { port.postMessage({ type: 'pong', n: _msgCount }); } catch (_) {}
        break;

      case 'broadcast':
        _ports.forEach(function (p) {
          try { p.postMessage({ type: 'broadcast', payload: e.data.payload }); } catch (_) {}
        });
        break;

      case 'close-self':
        /* Testa: self.close() com portas ainda abertas */
        self.close();
        break;

      case 'port-count':
        try { port.postMessage({ type: 'port-count', count: _ports.length }); } catch (_) {}
        break;

      case 'remove-me':
        /* Remove essa porta da lista e fecha */
        var idx = _ports.indexOf(port);
        if (idx !== -1) _ports.splice(idx, 1);
        try { port.postMessage({ type: 'removed' }); } catch (_) {}
        break;

      default:
        try { port.postMessage({ type: 'echo', data: e.data, msgNum: _msgCount }); } catch (_) {}
    }
  };

  port.start();

  try {
    port.postMessage({ type: 'connected', portCount: _ports.length });
  } catch (_) {}
};
