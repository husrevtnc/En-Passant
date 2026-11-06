/* En Passant motor testleri — çalıştırmak için: node tests/engine.test.js */
'use strict';

var E = require('../js/engine.js');
var assert = require('assert');

var passes = 0;
function test(name, fn) {
  fn();
  passes++;
  console.log('OK  ' + name);
}

/* neredeyse boş tahta + elle yerleştirilmiş taşlarla durum kurar.
   list: [ [satır, sütun, taşHarfi, renk], ... ] */
function pos(list, turn, castling) {
  var board = new Array(64).fill(null);
  list.forEach(function (p) {
    board[p[0] * 8 + p[1]] = { t: p[2], c: p[3] };
  });
  return {
    board: board,
    turn: turn || 'w',
    castling: castling || { wk: false, wq: false, bk: false, bq: false },
    ep: null,
    halfmove: 0,
    fullmove: 20
  };
}

function count(board) {
  var n = 0;
  for (var i = 0; i < 64; i++) if (board[i]) n++;
  return n;
}

/* =================== TESTLER =================== */

test('başlangıç dizilimi doğru', function () {
  var s = E.initial();
  assert.strictEqual(s.board[0].t, 'r');
  assert.strictEqual(s.board[0].c, 'b');
  assert.strictEqual(s.board[3].t, 'q');
  assert.strictEqual(s.board[60].t, 'k');
  assert.strictEqual(s.board[60].c, 'w');
  assert.strictEqual(s.turn, 'w');
});

test('perft(1) = 20', function () {
  assert.strictEqual(E.perft(E.initial(), 1), 20);
});

test('perft(2) = 400', function () {
  assert.strictEqual(E.perft(E.initial(), 2), 400);
});

test('perft(3) = 8902', function () {
  assert.strictEqual(E.perft(E.initial(), 3), 8902);
});

test('mat tespiti: a8 şah, a7 vezir, b6 beyaz şah', function () {
  var s = pos([
    [0, 0, 'k', 'b'],   // a8 siyah şah
    [1, 0, 'q', 'w'],   // a7 beyaz vezir (şahı çeker, kaçışı kaplar)
    [2, 1, 'k', 'w']    // b6 beyaz şah (veziri korur)
  ], 'b');
  var st = E.status(s);
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.reason, 'checkmate');
  assert.strictEqual(st.winner, 'w');
  assert.strictEqual(E.allLegalMoves(s).length, 0);
});

test('geçerken alma: alınan piyon düşer, 31 taş kalır', function () {
  var s = E.applyMove(E.initial(), { fr: 6, fc: 4, tr: 4, tc: 4, double: true, ep: false, castle: null, promo: null }); // e2-e4
  s = E.applyMove(s, { fr: 1, fc: 0, tr: 2, tc: 0, double: false, ep: false, castle: null, promo: null });              // a7-a6
  s = E.applyMove(s, { fr: 4, fc: 4, tr: 3, tc: 4, double: false, ep: false, castle: null, promo: null });              // e4-e5
  s = E.applyMove(s, { fr: 1, fc: 3, tr: 3, tc: 3, double: true, ep: false, castle: null, promo: null });               // d7-d5
  assert.ok(s.ep && s.ep.r === 2 && s.ep.c === 3, 'ep karesi d6 (r=2, c=3) olmalı');

  var epMove = E.legalMovesFor(s, 3, 4).filter(function (m) { return m.ep && m.tr === 2 && m.tc === 3; })[0];
  assert.ok(epMove, 'e5xe6 geçerken alması d6 hedefiyle bulunmalı');

  var after = E.applyMove(s, epMove);
  assert.strictEqual(after.board[3 * 8 + 3], null, 'd5\'teki siyah piyon kaybolmalı');
  assert.strictEqual(after.ep, null, 'bir hamle geçince ep hakkı sıfırlanmalı');
  assert.strictEqual(count(after.board), 31);
});

test('rok yapılabilir, kale şahla yer değişir, haklar düşer', function () {
  var s = pos([
    [0, 0, 'r', 'b'], [0, 4, 'k', 'b'],
    [7, 0, 'r', 'w'], [7, 4, 'k', 'w'], [7, 7, 'r', 'w']
  ], 'w', { wk: true, wq: true, bk: true, bq: true });

  var moves = E.legalMovesFor(s, 7, 4);
  var ck = moves.filter(function (m) { return m.castle === 'k'; })[0];
  var cq = moves.filter(function (m) { return m.castle === 'q'; })[0];
  assert.ok(ck && cq, 'kısa ve uzun rok bulunmalı');

  var afterK = E.applyMove(s, ck);
  assert.strictEqual(afterK.board[62].t, 'k', 'g1\'de şah');
  assert.strictEqual(afterK.board[61].t, 'r', 'f1\'de kale');
  assert.strictEqual(afterK.castling.wk, false);
  assert.strictEqual(afterK.castling.wq, false);

  var afterQ = E.applyMove(s, cq);
  assert.strictEqual(afterQ.board[58].t, 'k', 'c1\'de şah');
  assert.strictEqual(afterQ.board[59].t, 'r', 'd1\'de kale');
});

test('aradaki kare tehdit altındaysa rok yapılamaz', function () {
  var s = pos([
    [0, 0, 'r', 'b'], [0, 4, 'k', 'b'],
    [4, 2, 'b', 'b'],   // c4'te siyah fil: f1'i (geçiş karesi) saldırır
    [7, 0, 'r', 'w'], [7, 4, 'k', 'w'], [7, 7, 'r', 'w']
  ], 'w', { wk: true, wq: true, bk: true, bq: true });

  var moves = E.legalMovesFor(s, 7, 4);
  assert.ok(!moves.some(function (m) { return m.castle === 'k'; }), 'f1 tehditliyken kısa rok yasak');
  // uzun rok için d1, c1 tehdit altında olmalı; c4 fili d1'i görebilir mi? (5,2)→(7,3): fark (2,1) hayır. d1 serbest, c1 serbest → uzun rok geçerli
  assert.ok(moves.some(function (m) { return m.castle === 'q'; }), 'uzun rok engellenmemeli');
});

test('SAN: Nf3, exd6, O-O, a8=Q+', function () {
  // Nf3 SAN
  var s0 = E.initial();
  var nf3 = E.legalMovesFor(s0, 7, 6).filter(function (m) { return m.tr === 5 && m.tc === 5; })[0];
  assert.strictEqual(E.san(s0, nf3), 'Nf3');

  // Geçerken alma SAN: exd6 (konum doğrudan kurulur)
  var board = new Array(64).fill(null);
  board[3 * 8 + 4] = { t: 'p', c: 'w' };   // e5 beyaz piyon
  board[3 * 8 + 3] = { t: 'p', c: 'b' };   // d5 siyah piyon
  board[7 * 8 + 4] = { t: 'k', c: 'w' };   // e1 beyaz şah
  board[0 * 8 + 4] = { t: 'k', c: 'b' };   // e8 siyah şah
  var s2 = { board: board, turn: 'w', castling: { wk: false, wq: false, bk: false, bq: false }, ep: { r: 2, c: 3 }, halfmove: 0, fullmove: 20 };
  var epM = E.legalMovesFor(s2, 3, 4).filter(function (m) { return m.ep; })[0];
  assert.ok(epM, 'e5xd6 geçerken alması bulunmalı');
  assert.strictEqual(E.san(s2, epM), 'exd6');

  var s3 = pos([
    [0, 0, 'r', 'b'], [0, 4, 'k', 'b'],
    [7, 0, 'r', 'w'], [7, 4, 'k', 'w'], [7, 7, 'r', 'w']
  ], 'w', { wk: true, wq: true, bk: true, bq: true });
  var ck = E.legalMovesFor(s3, 7, 4).filter(function (m) { return m.castle === 'k'; })[0];
  assert.strictEqual(E.san(s3, ck), 'O-O');

  var s4 = pos([
    [1, 1, 'b', 'b'],   // b7'de siyah fil
    [5, 0, 'k', 'b'],   // a6'da siyah şah
    [1, 0, 'p', 'w'],   // a7'de beyaz piyon (terfi edecek)
    [7, 6, 'k', 'w']    // g1'de beyaz şah
  ], 'w');
  var q = E.legalMovesFor(s4, 1, 0).filter(function (m) { return m.promo === 'q'; })[0];
  assert.ok(q, 'a8=Q bulunmalı');
  assert.strictEqual(E.san(s4, q), 'a8=Q+', 'a-dosyasında a6\'daki şaha terfi sonrası şah çekilmeli');
});

test('pat tespiti: a8 şah, b6 vezir, a6 beyaz şah', function () {
  var s = pos([
    [0, 0, 'k', 'b'],   // a8 siyah şah
    [2, 1, 'q', 'w'],   // b6 beyaz vezir: a7, b7, b8'i kaplar
    [2, 0, 'k', 'w']    // a6 beyaz şah: b7'yi de kaplar
  ], 'b');
  var st = E.status(s);
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.reason, 'stalemate');
  assert.strictEqual(st.winner, null);
});

test('yetersiz malzeme ve 50 hamle beraberliği', function () {
  var s1 = pos([[7, 4, 'k', 'w'], [0, 4, 'k', 'b']], 'w');      // Şah vs. Şah
  assert.strictEqual(E.status(s1).reason, 'material');

  var s2 = pos([[7, 4, 'k', 'w'], [0, 4, 'k', 'b'], [3, 3, 'n', 'w']], 'w'); // + tek at
  assert.strictEqual(E.status(s2).reason, 'material');

  var s3 = pos([[7, 4, 'k', 'w'], [0, 4, 'k', 'b']], 'w');
  s3.halfmove = 100;
  assert.strictEqual(E.status(s3).reason, 'fifty');
});

test('a1 kalesi e-dosyasındaki şahı tehdit etmezken hamle sayısı doğru', function () {
  var s = pos([
    [7, 0, 'r', 'w'],   // a1 beyaz kale: a-dosyası ve 1. sıra
    [7, 4, 'k', 'w'],   // e1 beyaz şah
    [0, 4, 'k', 'b']    // e8 siyah şah
  ], 'b');
  // Siyah şah: d8, f8, d7, e7, f7 — hepsi serbest → 5 hamle
  assert.strictEqual(E.legalMovesFor(s, 0, 4).length, 5);
});

test('şah kurtulamazsa geçersiz hamleler elenir', function () {
  var s = pos([
    [7, 4, 'k', 'w'],   // e1 beyaz şah (şahta)
    [0, 4, 'k', 'b'],   // e8 siyah şah
    [1, 4, 'r', 'b']    // e7'de siyah kale: e-dosyasını tutuyor
  ], 'w');
  // Sadece d1, f1, d2, f2 serbest (e2 kale tarafından tutulur)
  var ms = E.legalMovesFor(s, 7, 4);
  var okd = ['d1', 'f1', 'd2', 'f2'];
  assert.strictEqual(ms.length, 4);
  ms.forEach(function (m) {
    var n = E.sqName(m.tr, m.tc);
    assert.ok(okd.indexOf(n) >= 0, n + ' geçersizdi (beklenen: ' + okd + ')');
  });
});

test('kale hareketi rok haklarını düşürür, şah sayacı durur mu', function () {
  var s = pos([
    [7, 0, 'r', 'w'], [7, 4, 'k', 'w'], [7, 7, 'r', 'w'],
    [0, 4, 'k', 'b']
  ], 'w', { wk: true, wq: true, bk: true, bq: true });
  var after = E.applyMove(s, { fr: 7, fc: 0, tr: 6, tc: 0, double: false, ep: false, castle: null, promo: null }); // Ra2
  assert.strictEqual(after.castling.wq, false, 'a1 kalesi oynayınca uzun rok hakkı biter');
  assert.strictEqual(after.castling.wk, true, 'h1 kalesi yerindeyse kısa rok sürer');

  assert.strictEqual(after.turn, 'b');
  assert.strictEqual(after.fullmove, 20, 'beyaz oynadığında tam hamle sayısı artmaz');
  assert.strictEqual(after.halfmove, 1, 'taş alımı/piyon hamlesi olmadığı için saat artmalı');

  var after2 = E.applyMove(after, { fr: 0, fc: 4, tr: 0, tc: 3, double: false, ep: false, castle: null, promo: null }); // Ke8-d8
  assert.strictEqual(after2.fullmove, 21, 'siyah oynayınca tam hamle sayısı artar');
});

test('alınan köşe kalesi rok hakkını düşürür', function () {
  var s2 = pos([
    [0, 0, 'r', 'b'], [0, 4, 'k', 'b'],
    [2, 0, 'q', 'w'], [7, 4, 'k', 'w']   // a6'da beyaz vezir
  ], 'w', { wk: true, wq: true, bk: true, bq: true });
  var qxa8 = E.legalMovesFor(s2, 2, 0).filter(function (m) { return m.tr === 0 && m.tc === 0; })[0];
  var after = E.applyMove(s2, qxa8);
  assert.strictEqual(after.castling.bq, false, 'a8 kalesi alınca siyah uzun rok hakkı biter');
  assert.strictEqual(after.castling.bk, true);
});

test('posKey özdeş konumlarda eşit, sıra farklıysa eşit değil', function () {
  var a = E.initial();
  var b = pos([
    [0, 0, 'r', 'b'], [0, 1, 'n', 'b'], [0, 2, 'b', 'b'], [0, 3, 'q', 'b'], [0, 4, 'k', 'b'], [0, 5, 'b', 'b'], [0, 6, 'n', 'b'], [0, 7, 'r', 'b'],
    [1, 0, 'p', 'b'], [1, 1, 'p', 'b'], [1, 2, 'p', 'b'], [1, 3, 'p', 'b'], [1, 4, 'p', 'b'], [1, 5, 'p', 'b'], [1, 6, 'p', 'b'], [1, 7, 'p', 'b'],
    [6, 0, 'p', 'w'], [6, 1, 'p', 'w'], [6, 2, 'p', 'w'], [6, 3, 'p', 'w'], [6, 4, 'p', 'w'], [6, 5, 'p', 'w'], [6, 6, 'p', 'w'], [6, 7, 'p', 'w'],
    [7, 0, 'r', 'w'], [7, 1, 'n', 'w'], [7, 2, 'b', 'w'], [7, 3, 'q', 'w'], [7, 4, 'k', 'w'], [7, 5, 'b', 'w'], [7, 6, 'n', 'w'], [7, 7, 'r', 'w']
  ], 'w', { wk: true, wq: true, bk: true, bq: true });
  assert.strictEqual(E.posKey(a), E.posKey(b));
  b.turn = 'b';
  assert.notStrictEqual(E.posKey(a), E.posKey(b), 'sıra farklıysa anahtar farklı olmalı');
});

console.log('\n' + passes + ' test geçti.');
