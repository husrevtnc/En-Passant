/* ============================================================
   En Passant — Satranç kural motoru (arayüzden bağımsız)
   Tahta: 64'lük dizi, indeks = satır * 8 + sütun
   satır 0 = 8. sıra (siyahın yanı), satır 7 = 1. sıra
   Taş: { t: 'p|n|b|r|q|k', c: 'w|b' }
   Hamle: { fr, fc, tr, tc, double, ep, castle: 'k'|'q'|null, promo }
   ============================================================ */
(function (global) {
  'use strict';

  var FILES = 'abcdefgh';
  var SAN_LETTER = { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: '' };
  var PROMO_SAN = { q: 'Q', r: 'R', b: 'B', n: 'N' };
  var VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  var KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var RD = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var BD = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  function opp(c) { return c === 'w' ? 'b' : 'w'; }
  function idx(r, c) { return r * 8 + c; }
  function inB(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function sqName(r, c) { return FILES[c] + (8 - r); }

  function initial() {
    var board = new Array(64).fill(null);
    var back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (var c = 0; c < 8; c++) {
      board[idx(0, c)] = { t: back[c], c: 'b' };
      board[idx(1, c)] = { t: 'p', c: 'b' };
      board[idx(6, c)] = { t: 'p', c: 'w' };
      board[idx(7, c)] = { t: back[c], c: 'w' };
    }
    return {
      board: board,
      turn: 'w',
      castling: { wk: true, wq: true, bk: true, bq: true },
      ep: null,
      halfmove: 0,
      fullmove: 1
    };
  }

  /* Bir kare (r,c) 'by' rengi tarafından saldırı altında mı? */
  function isAttacked(board, r, c, by) {
    var i, dr, dc, nr, nc, q;

    // Piyonlar: beyaz piyon yukarı (satır azalarak) saldırır
    var pr = r + (by === 'w' ? 1 : -1);
    if (inB(pr, c - 1)) { q = board[idx(pr, c - 1)]; if (q && q.c === by && q.t === 'p') return true; }
    if (inB(pr, c + 1)) { q = board[idx(pr, c + 1)]; if (q && q.c === by && q.t === 'p') return true; }

    // Atlar
    for (i = 0; i < 8; i++) {
      nr = r + KN[i][0]; nc = c + KN[i][1];
      if (!inB(nr, nc)) continue;
      q = board[idx(nr, nc)];
      if (q && q.c === by && q.t === 'n') return true;
    }

    // Şah (bitişik kareler)
    for (dr = -1; dr <= 1; dr++) {
      for (dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        nr = r + dr; nc = c + dc;
        if (!inB(nr, nc)) continue;
        q = board[idx(nr, nc)];
        if (q && q.c === by && q.t === 'k') return true;
      }
    }

    // Kale/vezir düz ışınlar, fil/vezir çapraz ışınlar
    for (i = 0; i < 4; i++) {
      nr = r + RD[i][0]; nc = c + RD[i][1];
      while (inB(nr, nc)) {
        q = board[idx(nr, nc)];
        if (q) {
          if (q.c === by && (q.t === 'r' || q.t === 'q')) return true;
          break;
        }
        nr += RD[i][0]; nc += RD[i][1];
      }
      nr = r + BD[i][0]; nc = c + BD[i][1];
      while (inB(nr, nc)) {
        q = board[idx(nr, nc)];
        if (q) {
          if (q.c === by && (q.t === 'b' || q.t === 'q')) return true;
          break;
        }
        nr += BD[i][0]; nc += BD[i][1];
      }
    }
    return false;
  }

  function kingPos(board, color) {
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[idx(r, c)];
        if (p && p.t === 'k' && p.c === color) return [r, c];
      }
    }
    return null;
  }

  /* (r,c) karesindeki taşın yarı-geçerli (pseudo-legal) hamleleri */
  function genPseudo(s, r, c) {
    var b = s.board;
    var p = b[idx(r, c)];
    if (!p) return [];
    var out = [];
    var t = p.t, color = p.c;
    var dir = color === 'w' ? -1 : 1;

    function push(tr, tc, extra) {
      var m = { fr: r, fc: c, tr: tr, tc: tc, double: false, ep: false, castle: null, promo: null };
      if (extra) { for (var k in extra) m[k] = extra[k]; }
      out.push(m);
    }
    function pushPawn(tr, tc) {
      if (tr === 0 || tr === 7) {
        var promos = ['q', 'r', 'b', 'n'];
        for (var i = 0; i < 4; i++) push(tr, tc, { promo: promos[i] });
      } else {
        push(tr, tc, null);
      }
    }

    if (t === 'p') {
      var r1 = r + dir;
      if (inB(r1, c) && !b[idx(r1, c)]) {
        pushPawn(r1, c);
        var startR = color === 'w' ? 6 : 1;
        var r2 = r + 2 * dir;
        if (r === startR && !b[idx(r2, c)]) push(r2, c, { double: true });
      }
      for (var dc = -1; dc <= 1; dc += 2) {
        if (!inB(r1, c + dc)) continue;
        var tgt = b[idx(r1, c + dc)];
        if (tgt && tgt.c !== color) {
          pushPawn(r1, c + dc);
        } else if (!tgt && s.ep && s.ep.r === r1 && s.ep.c === c + dc) {
          push(r1, c + dc, { ep: true });
        }
      }
    } else if (t === 'n' || t === 'k') {
      var D = t === 'n' ? KN : KG;
      for (var i = 0; i < D.length; i++) {
        var nr = r + D[i][0], nc = c + D[i][1];
        if (!inB(nr, nc)) continue;
        var q = b[idx(nr, nc)];
        if (!q || q.c !== color) push(nr, nc, null);
      }
    } else {
      var sets = [];
      if (t === 'r') sets = sets.concat(RD);
      if (t === 'b') sets = sets.concat(BD);
      if (t === 'q') sets = sets.concat(RD, BD);
      for (var j = 0; j < sets.length; j++) {
        var nr2 = r + sets[j][0], nc2 = c + sets[j][1];
        while (inB(nr2, nc2)) {
          var q2 = b[idx(nr2, nc2)];
          if (!q2) {
            push(nr2, nc2, null);
          } else {
            if (q2.c !== color) push(nr2, nc2, null);
            break;
          }
          nr2 += sets[j][0]; nc2 += sets[j][1];
        }
      }
    }
    return out;
  }

  /* Hamleyi uygular, yeni durum döndürür. m önceki duruma göre tanımlı. */
  function applyMove(s, m) {
    var fromPiece = s.board[idx(m.fr, m.fc)];
    if (!fromPiece) return s;
    var color = fromPiece.c;
    var captured = s.board[idx(m.tr, m.tc)];
    var board = s.board.slice();

    board[idx(m.fr, m.fc)] = null;
    if (m.ep) {
      // Geçerken alınan piyon: hareket eden piyonun başlangıç satırında, hedef sütununda
      board[idx(m.fr, m.tc)] = null;
    }
    if (m.castle === 'k') {
      board[idx(m.fr, 5)] = board[idx(m.fr, 7)];
      board[idx(m.fr, 7)] = null;
    } else if (m.castle === 'q') {
      board[idx(m.fr, 3)] = board[idx(m.fr, 0)];
      board[idx(m.fr, 0)] = null;
    }
    if (m.promo) {
      board[idx(m.tr, m.tc)] = { t: m.promo, c: color };
    } else {
      board[idx(m.tr, m.tc)] = fromPiece;
    }

    var castling = { wk: s.castling.wk, wq: s.castling.wq, bk: s.castling.bk, bq: s.castling.bq };
    if (fromPiece.t === 'k') {
      castling[color + 'k'] = false;
      castling[color + 'q'] = false;
    }
    // Köşelerde hiçbir şey olmasa da: şah ya da kale hareket ettiyse / o köşedeki kale alındıysa
    if ((m.fr === 7 && m.fc === 0) || (m.tr === 7 && m.tc === 0)) castling.wq = false;
    if ((m.fr === 7 && m.fc === 7) || (m.tr === 7 && m.tc === 7)) castling.wk = false;
    if ((m.fr === 0 && m.fc === 0) || (m.tr === 0 && m.tc === 0)) castling.bq = false;
    if ((m.fr === 0 && m.fc === 7) || (m.tr === 0 && m.tc === 7)) castling.bk = false;

    var ep = (fromPiece.t === 'p' && Math.abs(m.tr - m.fr) === 2)
      ? { r: (m.fr + m.tr) / 2, c: m.fc }
      : null;

    var halfmove = (fromPiece.t === 'p' || captured || m.ep) ? 0 : s.halfmove + 1;
    var fullmove = s.turn === 'b' ? s.fullmove + 1 : s.fullmove;

    return {
      board: board,
      turn: opp(s.turn),
      castling: castling,
      ep: ep,
      halfmove: halfmove,
      fullmove: fullmove
    };
  }

  /* Kale hamleleri dahil tam geçerli hamleler (sıra taş sahibine ait olmalı) */
  function legalMovesFor(s, r, c) {
    var p = s.board[idx(r, c)];
    if (!p || p.c !== s.turn) return [];
    var pseudo = genPseudo(s, r, c);
    var legal = [];
    for (var i = 0; i < pseudo.length; i++) {
      var ns = applyMove(s, pseudo[i]);
      var k = kingPos(ns.board, p.c);
      if (!isAttacked(ns.board, k[0], k[1], opp(p.c))) legal.push(pseudo[i]);
    }
    if (p.t === 'k') legal = legal.concat(genCastles(s, r, c));
    return legal;
  }

  /* Rok hamleleri: geçerliyse 'k'/'q' rok hamlelerini döndürür */
  function genCastles(s, r, c) {
    var out = [];
    var color = s.turn, oppC = opp(color);
    var row = color === 'w' ? 7 : 0;
    if (r !== row || c !== 4) return out;
    var b = s.board;
    // Şah o anda şahta olmamalı
    if (isAttacked(b, row, 4, oppC)) return out;

    var canK = s.castling[color + 'k'];
    var canQ = s.castling[color + 'q'];

    if (canK) {
      var rk = b[idx(row, 7)];
      if (rk && rk.t === 'r' && rk.c === color &&
          !b[idx(row, 5)] && !b[idx(row, 6)] &&
          !isAttacked(b, row, 5, oppC) && !isAttacked(b, row, 6, oppC)) {
        out.push({ fr: r, fc: c, tr: row, tc: 6, double: false, ep: false, castle: 'k', promo: null });
      }
    }
    if (canQ) {
      var rq = b[idx(row, 0)];
      if (rq && rq.t === 'r' && rq.c === color &&
          !b[idx(row, 1)] && !b[idx(row, 2)] && !b[idx(row, 3)] &&
          !isAttacked(b, row, 3, oppC) && !isAttacked(b, row, 2, oppC)) {
        out.push({ fr: r, fc: c, tr: row, tc: 2, double: false, ep: false, castle: 'q', promo: null });
      }
    }
    return out;
  }

  function allLegalMoves(s) {
    var out = [];
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = s.board[idx(r, c)];
        if (p && p.c === s.turn) out = out.concat(legalMovesFor(s, r, c));
      }
    }
    return out;
  }

  function anyLegalMove(s) {
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = s.board[idx(r, c)];
        if (p && p.c === s.turn && legalMovesFor(s, r, c).length) return true;
      }
    }
    return false;
  }

  /* Standart cebir notasyonu (SAN). Hamlenin uygulanmadığı mevcut durumda çağır. */
  function san(s, m) {
    var piece = s.board[idx(m.fr, m.fc)];
    if (!piece) return '';
    var captured = s.board[idx(m.tr, m.tc)] || m.ep;
    var base;

    if (m.castle === 'k') {
      base = 'O-O';
    } else if (m.castle === 'q') {
      base = 'O-O-O';
    } else if (piece.t === 'p') {
      base = (captured ? FILES[m.fc] + 'x' : '') + sqName(m.tr, m.tc) +
             (m.promo ? '=' + PROMO_SAN[m.promo] : '');
    } else {
      // Diğer aynı türden taşlar da aynı kareye gidebiliyorsa karışıklık notu ekle
      var others = [];
      for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
          if (r === m.fr && c === m.fc) continue;
          var q = s.board[idx(r, c)];
          if (!q || q.t !== piece.t || q.c !== piece.c) continue;
          var ls = legalMovesFor(s, r, c);
          for (var i = 0; i < ls.length; i++) {
            if (ls[i].tr === m.tr && ls[i].tc === m.tc) { others.push([r, c]); break; }
          }
        }
      }
      var d = '';
      if (others.length) {
        var sameFile = false, sameRank = false;
        for (var j = 0; j < others.length; j++) {
          if (others[j][1] === m.fc) sameFile = true;
          if (others[j][0] === m.fr) sameRank = true;
        }
        if (!sameFile) d = FILES[m.fc];
        else if (!sameRank) d = String(8 - m.fr);
        else d = FILES[m.fc] + (8 - m.fr);
      }
      base = SAN_LETTER[piece.t] + d + (captured ? 'x' : '') + sqName(m.tr, m.tc);
    }

    var ns = applyMove(s, m);
    var k = kingPos(ns.board, ns.turn);
    if (isAttacked(ns.board, k[0], k[1], opp(ns.turn))) {
      base += anyLegalMove(ns) ? '+' : '#';
    }
    return base;
  }

  function insufficientMaterial(board) {
    var minors = [], bishopSq = [];
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[idx(r, c)];
        if (!p) continue;
        if (p.t === 'p' || p.t === 'r' || p.t === 'q') return false;
        if (p.t === 'n') minors.push('n');
        if (p.t === 'b') { minors.push('b'); bishopSq.push((r + c) % 2); }
      }
    }
    if (minors.length === 0) return true;                 // Şah vs. Şah
    if (minors.length === 1) return true;                 // Şah+fil/at vs. Şah
    if (minors.every(function (t) { return t === 'b'; }) &&
        bishopSq.every(function (x) { return x === bishopSq[0]; })) {
      return true;                                        // aynı renk karelerde filler
    }
    return false;
  }

  /* Oyun durumu: mat / pat / beraberlik tespiti */
  function status(s) {
    var k = kingPos(s.board, s.turn);
    var check = isAttacked(s.board, k[0], k[1], opp(s.turn));
    if (!anyLegalMove(s)) {
      return check
        ? { over: true, reason: 'checkmate', winner: opp(s.turn), check: true }
        : { over: true, reason: 'stalemate', winner: null, check: false };
    }
    if (s.halfmove >= 100) {
      return { over: true, reason: 'fifty', winner: null, check: check };
    }
    if (insufficientMaterial(s.board)) {
      return { over: true, reason: 'material', winner: null, check: check };
    }
    return { over: false, reason: null, winner: null, check: check };
  }

  /* Tekrar (threefold) için konum anahtarı */
  function posKey(s) {
    var k = '';
    for (var i = 0; i < 64; i++) {
      var p = s.board[i];
      k += p ? p.c + p.t : '.';
    }
    k += s.turn;
    if (s.castling.wk) k += 'K';
    if (s.castling.wq) k += 'Q';
    if (s.castling.bk) k += 'k';
    if (s.castling.bq) k += 'q';
    k += s.ep ? (FILES[s.ep.c] + (8 - s.ep.r)) : '-';
    return k;
  }

  function perft(s, depth) {
    if (depth === 0) return 1;
    var n = 0, moves = allLegalMoves(s);
    for (var i = 0; i < moves.length; i++) {
      n += perft(applyMove(s, moves[i]), depth - 1);
    }
    return n;
  }

  var api = {
    initial: initial,
    applyMove: applyMove,
    legalMovesFor: legalMovesFor,
    allLegalMoves: allLegalMoves,
    san: san,
    status: status,
    isAttacked: isAttacked,
    kingPos: kingPos,
    posKey: posKey,
    perft: perft,
    insufficientMaterial: insufficientMaterial,
    sqName: sqName,
    VALUES: VALUES,
    FILES: FILES,
    opp: opp
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Engine = api;
})(typeof window !== 'undefined' ? window : this);
