/* ============================================================
   En Passant — Arayüz ve oyun akışı
   ============================================================ */
(function () {
  'use strict';

  var E = window.Engine;

  /* ---------- kısayollar ve sabitler ---------- */
  function $(sel) { return document.querySelector(sel); }

  var TR_PIECE = { p: 'piyon', n: 'at', b: 'fil', r: 'kale', q: 'vezir', k: 'şah' };
  var TR_SIDE = { w: 'Beyaz', b: 'Siyah' };
  var PIECE_ORDER = ['q', 'r', 'b', 'n', 'p'];
  var INIT_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  var STORE_KEY = 'en-passant:v1';

  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- öğeler ---------- */
  var boardEl = $('#board');
  var turnTextEl = $('#turn-text');
  var turnDotEl = $('#turn-dot');
  var noteEl = $('#status-note');
  var moveListEl = $('#move-list');
  var capRows = { w: $('#cap-white'), b: $('#cap-black') };
  var diffEls = { w: $('#diff-white'), b: $('#diff-black') };
  var btnNew = $('#btn-new');
  var btnUndo = $('#btn-undo');
  var btnRedo = $('#btn-redo');
  var btnRotate = $('#btn-rotate');
  var promoDialog = $('#promo-dialog');
  var promoGrid = $('#promo-grid');
  var setupDialog = $('#setup-dialog');
  var setupStart = $('#setup-start');
  var setupCancel = $('#setup-cancel');
  var confirmDialog = $('#confirm-dialog');
  var confirmMsg = $('#confirm-msg');
  var confirmYes = $('#confirm-yes');
  var confirmNo = $('#confirm-no');
  var toastEl = $('#toast');

  /* ---------- onay diyaloğu ---------- */
  var confirmResolver = null;

  /* ---------- oyun durumu ---------- */
  var G = {
    state: E.initial(),
    hist: [],
    moves: [],
    lastMove: null,
    selected: null,
    selMoves: [],
    over: null,          // { reason, winner } | null
    check: false,
    reps: {},
    orientation: null,   // 'w' | 'b' (init'te belirlenir)
    autoFlip: true,
    sound: false,
    redo: [],
    clock: null,
    clockConfig: { w: 300000, b: 300000, inc: 0 },
    theme: 'default'
  };

  /* ============================================================
     Tahta kurulumu ve yerleşimi
     ============================================================ */
  var squares = [];   // [r][c] -> button
  var imgEls = [];    // [r][c] -> img
  var fileEls = [];   // [r][c] -> span (dosya etiketi)
  var rankEls = [];   // [r][c] -> span (sıra etiketi)

  function buildBoard() {
    var frag = document.createDocumentFragment();
    for (var r = 0; r < 8; r++) {
      squares.push([]); imgEls.push([]); fileEls.push([]); rankEls.push([]);
      for (var c = 0; c < 8; c++) {
        (function (r, c) {
          var sq = document.createElement('button');
          sq.type = 'button';
          sq.className = 'square ' + (((r + c) % 2) ? 'dark' : 'light');
          sq.dataset.r = r;
          sq.dataset.c = c;
          sq.addEventListener('click', onSquareClick);

          var f = document.createElement('span');
          f.className = 'coord file';
          var rk = document.createElement('span');
          rk.className = 'coord rank';
          var img = document.createElement('img');
          img.alt = '';
          img.draggable = false;
          img.hidden = true;

          sq.appendChild(f);
          sq.appendChild(rk);
          sq.appendChild(img);
          frag.appendChild(sq);

          squares[r].push(sq);
          imgEls[r].push(img);
          fileEls[r].push(f);
          rankEls[r].push(rk);
        })(r, c);
      }
    }
    boardEl.appendChild(frag);
    boardEl.addEventListener('keydown', onBoardKeydown);
    boardEl.addEventListener('mousedown', onMouseDown);
  }

  /* Kareleri ızgarada görüntü yönüne göre yerleştir; koordinat etiketlerini ayarla */
  function layoutSquares() {
    var white = G.orientation === 'w';
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var vr = white ? r : 7 - r;
        var vc = white ? c : 7 - c;
        squares[r][c].style.gridArea = (vr + 1) + ' / ' + (vc + 1);
        fileEls[r][c].textContent = E.FILES[c];
        fileEls[r][c].hidden = !(white ? r === 7 : r === 0);
        rankEls[r][c].textContent = String(8 - r);
        rankEls[r][c].hidden = !(white ? c === 0 : c === 7);
      }
    }
  }

  /* Görüntü yönünü değiştir; taşlar ve etiketler kayarak devrilme hissi verir */
  function setOrientation(o, animate) {
    animate = false;
    if (G.orientation === o) return;
    var oldRects = null;
    if (animate && !REDUCED) {
      oldRects = {};
      for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
          oldRects[r + ',' + c] = squares[r][c].getBoundingClientRect();
        }
      }
    }
    G.orientation = o;
    layoutSquares();
    if (!oldRects) return;

    requestAnimationFrame(function () {
      for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
          var sq = squares[r][c];
          var old = oldRects[r + ',' + c];
          var now = sq.getBoundingClientRect();
          var dx = old.left - now.left;
          var dy = old.top - now.top;
          if (!dx && !dy) continue;
          if (typeof sq.animate === 'function') {
            sq.animate(
              [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'translate(0,0)' }],
              { duration: 260, easing: 'cubic-bezier(.3,.9,.25,1)' }
            );
          }
        }
      }
    });
  }

  function onBoardKeydown(e) {
    var map = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    var d = map[e.key];
    if (!d) {
      if (e.key === 'Escape') { clearSelection(); renderAll(); }
      return;
    }
    var sq = e.target.closest ? e.target.closest('.square') : null;
    if (!sq) return;
    e.preventDefault();
    var r = +sq.dataset.r, c = +sq.dataset.c;
    var white = G.orientation === 'w';
    var dr = white ? d[0] : -d[0];
    var dc = white ? d[1] : -d[1];
    var nr = Math.max(0, Math.min(7, r + dr));
    var nc = Math.max(0, Math.min(7, c + dc));
    squares[nr][nc].focus();
  }

  /* ============================================================
     Çizim
     ============================================================ */
  function srcOf(p) {
    if (!p || !/^[wb]$/.test(p.c) || !/^[pnbrqk]$/.test(p.t)) return null;
    return 'assets/pieces/' + p.c + p.t + '.svg';
  }

  function fillCapRow(el, types, diff) {
    el.innerHTML = '';
    types.forEach(function (t) {
      var img = document.createElement('img');
      img.src = 'assets/pieces/' + (el === capRows.w ? 'b' : 'w') + t + '.svg';
      img.alt = '';
      img.width = 22;
      img.height = 22;
      el.appendChild(img);
    });
    if (!types.length) {
      var dash = document.createElement('span');
      dash.className = 'cap-empty';
      dash.textContent = '—';
      el.appendChild(dash);
    }
    var badge = el.parentElement.querySelector('.cap-label .mat-diff');
    if (badge) {
      badge.textContent = diff > 0 ? '+' + diff : '';
    }
  }

  function renderBoard() {
    var king = E.kingPos(G.state.board, G.state.turn);
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var sq = squares[r][c];
        var img = imgEls[r][c];
        var p = G.state.board[r * 8 + c];

        if (p) {
          var s = srcOf(p);
          if (s && img.getAttribute('src') !== s) img.src = s;
          img.hidden = !s;
          sq.setAttribute('aria-label', E.sqName(r, c) + ', ' + (TR_SIDE[p.c] || '') + ' ' + (TR_PIECE[p.t] || ''));
        } else {
          img.hidden = true;
          img.removeAttribute('src');
          sq.setAttribute('aria-label', E.sqName(r, c));
        }

        var cls = 'square ' + (((r + c) % 2) ? 'dark' : 'light');
        if (G.lastMove && ((G.lastMove.fr === r && G.lastMove.fc === c) || (G.lastMove.tr === r && G.lastMove.tc === c))) cls += ' last';
        if (G.selected && G.selected.r === r && G.selected.c === c) cls += ' sel';
        if (G.selected) {
          for (var i = 0; i < G.selMoves.length; i++) {
            var m = G.selMoves[i];
            if (m.tr === r && m.tc === c) {
              var isCap = !!p || m.ep;
              cls += isCap ? ' dest dest-cap' : ' dest';
              break;
            }
          }
        }
        if (G.check && king && king[0] === r && king[1] === c) cls += ' check';
        sq.className = cls;
      }
    }
  }

  function animateMove(m) {
    if (!m) return;
    var fromEl = squares[m.fr][m.fc];
    var toEl = squares[m.tr][m.tc];
    var pieceImg = imgEls[m.tr][m.tc];
    if (!pieceImg || pieceImg.hidden) return;
    var fromRect = fromEl.getBoundingClientRect();
    var toRect = toEl.getBoundingClientRect();
    var dx = fromRect.left - toRect.left;
    var dy = fromRect.top - toRect.top;
    if (!dx && !dy) return;
    if (typeof pieceImg.animate === 'function') {
      pieceImg.animate(
        [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'translate(0,0)' }],
        { duration: 180, easing: 'cubic-bezier(.25,.9,.3,1)' }
      );
    }
  }
  function renderAll() {
    var ghosts = document.querySelectorAll('.drag-ghost');
    for (var i = 0; i < ghosts.length; i++) ghosts[i].remove();
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      if (squares[r] && squares[r][c]) squares[r][c].classList.remove('dragging', 'drag-target', 'drag-hover');
    }
    renderBoard();
    updateSidebar();
    updateClockDisplay();
  }

  function updateSidebar() {
    var s = G.state;

    turnDotEl.className = 'turn-dot ' + s.turn;
    turnTextEl.textContent = 'Sıra: ' + TR_SIDE[s.turn];

    if (G.over) {
      noteEl.classList.remove('alert');
      var o = G.over;
      if (o.reason === 'checkmate') {
        noteEl.classList.add('alert');
        noteEl.textContent = 'Mat! ' + TR_SIDE[o.winner] + ' kazandı.';
      } else if (o.reason === 'stalemate') {
        noteEl.textContent = 'Pat — oyun berabere bitti.';
      } else if (o.reason === 'fifty') {
        noteEl.textContent = '50 hamle kuralı — oyun berabere bitti.';
      } else if (o.reason === 'material') {
        noteEl.textContent = 'Yetersiz malzeme — oyun berabere bitti.';
      } else if (o.reason === 'repetition') {
        noteEl.textContent = 'Üç kez tekrar — oyun berabere bitti.';
      }
    } else if (G.moves.length === 0) {
      noteEl.classList.remove('alert');
      noteEl.textContent = 'Beyaz başlar. Taş seçmek için tıkla.';
    } else if (G.check) {
      noteEl.classList.add('alert');
      noteEl.textContent = 'Şah! ' + TR_SIDE[s.turn] + ' kurtulmalı.';
    } else {
      noteEl.classList.remove('alert');
      noteEl.textContent = 'Normal oyun sürüyor.';
    }

    // Hamle listesi
    moveListEl.innerHTML = '';
    if (!G.moves.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Henüz hamle yok.';
      moveListEl.appendChild(li);
    } else {
      for (var i = 0; i < G.moves.length; i += 2) {
        var row = document.createElement('li');
        var num = document.createElement('span');
        num.className = 'num';
        num.textContent = (i / 2 + 1) + '.';
        row.appendChild(num);
        for (var j = 0; j < 2; j++) {
          var mv = document.createElement('span');
          mv.className = 'mv' + (i + j === G.moves.length - 1 ? ' current' : '');
          if (G.moves[i + j]) mv.textContent = G.moves[i + j];
          row.appendChild(mv);
        }
        moveListEl.appendChild(row);
      }
      moveListEl.scrollTop = moveListEl.scrollHeight;
    }

    // Alınan taşlar
    var live = {
      w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
      b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
    };
    for (var k = 0; k < 64; k++) {
      var pc = G.state.board[k];
      if (pc && pc.t !== 'k') live[pc.c][pc.t]++;
    }
    // "Beyaz'ın aldıkları" = tahtadan eksik siyah taşlar; tersi de simetrik
    var taken = { w: [], b: [] };
    PIECE_ORDER.forEach(function (t) {
      var missB = INIT_COUNTS[t] - live.b[t];
      var missW = INIT_COUNTS[t] - live.w[t];
      for (var i = 0; i < missB; i++) taken.w.push(t);   // beyaz siyah taş aldı
      for (var j = 0; j < missW; j++) taken.b.push(t);   // siyah beyaz taş aldı
    });
    // Diff için değer toplamı:
    var matW = 0, matB = 0;
    PIECE_ORDER.forEach(function (t) {
      matW += E.VALUES[t] * (INIT_COUNTS[t] - live.b[t]);
      matB += E.VALUES[t] * (INIT_COUNTS[t] - live.w[t]);
    });
    fillCapRow(capRows.w, taken.w, matW > matB ? matW - matB : 0);
    fillCapRow(capRows.b, taken.b, matB > matW ? matB - matW : 0);

    // Düğme durumları
    btnUndo.disabled = G.hist.length < 2;
    btnRedo.disabled = !G.redo || !G.redo.length;
  }

  /* ============================================================
     Bildirimler ve sesler
     ============================================================ */
  var toastTimer = null;
  function announce(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  function soundMove(capture, castle) {}
  function soundCheck() {}
  function soundPromote() {}
  function soundEnd(winner) {}

  /* ============================================================
     Oyun akışı
     ============================================================ */
  function cloneState(s) {
    return {
      board: s.board.map(function (p) { return p ? { t: p.t, c: p.c } : null; }),
      turn: s.turn,
      castling: { wk: s.castling.wk, wq: s.castling.wq, bk: s.castling.bk, bq: s.castling.bq },
      ep: s.ep ? { r: s.ep.r, c: s.ep.c } : null,
      halfmove: s.halfmove,
      fullmove: s.fullmove
    };
  }

  function rebuildReps() {
    G.reps = {};
    G.hist.forEach(function (en) {
      var k = E.posKey(en.state);
      G.reps[k] = (G.reps[k] || 0) + 1;
    });
  }

  function clearSelection() {
    G.selected = null;
    G.selMoves = [];
  }

  function select(r, c) {
    G.selected = { r: r, c: c };
    G.selMoves = E.legalMovesFor(G.state, r, c);
  }

  /* ---------- sürükle-bırak (fare) ---------- */
  function squareAtPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el) return null;
    var sq = (typeof el.closest === 'function') ? el.closest('.square') : null;
    if (!sq) return null;
    return { r: +sq.dataset.r, c: +sq.dataset.c };
  }

  function clearDragHighlights() {
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var sq = squares[r][c];
        sq.classList.remove('dragging', 'drag-target', 'drag-hover');
      }
    }
  }

  var dragState = null;
  var dragGhost = null;
  var justDragged = false;

  function startDrag(r, c, e) {
    if (G.over) return;
    var p = G.state.board[r * 8 + c];
    if (!p || p.c !== G.state.turn) return;
    var moves = E.legalMovesFor(G.state, r, c);
    if (!moves.length) return;

    dragState = { from: { r: r, c: c }, moves: moves, hover: null, piece: p, moved: false, startX: e.clientX, startY: e.clientY };

    var ghost = document.createElement('img');
    ghost.className = 'drag-ghost';
    ghost.src = 'assets/pieces/' + p.c + p.t + '.svg';
    ghost.alt = '';
    ghost.style.left = e.clientX + 'px';
    ghost.style.top = e.clientY + 'px';
    document.body.appendChild(ghost);
    dragGhost = ghost;

    squares[r][c].classList.add('dragging');
    for (var i = 0; i < moves.length; i++) {
      squares[moves[i].tr][moves[i].tc].classList.add('drag-target');
    }
  }

  function onMouseDown(e) {
    if (G.over) return;
    if (e.button !== 0) return;
    var sq = e.target.closest ? e.target.closest('.square') : null;
    if (!sq) return;
    var r = +sq.dataset.r, c = +sq.dataset.c;
    var p = G.state.board[r * 8 + c];
    if (!p || p.c !== G.state.turn) return;
    startDrag(r, c, e);
  }

  function onMouseMove(e) {
    if (!dragState) return;
    if (!dragState.moved) {
      if (Math.abs(e.clientX - dragState.startX) > 4 || Math.abs(e.clientY - dragState.startY) > 4) {
        dragState.moved = true;
      }
    }
    if (dragGhost) {
      dragGhost.style.left = e.clientX + 'px';
      dragGhost.style.top = e.clientY + 'px';
    }
    if (dragState.hover) {
      squares[dragState.hover.r][dragState.hover.c].classList.remove('drag-hover');
    }
    var t = squareAtPoint(e.clientX, e.clientY);
    if (t) {
      var legal = false;
      for (var i = 0; i < dragState.moves.length; i++) {
        if (dragState.moves[i].tr === t.r && dragState.moves[i].tc === t.c) { legal = true; break; }
      }
      if (legal) {
        squares[t.r][t.c].classList.add('drag-hover');
        dragState.hover = t;
      } else {
        dragState.hover = null;
      }
    } else {
      dragState.hover = null;
    }
  }

  function onMouseUp(e) {
    if (!dragState) return;
    var ds = dragState;
    var wasMoved = ds.moved;
    var target = ds.hover || squareAtPoint(e.clientX, e.clientY);

    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    clearDragHighlights();
    dragState = null;

    if (!wasMoved) return;

    var mv = null;
    if (target) {
      for (var i = 0; i < ds.moves.length; i++) {
        if (ds.moves[i].tr === target.r && ds.moves[i].tc === target.c) { mv = ds.moves[i]; break; }
      }
    }
    if (mv) {
      justDragged = true;
      if (mv.promo) {
        openPromo(ds.moves.filter(function (m) { return m.tr === target.r && m.tc === target.c; }));
      } else {
        performMove(mv);
      }
      setTimeout(function () { justDragged = false; }, 0);
    }
  }

  function onSquareClick(e) {
    if (justDragged) { justDragged = false; return; }
    if (G.over) { announce('Oyun bitti — Yeni Oyun ile başlayın.'); return; }
    var sq = e.target.closest ? e.target.closest('.square') : null;
    if (!sq) return;
    var r = +sq.dataset.r, c = +sq.dataset.c;
    var p = G.state.board[r * 8 + c];

    if (G.selected) {
      var w = [];
      for (var i = 0; i < G.selMoves.length; i++) {
        if (G.selMoves[i].tr === r && G.selMoves[i].tc === c) w.push(G.selMoves[i]);
      }
      if (w.length) {
        if (w[0].promo) { openPromo(w); return; }
        performMove(w[0]);
        return;
      }
    }
    if (p && p.c === G.state.turn) {
      if (G.selected && G.selected.r === r && G.selected.c === c) {
        clearSelection();
      } else {
        select(r, c);
      }
      renderAll();
    } else if (G.selected) {
      clearSelection();
      renderAll();
    }
  }

  function performMove(m) {
    var before = G.state;
    var mover = before.board[m.fr * 8 + m.fc];
    var captures = !!before.board[m.tr * 8 + m.tc] || m.ep;
    var sanStr = E.san(before, m);

    G.state = E.applyMove(before, m);
    G.hist.push({ state: cloneState(G.state), san: sanStr, lastMove: m });
    G.moves.push(sanStr);
    G.lastMove = m;
    clearSelection();
    G.redo = [];

    var key = E.posKey(G.state);
    G.reps[key] = (G.reps[key] || 0) + 1;

    var st = E.status(G.state);
    G.check = st.check;
    G.over = st.over
      ? { reason: st.reason, winner: st.winner }
      : (G.reps[key] >= 3 ? { reason: 'repetition', winner: null } : null);

    soundMove(captures, m.castle);
    if (m.promo) soundPromote();
    if (!G.over && G.check) soundCheck();
    if (G.over) {
      if (G.over.reason === 'checkmate') {
        announce('Mat! ' + TR_SIDE[G.over.winner] + ' kazandı.');
      } else {
        announce('Oyun berabere bitti.');
      }
    } else if (G.check) {
      announce('Şah!');
    }

    if (G.autoFlip && !G.over) setOrientation(G.state.turn, true);

    renderAll();
    save();
    if (G.clock && !G.over) {
      var mover = before.turn;
      G.clock[mover] += G.clock.inc;
      G.clock.running = G.state.turn;
      G.clock.lastTick = Date.now();
      updateClockDisplay();
    }

    animateMove(m);
  }

  /* ---------- terfi pencereleri ---------- */
  var promoCtx = null;

  function openPromo(moves) {
    promoCtx = { moves: moves, opener: document.activeElement };
    promoGrid.innerHTML = '';
    var color = G.state.turn;
    ['q', 'r', 'b', 'n'].forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'promo-btn';
      b.setAttribute('aria-label', TR_PIECE[t] + ' seç');
      b.dataset.promo = t;
      var img = document.createElement('img');
      img.src = 'assets/pieces/' + color + t + '.svg';
      img.alt = '';
      img.draggable = false;
      b.appendChild(img);
      b.addEventListener('click', function () { choosePromo(t); });
      promoGrid.appendChild(b);
    });
    promoDialog.showModal();
    var first = promoGrid.querySelector('button');
    if (first) first.focus();
  }

  function choosePromo(t) {
    if (!promoCtx) return;
    var mv = null;
    for (var i = 0; i < promoCtx.moves.length; i++) {
      if (promoCtx.moves[i].promo === t) { mv = promoCtx.moves[i]; break; }
    }
    promoCtx.done = true;
    promoDialog.close();
    promoCtx = null;
    if (mv) performMove(mv);
  }

  promoDialog.addEventListener('close', function () {
    if (promoCtx && !promoCtx.done) clearSelection();
    var opener = promoCtx && promoCtx.opener;
    promoCtx = null;
    renderAll();
    if (opener && typeof opener.focus === 'function') opener.focus();
  });

  /* ---------- yeni oyun / geri al / döndür / PGN ---------- */
  function reset() {
    var initial = E.initial();
    G.timeControl = (document.getElementById('sel-time') ? document.getElementById('sel-time').value : '0');
    G.state = cloneState(initial);
    G.hist = [{ state: cloneState(initial), san: null, lastMove: null }];
    G.moves = [];
    G.lastMove = null;
    G.selected = null;
    G.selMoves = [];
    G.over = null;
    G.check = false;
    rebuildReps();
    G.redo = [];
    initClock();
    setOrientation('w', G.orientation !== null);
    renderAll();
    save();
    announce('Yeni oyun başladı. Beyaz oynar.');
  }

  function newGame() {
    if (G.moves.length && !G.over) {
      askConfirm('Devam eden oyun silinecek. Yeni oyun başlatılsın mı?', openSetup);
      return;
    }
    openSetup();
  }

  function openSetup() {
    var inpW = document.getElementById('inp-white');
    var inpB = document.getElementById('inp-black');
    var inpI = document.getElementById('inp-inc');
    function fmtMin(ms) {
      if (!ms) return '0:00';
      var s = Math.round(ms / 1000);
      var m = Math.floor(s / 60);
      var sec = s % 60;
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    }
    if (inpW) inpW.value = fmtMin(G.clockConfig && G.clockConfig.w ? G.clockConfig.w : 300000);
    if (inpB) inpB.value = fmtMin(G.clockConfig && G.clockConfig.b ? G.clockConfig.b : 300000);
    if (inpI) inpI.value = (G.clockConfig && G.clockConfig.inc) ? Math.round(G.clockConfig.inc / 1000) : 0;
    setupDialog.showModal();
    if (inpW) inpW.focus();
  }

  function startFromSetup() {
    var w = parseDuration(document.getElementById('inp-white').value);
    var b = parseDuration(document.getElementById('inp-black').value);
    var inc = Math.max(0, parseInt(document.getElementById('inp-inc').value, 10) || 0);
    G.clockConfig = { w: w, b: b, inc: inc * 1000 };
    setupDialog.close();
    reset();
  }

  function undo() {
    if (G.hist.length < 2) return;
    var popped = G.hist.pop();
    G.redo.push(popped);
    G.moves.pop();
    var last = G.hist[G.hist.length - 1];
    G.state = cloneState(last.state);
    G.lastMove = last.lastMove;
    clearSelection();
    rebuildReps();

    var st = E.status(G.state);
    G.check = st.check;
    G.over = st.over
      ? { reason: st.reason, winner: st.winner }
      : (G.reps[E.posKey(G.state)] >= 3 ? { reason: 'repetition', winner: null } : null);

    if (G.autoFlip && !G.over) setOrientation(G.state.turn, true);
    if (G.clock) { G.clock.running = G.over ? null : G.state.turn; G.clock.lastTick = Date.now(); updateClockDisplay(); if (G.clock.running && !clockInterval) clockInterval = setInterval(tickClock, 200); }
    renderAll();
    save();
    announce('Hamle geri alındı.');
  }

  function redo() {
    if (!G.redo || !G.redo.length) return;
    var entry = G.redo.pop();
    G.hist.push(entry);
    if (entry.san) G.moves.push(entry.san);
    G.state = cloneState(entry.state);
    G.lastMove = entry.lastMove;
    clearSelection();
    rebuildReps();

    var st = E.status(G.state);
    G.check = st.check;
    G.over = st.over
      ? { reason: st.reason, winner: st.winner }
      : (G.reps[E.posKey(G.state)] >= 3 ? { reason: 'repetition', winner: null } : null);

    if (G.autoFlip && !G.over) setOrientation(G.state.turn, true);
    if (G.clock) { G.clock.running = G.over ? null : G.state.turn; G.clock.lastTick = Date.now(); updateClockDisplay(); if (G.clock.running && !clockInterval) clockInterval = setInterval(tickClock, 200); }
    renderAll();
    save();
    announce('Hamle ileri alındı.');
  }

  /* ---------- saat ---------- */
  var clockInterval = null;

  function initClock() {
    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
    var cfg = G.clockConfig || { w: 0, b: 0, inc: 0 };
    var any = (cfg.w > 0) || (cfg.b > 0) || (cfg.inc > 0);
    if (!any) { G.clock = null; updateClockDisplay(); return; }
    G.clock = { baseW: cfg.w, baseB: cfg.b, inc: cfg.inc, w: cfg.w || 0, b: cfg.b || 0, running: G.state.turn, lastTick: Date.now() };
    updateClockDisplay();
    clockInterval = setInterval(tickClock, 200);
  }

  function tickClock() {
    if (!G.clock || G.over) return;
    if (document.hidden) { G.clock.lastTick = Date.now(); return; }
    var openDialog = document.querySelector('dialog[open]');
    if (openDialog) { G.clock.lastTick = Date.now(); return; }
    var now = Date.now();
    var elapsed = now - G.clock.lastTick;
    G.clock.lastTick = now;
    var r = G.clock.running;
    if (r === 'w' || r === 'b') {
      G.clock[r] = Math.max(0, G.clock[r] - elapsed);
      updateClockDisplay();
      if (G.clock[r] <= 0) {
        G.clock.running = null;
        if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
        G.over = { reason: 'timeout', winner: r === 'w' ? 'b' : 'w' };
        renderAll();
        save();
        announce('Süre doldu! ' + TR_SIDE[G.over.winner] + ' kazandı.');
      }
    }
  }

  function parseDuration(str) {
    str = String(str || '').trim();
    if (!str) return 0;
    if (str.indexOf(':') >= 0) {
      var parts = str.split(':');
      var m = parseInt(parts[0], 10) || 0;
      var sec = parseInt(parts[1], 10) || 0;
      if (parts.length === 3) { /* h:m:s */ m = m * 60 + (parseInt(parts[1],10)||0); sec = parseInt(parts[2],10)||0; }
      return (m * 60 + sec) * 1000;
    }
    // bare number: treat as minutes if < 60? Use minutes for consistency with prior UX.
    var n = parseInt(str, 10);
    if (isNaN(n)) return 0;
    return n * 60 * 1000;
  }
  function updateClockDisplay() {
    var cw = document.getElementById('clock-white-time');
    var cb = document.getElementById('clock-black-time');
    var wc = document.getElementById('clock-white');
    var bc = document.getElementById('clock-black');
    if (!cw || !cb) return;
    function fmt(ms) {
      if (ms == null) return '—';
      var s = Math.ceil(ms / 1000);
      var m = Math.floor(s / 60);
      var sec = s % 60;
      return m + '<span class="colon">:</span>' + (sec < 10 ? '0' : '') + sec;
    }
    if (!G.clock) {
      cw.innerHTML = '∞'; cb.innerHTML = '∞';
      if (wc) wc.classList.remove('active', 'low');
      if (bc) bc.classList.remove('active', 'low');
      return;
    }
    cw.innerHTML = fmt(G.clock.w);
    cb.innerHTML = fmt(G.clock.b);
    if (wc) { wc.classList.toggle('active', G.clock.running === 'w'); wc.classList.toggle('low', G.clock.w < 20000); }
    if (bc) { bc.classList.toggle('active', G.clock.running === 'b'); bc.classList.toggle('low', G.clock.b < 20000); }
  }

  function pgnDate() {
    var d = new Date();
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  }

  function buildPgn() {
    var result = '*';
    if (G.over) {
      if (G.over.reason === 'checkmate') result = G.over.winner === 'w' ? '1-0' : '0-1';
      else result = '1/2-1/2';
    }
    var tags = [
      '[Event "En Passant"]',
      '[Site "En Passant — yerel iki kişilik"]',
      '[Date "' + pgnDate() + '"]',
      '[Round "-"]',
      '[White "Beyaz"]',
      '[Black "Siyah"]',
      '[Result "' + result + '"]'
    ];
    var body = '';
    for (var i = 0; i < G.moves.length; i += 2) {
      body += (i / 2 + 1) + '. ' + G.moves[i] + (G.moves[i + 1] ? ' ' + G.moves[i + 1] : '') + ' ';
    }
    return tags.join('\n') + '\n\n' + (body.trim() ? body.trim() + ' ' + result : result);
  }

  function copyPgn() {
    var text = buildPgn();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { announce('PGN kopyalandı.'); },
        function () { fallbackCopy(text); }
      );
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      announce('PGN kopyalandı.');
    } catch (e) {
      announce('Kopyalama başarısız oldu.');
    }
    document.body.removeChild(ta);
  }

  /* ============================================================
     Kaydetme / geri yükleme (localStorage)
     ============================================================ */
  function serializeState(s) {
    var b = '';
    for (var i = 0; i < 64; i++) {
      var p = s.board[i];
      b += p ? p.c + p.t : '.';
    }
    return {
      b: b,
      t: s.turn,
      k: (s.castling.wk ? 'K' : '') + (s.castling.wq ? 'Q' : '') + (s.castling.bk ? 'k' : '') + (s.castling.bq ? 'q' : ''),
      e: s.ep ? s.ep.r * 8 + s.ep.c : -1,
      h: s.halfmove,
      f: s.fullmove
    };
  }

  function deserializeState(d) {
    if (!d || typeof d !== 'object') return null;
    if (typeof d.b !== 'string' || d.b.length !== 64) return null;
    var turn = d.t === 'w' || d.t === 'b' ? d.t : null;
    if (!turn) return null;
    var k = (typeof d.k === 'string') ? d.k : '';
    // castling flags subset of KQkq
    if (!/^[KQkq]*$/.test(k)) return null;
    var board = new Array(64).fill(null);
    for (var i = 0; i < 64; i++) {
      var ch = d.b[i];
      if (ch === '.') continue;
      if (!/^[wb][pnbrqk]$/.test(ch)) return null;
      board[i] = { t: ch[1], c: ch[0] };
    }
    var ep = -1;
    if (Number.isInteger(d.e) && d.e >= -1 && d.e < 64) ep = d.e;
    else if (d.e === undefined || d.e === null) ep = -1;
    else return null;
    var hm = Number.isInteger(d.h) && d.h >= 0 && d.h <= 200 ? d.h : 0;
    var fm = Number.isInteger(d.f) && d.f >= 1 && d.f <= 100000 ? d.f : 1;
    // castling rights
    var castling = {
      wk: k.indexOf('K') >= 0,
      wq: k.indexOf('Q') >= 0,
      bk: k.indexOf('k') >= 0,
      bq: k.indexOf('q') >= 0
    };
    // ep index to {r,c}
    var epObj = ep >= 0 ? { r: Math.floor(ep / 8), c: ep % 8 } : null;
    return {
      board: board,
      turn: turn,
      castling: castling,
      ep: epObj,
      halfmove: hm,
      fullmove: fm
    };
  }

  function save() {
    try {
      var data = {
        v: 1,
        hist: G.hist.map(function (en) {
          return {
            s: serializeState(en.state),
            n: en.san,
            m: en.lastMove ? { fr: en.lastMove.fr, fc: en.lastMove.fc, tr: en.lastMove.tr, tc: en.lastMove.tc, ep: en.lastMove.ep, castle: en.lastMove.castle, promo: en.lastMove.promo } : null
          };
        }),
        flip: G.autoFlip,
        clockConfig: G.clockConfig,
        theme: G.theme,
        redo: G.redo.map(function (en) {
          return {
            s: serializeState(en.state),
            n: en.san,
            m: en.lastMove ? { fr: en.lastMove.fr, fc: en.lastMove.fc, tr: en.lastMove.tr, tc: en.lastMove.tc, ep: en.lastMove.ep, castle: en.lastMove.castle, promo: en.lastMove.promo } : null
          };
        })
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) { /* kaydetme başarısız olsa da oyun sürsün */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || data.v !== 1 || !Array.isArray(data.hist) || !data.hist.length) return false;

      G.hist = [];
      G.moves = [];
      for (var i = 0; i < data.hist.length; i++) {
        var en = data.hist[i];
        var st = deserializeState(en.s);
        if (!st) return false;
        G.hist.push({ state: st, san: (typeof en.n === 'string' ? en.n : null), lastMove: en.m || null });
        if (typeof en.n === 'string') G.moves.push(en.n);
      }
      G.redo = [];
      if (Array.isArray(data.redo)) {
        for (var j = 0; j < data.redo.length; j++) {
          var en2 = data.redo[j];
          var st2r = deserializeState(en2.s);
          G.redo.push({ state: st2r, san: en2.n || null, lastMove: en2.m || null });
        }
      }
      var last = G.hist[G.hist.length - 1];
      G.state = cloneState(last.state);
      G.lastMove = last.lastMove || null;
      G.autoFlip = data.flip !== false;
      if (data.clockConfig && data.clockConfig.w != null) {
        var cc = data.clockConfig;
        var clamp = function (v) { return Math.max(0, Math.min(10000000, (Number.isFinite(v) ? v : 0))); };
        G.clockConfig = {
          w: clamp(cc.w), b: clamp(cc.b),
          inc: clamp(cc.inc)
        };
      }
      if (data.theme) G.theme = data.theme;

      clearSelection();
      rebuildReps();

      var st2 = E.status(G.state);
      G.check = st2.check;
      G.over = st2.over
        ? { reason: st2.reason, winner: st2.winner }
        : (G.reps[E.posKey(G.state)] >= 3 ? { reason: 'repetition', winner: null } : null);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ============================================================
     Başlatma
     ============================================================ */
  function askConfirm(message, onYes) {
    confirmMsg.textContent = message;
    confirmResolver = onYes;
    confirmDialog.showModal();
    confirmYes.focus();
  }

  confirmYes.addEventListener('click', function () {
    confirmDialog.close();
    if (confirmResolver) { var cb = confirmResolver; confirmResolver = null; cb(); }
  });
  confirmNo.addEventListener('click', function () {
    confirmDialog.close();
    confirmResolver = null;
  });
  confirmDialog.addEventListener('close', function () { confirmResolver = null; });
  function populateThemeGrid(grid) {
    if (!grid) return;
    grid.innerHTML = '';
    var themes = [
      { id: 'default', name: 'Klasik Ahşap', sqL: '#f0d9b5', sqD: '#b58863', bg: '#201812' },
      { id: 'light', name: 'Açık Ahşap', sqL: '#f0d9b5', sqD: '#b58863', bg: '#f5efe6' },
      { id: 'midnight', name: 'Gece Mavisi', sqL: '#cfd8e6', sqD: '#5b6b8a', bg: '#0b1220' },
      { id: 'ocean', name: 'Okyanus', sqL: '#d6e4f0', sqD: '#4a90d9', bg: '#0a192f' },
      { id: 'forest', name: 'Orman', sqL: '#e8d8b0', sqD: '#5d8a4f', bg: '#0f1f17' },
      { id: 'crimson', name: 'Bordo', sqL: '#f0d9b5', sqD: '#a04040', bg: '#1f0f14' },
      { id: 'sepia', name: 'Sepya', sqL: '#f0d9b5', sqD: '#b58863', bg: '#f4ecd8' },
      { id: 'slate', name: 'Grafit', sqL: '#d4d4d8', sqD: '#6b7280', bg: '#1e2329' },
      { id: 'rose', name: 'Gül', sqL: '#fce4ec', sqD: '#c97b9a', bg: '#2a1420' },
      { id: 'emerald', name: 'Zümrüt', sqL: '#e8d8a8', sqD: '#4f7f6a', bg: '#0d1f1a' }
    ];
    themes.forEach(function (t) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-swatch' + (t.id === (G.theme || 'default') ? ' active' : '');
      btn.dataset.theme = t.id;
      btn.setAttribute('aria-label', t.name);
      // 4x4 mini board preview in theme colors + a knight piece
      btn.innerHTML = '<span class="swatch-preview theme-img-preview"><img src="assets/themes/' + t.id + '.svg" alt="' + t.name + '"></span><span class="swatch-name">' + t.name + '</span>';
      btn.addEventListener('click', function () {
        applyTheme(t.id);
        save();
        populateThemeGrid(grid);
      });
      grid.appendChild(btn);
    });
  }

  function populateHeroThemes(container) {
    if (!container) return;
    container.innerHTML = '';
    var themes = [
      { id: 'default', bg: '#201812' },
      { id: 'light', bg: '#f5efe6' },
      { id: 'midnight', bg: '#0b1220' },
      { id: 'ocean', bg: '#0a192f' },
      { id: 'forest', bg: '#0f1f17' },
      { id: 'crimson', bg: '#1f0f14' },
      { id: 'sepia', bg: '#f4ecd8' },
      { id: 'slate', bg: '#1e2329' },
      { id: 'rose', bg: '#2a1420' },
      { id: 'emerald', bg: '#0d1f1a' }
    ];
    themes.forEach(function (t) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'hero-theme-dot' + (t.id === (G.theme || 'default') ? ' active' : '');
      dot.style.background = t.bg;
      dot.setAttribute('aria-label', t.id);
      dot.addEventListener('click', function () {
        applyTheme(t.id);
        save();
        populateHeroThemes(container);
        var tg = document.getElementById('theme-grid');
        if (tg) populateThemeGrid(tg);
      });
      container.appendChild(dot);
    });
  }

  function applyTheme(name) {
    if (!name) name = 'default';
    document.documentElement.setAttribute('data-theme', name === 'default' ? '' : name);
    if (name === 'default') document.documentElement.removeAttribute('data-theme');
    G.theme = name;
    var sel = document.getElementById('sel-theme');
    if (sel) sel.value = name;
  }

  function wireControls() {
    var viewMenu = document.getElementById('view-menu');
    var viewGame = document.getElementById('view-game');
    function showGame() { if (viewMenu) viewMenu.classList.add('hidden'); if (viewGame) viewGame.classList.remove('hidden'); }
    function showMenu() { if (viewGame) viewGame.classList.add('hidden'); if (viewMenu) viewMenu.classList.remove('hidden'); }
    window.__showGame = showGame;
    window.__showMenu = showMenu;

    btnNew.addEventListener('click', newGame);
    btnUndo.addEventListener('click', undo);
    btnRedo.addEventListener('click', redo);
    btnRotate.addEventListener('click', function () {
      setOrientation(E.opp(G.orientation), true);
    });

    setupStart.addEventListener('click', startFromSetup);
    setupCancel.addEventListener('click', function () { setupDialog.close(); });

    var btnMenu = document.getElementById('btn-menu');
    var menuDialog = document.getElementById('menu-dialog');
    var menuClose = document.getElementById('menu-close');
    var menuFlip = document.getElementById('menu-flip');
    var themeGrid = document.getElementById('theme-grid');
    if (btnMenu && menuDialog) {
      btnMenu.addEventListener('click', function () {
        if (menuFlip) menuFlip.checked = G.autoFlip;
        menuDialog.showModal();
      });
    }
    if (menuClose && menuDialog) menuClose.addEventListener('click', function () { menuDialog.close(); });

    var btnOpenThemes = document.getElementById('btn-open-themes');
    var themeDialog = document.getElementById('theme-dialog');
    var themeClose = document.getElementById('theme-close');
    if (btnOpenThemes && themeDialog) {
      btnOpenThemes.addEventListener('click', function () {
        var tg = document.getElementById('theme-grid');
        if (tg) populateThemeGrid(tg);
        themeDialog.showModal();
      });
    }
    if (themeClose && themeDialog) themeClose.addEventListener('click', function () { themeDialog.close(); });

    /* ana menü */
    var heroPlay = document.getElementById('hero-play');
    var heroSettings = document.getElementById('hero-settings');
    var btnHome = document.getElementById('btn-home');
    if (heroPlay) heroPlay.addEventListener('click', function () {
      var vm = document.getElementById('view-menu');
      var vg = document.getElementById('view-game');
      if (vm) vm.classList.add('hidden');
      if (vg) vg.classList.remove('hidden');
      openSetup();
    });
    if (heroSettings) heroSettings.addEventListener('click', function () {
      if (menuFlip) menuFlip.checked = G.autoFlip;
      if (themeGrid) populateThemeGrid(themeGrid);
      if (menuDialog) menuDialog.showModal();
    });
    if (btnHome) btnHome.addEventListener('click', function () {
      var vm = document.getElementById('view-menu');
      var vg = document.getElementById('view-game');
      if (vg) vg.classList.add('hidden');
      if (vm) vm.classList.remove('hidden');
    });

    if (menuFlip) {
      menuFlip.checked = G.autoFlip;
      menuFlip.addEventListener('change', function () {
        G.autoFlip = menuFlip.checked;
        if (G.autoFlip && !G.over) setOrientation(G.state.turn, true);
        save();
      });
    }

    var selTheme = document.getElementById('sel-theme');
    if (selTheme) {
      selTheme.value = G.theme || 'default';
      selTheme.addEventListener('change', function () {
        applyTheme(selTheme.value);
        save();
      });
    }

    // YouTube müzik
    var btnYtLoad = document.getElementById('btn-yt-load');
    var btnYtPlay = document.getElementById('btn-yt-play');
    var btnYtPause = document.getElementById('btn-yt-pause');
    var ytVol = document.getElementById('yt-vol');
    var ytStatus = document.getElementById('yt-status');
    var ytUrl = document.getElementById('yt-url');

    function ytSetStatus(msg) { if (ytStatus) ytStatus.textContent = msg; }

    function ytParseId(url) {
      if (!url) return null;
      var m = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    }

    function ytLoadApi() {
      return new Promise(function (resolve) {
        if (window.YT && window.YT.Player) { resolve(); return; }
        if (!document.querySelector('script[src*="iframe_api"]')) {
          var tag = document.createElement('script');
          tag.src = 'https://www.youtube.com/iframe_api';
          document.head.appendChild(tag);
        }
        var iv = setInterval(function () {
          if (window.YT && window.YT.Player) { clearInterval(iv); resolve(); }
        }, 200);
        setTimeout(function () { clearInterval(iv); resolve(); }, 15000);
      });
    }

    var ytPlayer = null;

    function ytLoad() {
      var id = ytParseId(ytUrl ? ytUrl.value.trim() : '');
      if (!id) { ytSetStatus('Geçersiz YouTube linki.'); return; }
      ytSetStatus('Yükleniyor...');
      ytLoadApi().then(function () {
        if (typeof YT === 'undefined' || !YT.Player) { ytSetStatus('YouTube API yüklenemedi.'); return; }
        if (!ytPlayer) {
          ytPlayer = new YT.Player('yt-player', {
            height: '1', width: '1',
            videoId: id,
            playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, playsinline: 1, rel: 0, origin: window.location.origin && window.location.origin !== 'null' ? window.location.origin : undefined },
            events: {
              onReady: function (e) {
                try { e.target.setVolume(parseInt(ytVol.value, 10) || 50); } catch (err) {}
                try { e.target.playVideo(); } catch (err) {}
                ytSetStatus('Oynatılıyor.');
              },
              onStateChange: function (e) {
                // 0=ended, 1=playing, 2=paused, 3=buffering
                if (e.data === 0) ytSetStatus('Bitti.');
                else if (e.data === 1) ytSetStatus('Oynatılıyor.');
                else if (e.data === 2) ytSetStatus('Duraklatıldı.');
                else if (e.data === 3) ytSetStatus('Yükleniyor...');
              },
              onError: function (ev) {
                var code = ev && ev.data;
                if (code === 101 || code === 150 || code === 153) {
                  ytSetStatus('Bu video gömülü oynatmayı desteklemiyor. Başka bir video deneyin.');
                } else {
                  ytSetStatus('Video yüklenemedi (kod ' + code + ').');
                }
              }
            }
          });
        } else {
          try { ytPlayer.loadVideoById(id); ytPlayer.playVideo(); ytSetStatus('Oynatılıyor.'); } catch (err) { ytSetStatus('Oynatma hatası.'); }
        }
      });
    }

    if (btnYtLoad) btnYtLoad.addEventListener('click', ytLoad);
    // preload API in background for faster first load
    ytLoadApi();
    if (btnYtPlay) btnYtPlay.addEventListener('click', function () {
      if (ytPlayer && typeof ytPlayer.playVideo === 'function') { ytPlayer.playVideo(); ytSetStatus('Oynatılıyor.'); }
      else ytSetStatus('Önce bir link yükleyin.');
    });
    if (btnYtPause) btnYtPause.addEventListener('click', function () {
      if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') { ytPlayer.pauseVideo(); ytSetStatus('Duraklatıldı.'); }
    });
    if (ytVol) ytVol.addEventListener('input', function () {
      if (ytPlayer && typeof ytPlayer.setVolume === 'function') ytPlayer.setVolume(parseInt(ytVol.value, 10) || 0);
    });
  }

  buildBoard();
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  var restored = load();
  if (!restored) {
    var initialSt = E.initial();
    G.state = cloneState(initialSt);
    G.hist = [{ state: cloneState(initialSt), san: null, lastMove: null }];
    G.moves = [];
    G.lastMove = null;
    rebuildReps();
  } else {
    chkFlip.checked = G.autoFlip;
    var vm = document.getElementById('view-menu');
    var vg = document.getElementById('view-game');
    if (vm) vm.classList.add('hidden');
    if (vg) vg.classList.remove('hidden');
  }

  applyTheme(G.theme || 'default');
  wireControls();
  G.orientation = null;
  setOrientation(G.autoFlip && !G.over ? G.state.turn : 'w', false);
  initClock();
  renderAll();
  save();

  window.addEventListener('beforeunload', save);
})();
