/**
 * Heartbeat Worker
 *
 * O runner envia 'ping' a cada ~400ms.
 * Se o main thread ficar sem enviar pings por FREEZE_MS,
 * o worker posta { type: 'freeze', delta: N } de volta.
 *
 * Limites conservadores para PS4 (sem JIT, GC pode pausar):
 *   FREEZE_MS = 4000ms antes de declarar freeze
 */
var FREEZE_MS  = 4000;
var CHECK_MS   = 600;
var lastPing   = Date.now();

self.onmessage = function (e) {
  if (e.data === 'ping') {
    lastPing = Date.now();
  }
};

setInterval(function () {
  var delta = Date.now() - lastPing;
  if (delta > FREEZE_MS) {
    self.postMessage({ type: 'freeze', delta: delta });
  }
}, CHECK_MS);
